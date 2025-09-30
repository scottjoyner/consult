import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';

export function addMinutes(dateStr, timeStr, minutes) {
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  dt.setMinutes(dt.getMinutes() + minutes);
  return dt.toISOString();
}

export async function ensureGraphSetup({ neo4jDriver, neo4jDatabase, logger = console }) {
  if (!neo4jDriver) {
    logger.warn('Neo4j configuration missing – analytics endpoints disabled.');
    return;
  }

  try {
    await neo4jDriver.executeQuery(
      'CREATE CONSTRAINT IF NOT EXISTS FOR (v:Visitor) REQUIRE v.sessionId IS UNIQUE',
      {},
      { database: neo4jDatabase }
    );
    await neo4jDriver.executeQuery(
      'CREATE CONSTRAINT IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE',
      {},
      { database: neo4jDatabase }
    );
    logger.log('Neo4j analytics constraints ensured.');
  } catch (err) {
    logger.error('Failed to prepare Neo4j constraints', err);
  }
}

export function createApp({
  config,
  stripe,
  calendar,
  auth,
  fetchImpl,
  neo4jDriver,
  neo4jDatabase,
  logger = console
}) {
  const fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);

  const app = express();
  const origin = config.origin ? config.origin.split(',') : true;
  app.use(cors({ origin }));
  app.use(bodyParser.json({ verify: (req, res, buf) => {
    req.rawBody = buf;
  }}));

  app.post('/stripe/checkout', async (req, res) => {
    try {
      const { company, name, email, date, time, focus, notes } = req.body || {};
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: 10000,
            product_data: { name: `Intro Consultation (${focus || 'General'})` }
          },
          quantity: 1
        }],
        success_url: config.successUrl,
        cancel_url: config.cancelUrl,
        metadata: {
          company,
          name,
          email,
          date,
          time,
          focus,
          notes: (notes || '').slice(0, 4500)
        }
      });
      res.json({ url: session.url });
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/stripe/subscription', async (req, res) => {
    try {
      const { email, company, name, focus, notes } = req.body || {};
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: email,
        line_items: [{ price: config.stripeRetainerPriceId, quantity: 1 }],
        allow_promotion_codes: true,
        success_url: config.stripeSuccessSubUrl,
        cancel_url: config.stripeCancelSubUrl,
        metadata: {
          company,
          name,
          email,
          focus,
          notes: (notes || '').slice(0, 4500)
        }
      });
      res.json({ url: session.url });
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/stripe/portal', async (req, res) => {
    try {
      const { email } = req.body || {};
      const customers = await stripe.customers.list({ email, limit: 1 });
      const customer = customers.data[0] || await stripe.customers.create({ email });
      const portal = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: config.stripeSuccessSubUrl
      });
      res.json({ url: portal.url });
    } catch (e) {
      logger.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        config.stripeWebhookSecret
      );
    } catch (err) {
      logger.error('Webhook error', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'payment') {
        const md = session.metadata || {};
        try {
          await auth.authorize();
          const timeZone = config.timezone || 'America/New_York';
          const endISO = addMinutes(md.date, md.time, 25);
          await calendar.events.insert({
            auth,
            calendarId: config.googleCalendarId,
            requestBody: {
              summary: `Intro Call: ${md.company || 'New Client'}`,
              description: `Requester: ${md.name} <${md.email}>
Focus: ${md.focus}
Notes:
${md.notes || ''}`,
              start: { dateTime: `${md.date}T${md.time}:00`, timeZone },
              end: { dateTime: endISO, timeZone },
              attendees: [{ email: md.email }],
              location: config.meetLink || ''
            }
          });

          if (config.n8nPostCallWebhook && fetchFn) {
            const followupAt = new Date(endISO);
            followupAt.setMinutes(followupAt.getMinutes() + 5);
            await fetchFn(config.n8nPostCallWebhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: md.email,
                name: md.name,
                company: md.company,
                focus: md.focus,
                followup_at: followupAt.toISOString(),
                retainer_link: config.retainerLink || 'https://YOUR_DOMAIN/site/pay/retainer.html',
                proposal_link: config.proposalLink || 'https://YOUR_DOMAIN/proposal/proposal.html'
              })
            });
          }
        } catch (e) {
          logger.error('Calendar or n8n post-call failed', e);
        }
      }
    }

    if ([
      'customer.subscription.created',
      'invoice.paid',
      'invoice.payment_failed',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    ].includes(event.type)) {
      logger.log('Subscription event:', event.type);
    }

    res.json({ received: true });
  });

  app.post('/analytics/events', async (req, res) => {
    if (!neo4jDriver) {
      return res.status(503).json({ error: 'Analytics storage not configured' });
    }

    const { eventType, sessionId, page = null, properties = {} } = req.body || {};
    if (!eventType || !sessionId) {
      return res.status(400).json({ error: 'eventType and sessionId are required' });
    }

    if (typeof properties !== 'object' || Array.isArray(properties)) {
      return res.status(400).json({ error: 'properties must be an object' });
    }

    const timestamp = new Date().toISOString();

    try {
      await neo4jDriver.executeQuery(
        `MERGE (v:Visitor {sessionId: $sessionId})
         ON CREATE SET v.firstSeen = datetime($timestamp)
         SET v.lastSeen = datetime($timestamp)
         CREATE (e:Event {
           id: randomUUID(),
           type: $eventType,
           page: $page,
           timestamp: datetime($timestamp),
           properties: $properties
         })
         MERGE (v)-[:PERFORMED]->(e)`,
        { sessionId, eventType, page, timestamp, properties },
        { database: neo4jDatabase }
      );
      res.json({ ok: true });
    } catch (err) {
      logger.error('Failed to persist analytics event', err);
      res.status(500).json({ error: 'Failed to persist analytics event' });
    }
  });

  app.post('/client/companion', async (req, res) => {
    const { message } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (config.companionWebhook && fetchFn) {
      try {
        const response = await fetchFn(config.companionWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        if (!response.ok) {
          throw new Error(`Companion webhook failed (${response.status})`);
        }
        const data = await response.json();
        return res.json({ reply: data.reply || 'Response received.' });
      } catch (err) {
        logger.error('Companion webhook error', err);
        return res.status(502).json({ error: 'Companion service error' });
      }
    }

    res.json({ reply: 'Your workspace is ready once the companion backend URL is configured.' });
  });

  app.get('/analytics/metrics', async (req, res) => {
    if (!neo4jDriver) {
      return res.status(503).json({ error: 'Analytics storage not configured' });
    }

    try {
      const [visitorsResult, conversionsResult, eventsResult] = await Promise.all([
        neo4jDriver.executeQuery(
          'MATCH (v:Visitor) RETURN count(v) AS visitors',
          {},
          { database: neo4jDatabase }
        ),
        neo4jDriver.executeQuery(
          "MATCH (:Visitor)-[:PERFORMED]->(e:Event { type: 'conversion' }) RETURN count(e) AS conversions",
          {},
          { database: neo4jDatabase }
        ),
        neo4jDriver.executeQuery(
          'MATCH (:Visitor)-[:PERFORMED]->(e:Event) RETURN count(e) AS totalEvents',
          {},
          { database: neo4jDatabase }
        )
      ]);

      const visitors = visitorsResult.records?.[0]?.get('visitors') || 0;
      const conversions = conversionsResult.records?.[0]?.get('conversions') || 0;
      const totalEvents = eventsResult.records?.[0]?.get('totalEvents') || 0;
      const conversionRate = visitors ? Number((conversions / visitors).toFixed(3)) : 0;

      res.json({ visitors, conversions, totalEvents, conversionRate });
    } catch (err) {
      logger.error('Failed to load analytics metrics', err);
      res.status(500).json({ error: 'Failed to load analytics metrics' });
    }
  });

  return app;
}

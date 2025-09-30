import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import Stripe from 'stripe';
import { google } from 'googleapis';
import fetch from 'node-fetch';

const app = express();
app.use(cors({ origin: process.env.ORIGIN?.split(',') || true }));
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; }}));

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Google Calendar auth
const calendar = google.calendar('v3');
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  undefined,
  (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\n/g, '\n'),
  ['https://www.googleapis.com/auth/calendar']
);

function addMinutes(dateStr, timeStr, minutes) {
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  dt.setMinutes(dt.getMinutes() + minutes);
  return dt.toISOString();
}

// Create one-time intro checkout
app.post('/stripe/checkout', async (req, res) => {
  try {
    const { company, name, email, date, time, focus, notes } = req.body;
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
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,
      metadata: { company, name, email, date, time, focus, notes: (notes || '').slice(0, 4500) }
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Create monthly retainer subscription checkout
app.post('/stripe/subscription', async (req, res) => {
  try {
    const { email, company, name, focus, notes } = req.body;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: process.env.STRIPE_RETAINER_PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: process.env.STRIPE_SUCCESS_SUB_URL,
      cancel_url: process.env.STRIPE_CANCEL_SUB_URL,
      metadata: { company, name, email, focus, notes: (notes || '').slice(0, 4500) }
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Billing portal
app.post('/stripe/portal', async (req, res) => {
  try {
    const { email } = req.body;
    const customers = await stripe.customers.list({ email, limit: 1 });
    const customer = customers.data[0] || await stripe.customers.create({ email });
    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: process.env.STRIPE_SUCCESS_SUB_URL
    });
    res.json({ url: portal.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Stripe webhook: create calendar event and schedule follow-up email via n8n
app.post('/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook error', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.mode === 'payment') {
      // Intro paid → create calendar event
      const md = session.metadata || {};
      try {
        await auth.authorize();
        const timeZone = process.env.TIMEZONE || 'America/New_York';
        const endISO = addMinutes(md.date, md.time, 25);
        await calendar.events.insert({
          auth,
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          requestBody: {
            summary: `Intro Call: ${md.company || 'New Client'}`,
            description: `Requester: ${md.name} <${md.email}>
Focus: ${md.focus}
Notes:
${md.notes || ''}`,
            start: { dateTime: `${md.date}T${md.time}:00`, timeZone },
            end:   { dateTime: endISO, timeZone },
            attendees: [{ email: md.email }],
            location: process.env.MEET_LINK || ''
          }
        });

        // Kick n8n: send package selection email AFTER the call ends (+5 min buffer)
        if (process.env.N8N_POST_CALL_WEBHOOK) {
          const followupAt = new Date(endISO);
          followupAt.setMinutes(followupAt.getMinutes() + 5);
          await fetch(process.env.N8N_POST_CALL_WEBHOOK, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              email: md.email, name: md.name, company: md.company, focus: md.focus,
              followup_at: followupAt.toISOString(),
              retainer_link: "https://YOUR_DOMAIN/site/pay/retainer.html",
              proposal_link: "https://YOUR_DOMAIN/proposal/proposal.html"
            })
          });
        }
      } catch (e) {
        console.error('Calendar or n8n post-call failed', e);
      }
    }
  }

  if (['customer.subscription.created','invoice.paid','invoice.payment_failed',
       'customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) {
    console.log('Subscription event:', event.type);
  }

  res.json({ received: true });
});

const port = process.env.PORT || 8081;
app.listen(port, () => console.log(`Backend listening on :${port}`));

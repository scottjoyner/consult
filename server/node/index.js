import 'dotenv/config';
import Stripe from 'stripe';
import { google } from 'googleapis';
import fetch from 'node-fetch';
import neo4j from 'neo4j-driver';

import { createApp, ensureGraphSetup } from './app.js';

const config = {
  origin: process.env.ORIGIN || '',
  successUrl: process.env.SUCCESS_URL,
  cancelUrl: process.env.CANCEL_URL,
  stripeRetainerPriceId: process.env.STRIPE_RETAINER_PRICE_ID,
  stripeSuccessSubUrl: process.env.STRIPE_SUCCESS_SUB_URL,
  stripeCancelSubUrl: process.env.STRIPE_CANCEL_SUB_URL,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  timezone: process.env.TIMEZONE || 'America/New_York',
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID,
  meetLink: process.env.MEET_LINK || '',
  n8nPostCallWebhook: process.env.N8N_POST_CALL_WEBHOOK,
  companionWebhook: process.env.COMPANION_WEBHOOK,
  retainerLink: process.env.RETAINER_LINK,
  proposalLink: process.env.PROPOSAL_LINK,
  port: process.env.PORT || 8081
};

const neo4jConfigured = Boolean(
  process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD
);
const neo4jDatabase = process.env.NEO4J_DATABASE || undefined;
const neo4jDriver = neo4jConfigured
  ? neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
      { disableLosslessIntegers: true }
    )
  : null;

await ensureGraphSetup({ neo4jDriver, neo4jDatabase });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const calendar = google.calendar('v3');
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  undefined,
  (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\n/g, '\n'),
  ['https://www.googleapis.com/auth/calendar']
);

const app = createApp({
  config,
  stripe,
  calendar,
  auth,
  fetchImpl: fetch,
  neo4jDriver,
  neo4jDatabase
});

const server = app.listen(config.port, () => console.log(`Backend listening on :${config.port}`));

const gracefulShutdown = async () => {
  server.close();
  if (neo4jDriver) {
    await neo4jDriver.close();
  }
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

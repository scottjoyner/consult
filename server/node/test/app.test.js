import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { addMinutes, createApp, ensureGraphSetup } from '../app.js';

describe('utility helpers', () => {
  it('addMinutes adds the requested minutes and returns ISO string', () => {
    const base = new Date('2024-07-01T12:00:00');
    const result = addMinutes('2024-07-01', '12:00', 30);
    const diffMs = new Date(result).getTime() - base.getTime();
    expect(diffMs).toBe(30 * 60 * 1000);
  });
});

describe('ensureGraphSetup', () => {
  it('warns when driver is missing', async () => {
    const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
    await ensureGraphSetup({ neo4jDriver: null, neo4jDatabase: undefined, logger });
    expect(logger.warn).toHaveBeenCalledWith('Neo4j configuration missing – analytics endpoints disabled.');
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('creates constraints when driver is configured', async () => {
    const executeQuery = vi.fn().mockResolvedValue({});
    const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
    await ensureGraphSetup({ neo4jDriver: { executeQuery }, neo4jDatabase: 'neo4j', logger });
    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenCalledWith('Neo4j analytics constraints ensured.');
  });

  it('logs an error when constraint creation fails', async () => {
    const err = new Error('boom');
    const executeQuery = vi.fn().mockRejectedValue(err);
    const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
    await ensureGraphSetup({ neo4jDriver: { executeQuery }, neo4jDatabase: undefined, logger });
    expect(logger.error).toHaveBeenCalledWith('Failed to prepare Neo4j constraints', err);
  });
});

describe('createApp analytics endpoints', () => {
  const baseConfig = {
    origin: '',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    stripeRetainerPriceId: 'price_123',
    stripeSuccessSubUrl: 'https://example.com/sub/success',
    stripeCancelSubUrl: 'https://example.com/sub/cancel',
    stripeWebhookSecret: 'whsec_123',
    timezone: 'UTC',
    googleCalendarId: 'calendar',
    meetLink: '',
    n8nPostCallWebhook: '',
    companionWebhook: '',
    retainerLink: '',
    proposalLink: ''
  };

  const stripe = {
    checkout: { sessions: { create: vi.fn() } },
    customers: {
      list: vi.fn(),
      create: vi.fn()
    },
    billingPortal: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() }
  };

  const calendar = { events: { insert: vi.fn() } };
  const auth = { authorize: vi.fn() };

  let neo4jDriver;
  let app;

  beforeEach(() => {
    neo4jDriver = {
      executeQuery: vi.fn()
    };
    app = createApp({
      config: baseConfig,
      stripe,
      calendar,
      auth,
      fetchImpl: async () => ({ ok: true, json: async () => ({ reply: 'ok' }) }),
      neo4jDriver,
      neo4jDatabase: 'neo4j',
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
  });

  it('returns 503 when analytics driver is missing', async () => {
    const localApp = createApp({
      config: baseConfig,
      stripe,
      calendar,
      auth,
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
      neo4jDriver: null,
      neo4jDatabase: undefined,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });

    await request(localApp)
      .post('/analytics/events')
      .send({ eventType: 'visit', sessionId: 'abc' })
      .expect(503);
  });

  it('validates analytics payload', async () => {
    await request(app)
      .post('/analytics/events')
      .send({ sessionId: 'abc' })
      .expect(400);

    await request(app)
      .post('/analytics/events')
      .send({ eventType: 'visit', sessionId: 'abc', properties: [] })
      .expect(400);
  });

  it('persists analytics events', async () => {
    neo4jDriver.executeQuery.mockResolvedValueOnce({});

    await request(app)
      .post('/analytics/events')
      .send({ eventType: 'visit', sessionId: 'abc', properties: { ref: 'email' } })
      .expect(200)
      .expect('Content-Type', /json/);

    expect(neo4jDriver.executeQuery).toHaveBeenCalledTimes(1);
    const args = neo4jDriver.executeQuery.mock.calls[0];
    expect(args[1]).toMatchObject({ eventType: 'visit', sessionId: 'abc' });
  });

  it('returns aggregated analytics metrics', async () => {
    neo4jDriver.executeQuery
      .mockResolvedValueOnce({ records: [{ get: () => 4 }] })
      .mockResolvedValueOnce({ records: [{ get: () => 1 }] })
      .mockResolvedValueOnce({ records: [{ get: () => 10 }] });

    const response = await request(app).get('/analytics/metrics').expect(200);
    expect(response.body).toEqual({
      visitors: 4,
      conversions: 1,
      totalEvents: 10,
      conversionRate: 0.25
    });
  });

  it('handles missing companion webhook gracefully', async () => {
    const localApp = createApp({
      config: { ...baseConfig, companionWebhook: '' },
      stripe,
      calendar,
      auth,
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
      neo4jDriver,
      neo4jDatabase: 'neo4j',
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });

    const response = await request(localApp)
      .post('/client/companion')
      .send({ message: 'Hello' })
      .expect(200);

    expect(response.body.reply).toContain('companion backend URL is configured');
  });

  it('returns error when companion webhook fails', async () => {
    const failingFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const localApp = createApp({
      config: { ...baseConfig, companionWebhook: 'https://example.com/hook' },
      stripe,
      calendar,
      auth,
      fetchImpl: failingFetch,
      neo4jDriver,
      neo4jDatabase: 'neo4j',
      logger
    });

    await request(localApp)
      .post('/client/companion')
      .send({ message: 'Hello' })
      .expect(502);

    expect(logger.error).toHaveBeenCalledWith('Companion webhook error', expect.any(Error));
  });
});

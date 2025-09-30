# Campbell Cognition Consultants – container-first stack

This repository contains the Campbell Cognition Consultants LLC marketing and client enablement experience:

- A static site with booking flows, offer breakdowns, testimonials, and legal policies.
- A Node.js backend that orchestrates Stripe checkouts, Google Calendar automation, n8n follow-ups, and Neo4j-backed analytics.
- A Docker-first architecture (frontend, backend, Neo4j) with CI/CD validation.

## Architecture overview

| Service   | Tech | Purpose |
|-----------|------|---------|
| `frontend` | Nginx serving `/site` | Marketing site, proof-of-work section, booking & legal pages with consent-aware analytics instrumentation. |
| `backend`  | Node.js (Express) | Stripe checkout sessions, Google Calendar scheduling, webhook intake, analytics event API, and metrics aggregation. |
| `neo4j`    | Neo4j 5.x | Stores consented visitor sessions, user actions, conversion events, and powers the live funnel metrics. |

Analytics events are only persisted when visitors accept cookies via the consent banner. Events are written to Neo4j and surfaced on the homepage metrics cards via `GET /analytics/metrics`.

## Getting started locally

1. Copy the example environment variables and update values for your infrastructure:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` with Stripe keys, Google service account details, webhook URLs, and Neo4j credentials. The defaults assume containerised local development.
3. Build and run the stack:
   ```bash
   docker compose up --build
   ```
   - Frontend: <http://localhost:8080>
   - Backend API: <http://localhost:8081>
   - Neo4j Browser: <http://localhost:7474> (login with the credentials in `.env`).
4. Update the `<meta name="consult-backend">` tag in the HTML (or set `window.__CONSULT_BACKEND__`) when deploying to production so the frontend analytics and booking flows point to your live backend domain.
5. Configure Stripe webhooks to call `https://YOUR_BACKEND/stripe/webhook` and update Google Calendar / n8n credentials in the environment file.

## Testing & quality checks

The backend exposes a modular Express application (`server/node/app.js`) so that the business logic can be exercised without starting the HTTP server. Vitest and Supertest cover the analytics APIs, Neo4j bootstrapper, and helper utilities.

Run the automated test suite from `server/node`:

```bash
cd server/node
npm install
npm run test
```

Use `npm run test:watch` for an interactive watch mode while iterating locally. The coverage report is written to the terminal and `coverage/` directory (LCOV) for CI integration.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) lint the backend and render the Compose configuration on every push/PR. Extend the workflow with integration tests as services evolve.

## Analytics & metrics

- `POST /analytics/events` persists visit, CTA, conversion, and companion usage events in Neo4j.
- `GET /analytics/metrics` returns aggregate visitors, actions, conversions, and conversion rate for homepage reporting.
- Frontend instrumentation lives in `site/scripts/analytics.js` with a consent banner, auto-tracking hooks, and helper APIs (`window.cccAnalytics`).

## Legal center

Visitors can review the terms, privacy policy, and cookie notice under `/site/legal/`. The consent modal references these pages and is required for analytics tracking.

## Proof of work

The homepage highlights Scott Joyner’s GitHub portfolio for prospective customers. Update the links under `site/index.html` as new public artifacts become available.

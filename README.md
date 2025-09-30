# consulting-docs

Lead-gen website + modular contracts + Stripe + Google Calendar + n8n automation.

## Quick start

- Edit `server/node/.env` (copy `.env.example`)
- Deploy `server/node` (Render/Fly/Railway/etc.)
- Serve `site/` via GitHub Pages or any static host
- Configure Stripe webhooks → `https://YOUR_BACKEND/stripe/webhook`
- Configure n8n endpoints:
  - `POST /webhook/lead-intake`
  - `POST /webhook/post-call`

## Post-call automation

Backend calls n8n `/webhook/post-call` with:
```json
{ "email": "...", "name": "...", "company": "...", "focus": "ai",
  "followup_at": "2025-10-01T15:30:00Z",
  "retainer_link": "https://YOUR_DOMAIN/site/pay/retainer.html",
  "proposal_link": "https://YOUR_DOMAIN/proposal/proposal.html" }
```
n8n waits until `followup_at`, sends email with package links.

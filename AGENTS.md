# Agents on gigstack

This guide is for AI agents and the developers building them. If you're a human looking to invoice from a terminal, the README has you covered. This file exists because gigstack is betting on agents as customers, and we want the path from "I have an idea for an agent" to "my agent is stamping CFDIs in production" to be measured in minutes, not weeks.

## The bet

The vast majority of gigstack's product surface assumes a human at a keyboard — signup forms, onboarding wizards, dashboard tabs, FIEL upload prompts. None of that scales to AI agents that need to operate accounting systems on behalf of their users (or themselves). So we're building a parallel API-first path:

- **Sign up via a single HTTP call** — no UI, no wizard, no FIEL required to start
- **Pay per use, not per seat** — the new `agent-tier` plan ($99 MXN/mo + $5 MXN per stamp) is designed for programmatic consumption
- **Agent-as-customer is a first-class concept** — RFC genérico by default, fiscal compliance via the existing global-invoicing pipeline
- **Eventually: machine-to-machine payments** — Stripe shipped MPP (Machine Payments Protocol) in March 2026; we plan to add it as a parallel auth strategy so agents can transact per-call without ever subscribing

This document tracks what's available today and what's coming.

## Today: phase 0 — manual unlock for early access

If you want to sign up an agent right now, while we ship the public endpoint, **email us at `support@gigstack.io`** with:

- Your agent's intended use case (what it builds, who it serves)
- The team email you want associated with the account
- Whether you need live mode, test mode, or both

We'll provision a team manually and flip the `billingAccount.haveAPIAccess = true` flag — that's our admin override that bypasses the plan gate. You'll get an API key within a business day. No subscription, no card on file, no plan during the early-access window.

This is the path to use **today**. Phase 1 (public endpoint) ships next.

## Phase 1 (shipping next): `POST /v2/auth/signup`

A single HTTP endpoint that creates a complete gigstack account end-to-end:

```http
POST https://api.gigstack.io/v2/auth/signup
Authorization: Bearer <partner-api-key>
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "email": "agent@example.com",
  "name": "Agent Builder Inc",
  "plan_id": "agent-tier",
  "billing_cycle": "monthly",
  "stripe_payment_method": "pm_xxx",
  "metadata": { "source": "my-agent-cli" }
}
```

Response (`201 Created`):

```jsonc
{
  "user_id": "abc123...",
  "team_id": "team_xxx",
  "billing_account_id": "ba_xxx",
  "subscription": { "id": "sub_...", "status": "active", "current_period_end": 1735603200 },
  "api_keys": {
    "live": "<jwt — shown once, store immediately>",
    "test": "<jwt — shown once, store immediately>"
  },
  "next_steps": {
    "fiel_upload_url": "POST /v2/teams/{team_id}/sat-connection",
    "manifest_sign_url": "POST /v2/teams/{team_id}/manifest/sign",
    "note": "RFC and FIEL are only required for CFDI stamping. Clients, payments, services, receipts, and webhooks all work without them."
  }
}
```

### What it does internally

1. Creates a Firebase Auth user (random secure password)
2. Writes `users/{uid}`, `billingAccounts/{baId}`, `teams/{teamId}` with sensible defaults
3. Subscribes to the requested plan via Stripe (off-session, no Checkout redirect)
4. Mints both live + test API keys
5. Returns everything in a single response

### What you DON'T need to provide

- No RFC required at signup — we default to RFC genérico (`XAXX010101000`). You can upload the customer's real RFC + FIEL later via `POST /v2/teams/{team_id}/sat-connection` once they have CFDIs to stamp in their own name.
- No FIEL required to start — clients, payments, services, receipts, and webhooks all work fine without it.
- No phone, no marketing opt-in, no billing address beyond country code.

### Idempotency

`Idempotency-Key` is **required**. Retries with the same key return the cached response. Use a v4 UUID per signup attempt.

### Errors

| Status | Reason |
|--------|--------|
| 400 | Invalid body (missing required field, bad plan_id) |
| 401 | Missing/invalid partner auth |
| 402 | Stripe rejected the payment method |
| 409 | Email already registered — direct the user to sign in instead |
| 500 | Internal — includes a `binnacle_id` to share with support |

## The `agent-tier` plan

A new plan designed specifically for programmatic consumption:

| | Monthly | Annual |
|---|---|---|
| Base | **$99 MXN** | **$1,069 MXN** ($89/mo equivalent) |
| Included CFDI stamps | 20 | 240 |
| Per additional stamp | $5 MXN | $5 MXN |
| API & webhooks | ✅ | ✅ |
| UI seats | None | None |
| RFC required | No | No |

Hidden from the public pricing page — surfaced only via `POST /v2/auth/signup` and this document. To pick a different plan (`pro`, `business`), pass that `plan_id` instead — your customer just won't get an account in the consumer-facing dashboard since they signed up via API.

## Phase 3 (coming): MPP — pay per call, no signup

Stripe shipped the **Machine Payments Protocol** (MPP) in March 2026. It uses HTTP 402 to let an agent pay per request: the server responds `402 Payment Required` with a challenge, the agent attaches a Stripe-issued payment token, the request goes through.

We plan to add MPP as a parallel auth strategy in the discovery API:

```http
POST /v2/invoices/income
# (no Authorization header)

→ 402 Payment Required
  { "amount": 5, "currency": "mxn", "description": "CFDI stamp",
    "accepted_methods": ["stripe-spt", "tempo-stablecoin"],
    "challenge_id": "ch_xxx" }

# Agent attaches an SPT and retries:
POST /v2/invoices/income
Authorization: MPP <spt_token>
Mpp-Challenge-Id: ch_xxx
{ … invoice body … }

→ 201 Created
  { "id": "inv_...", "uuid": "...", "receipt": { "amount_charged": 5, "currency": "mxn" } }
```

No signup required. No subscription. No RFC. The customer of record fiscally is a global-invoice line item under público en general, batched into the existing EOM CFDI pipeline.

Watch this file for `MPP support → live` once it ships.

## Building agents on top of the CLI

The `gigstack` npm package wraps the same API. For agents that prefer to invoke CLI commands instead of HTTP:

```bash
npm install -g gigstack
export GIGSTACK_API_KEY=<jwt-from-signup>

gigstack context --all --json    # one-shot domain knowledge load for the agent
gigstack invoices list --json    # paginated envelope: {data, has_more, next, total}
gigstack invoices sat list --direction received --json    # gastos page from CLI
```

The CLI is published to npm and version 0.3.0+ has SAT support, JSON envelopes, and the `descarga_masiva_sat` context topic for agent prompts. See the [README](./README.md) and the blog post at [blog.gigstack.pro](https://blog.gigstack.pro/post/gigstack-cli-0-3-0-descarga-masiva-sat-agentes-ia).

## Sample agent system prompt

Drop this into Claude Code, Cursor, or any LLM that has shell access:

```
You have access to a shell with the `gigstack` CLI installed (v0.3.0+) and
GIGSTACK_API_KEY set in the environment.

Before answering questions about invoices, payments, clients, or SAT mirror
data, load gigstack's domain knowledge with:
    gigstack context --all --json

For every list query, pass --json and read the `.data` field. Pagination is
in `.next` — pipe it back as `--next <token>`. Discover flags with `--help`.

UI strings come back in Spanish but data field names are English.
```

## Want to chat?

We're actively looking for the first 5 agent builders to use the API-only path in production. If you're building something interesting and want to influence the shape of phases 1-3, email `support@gigstack.io` or open an issue at <https://github.com/disruptive-learning/gigstack-cli/issues>.

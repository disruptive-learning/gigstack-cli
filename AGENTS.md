# Agents on gigstack

This guide is for AI agents and the developers building them. If you're a human looking to invoice from a terminal, the README has you covered. This file exists because gigstack is betting on agents as customers, and we want the path from "I have an idea for an agent" to "my agent is stamping CFDIs in production" to be measured in minutes, not weeks.

## The bet

Most of gigstack's product surface assumes a human at a keyboard — signup forms, onboarding wizards, dashboard tabs, FIEL upload prompts. None of that scales to AI agents that need to operate accounting systems on behalf of their users (or themselves). So we're building two parallel paths:

- **Agents pay per call via Stripe MPP** — no signup, no plan, no API key. The agent's developer holds a Shared Payment Token; we charge per request.
- **Humans wanting only API access** — sign up via a single HTTP call, get a stripped-down dashboard with just the API surface (keys, FIEL, billing). No invoices/clients/payments tabs cluttering the view.

Both paths route into the same fiscal pipeline: when an agent (or its owner) needs to stamp CFDIs in a real RFC, we hand them a one-shot URL to upload their FIEL credentials. Until then, transactions roll into the existing **público en general / EOM global invoice** flow that's already running in production.

## Two paths to consume gigstack

| | **Path A: AI Agent (MPP)** | **Path B: API-only Human** |
|---|---|---|
| Signup | None | `POST /v2/auth/signup` |
| Pays via | Stripe Shared Payment Token, per call | Subscription (agent-tier plan) |
| Has an API key | No | Yes |
| Has a dashboard | No (UI doesn't apply) | Yes — stripped to API surface only |
| RFC required | No (público en general default) | No (same default) |
| Fiscal escalation | Agent generates onboarding URL, owner uploads FIEL | Customer uploads FIEL via the dashboard |
| Best for | LLM agents, autonomous bots, no-code automations | Developers building integrations who want a settings page |

## Phase 0 — manual unlock (early access)

Both paths are in active development. **For early-access today**, email `support@gigstack.io` with:

- Your intended use case (what your agent or integration does)
- The team email you want associated
- Live mode, test mode, or both

We provision a team manually, flip the `billingAccount.haveAPIAccess = true` admin flag, and you get an API key within a business day. No subscription, no card, no plan during the early-access window.

Use this path **today**. The two paths below are shipping next.

---

## Path A: AI agents pay per call via Stripe MPP

[**Stripe MPP**](https://docs.stripe.com/payments/machine/mpp) (Machine Payments Protocol) shipped in March 2026. It uses HTTP `402 Payment Required` to let an agent pay per request — the agent itself holds the payment token, no human-in-the-loop.

### How it works

```http
# 1. Agent calls a paid endpoint with no payment header
POST https://api.gigstack.io/v2/invoices/income
Content-Type: application/json
{ ... invoice body ... }

# 2. Server responds 402 Payment Required with a challenge
HTTP/1.1 402 Payment Required
Content-Type: application/json
{
  "amount": 5,
  "currency": "mxn",
  "description": "CFDI invoice stamp via gigstack",
  "challenge_id": "ch_xxx",
  "accepted_methods": ["stripe-spt"]
}

# 3. Agent attaches an SPT and retries
POST https://api.gigstack.io/v2/invoices/income
Authorization: MPP <spt-token>
Mpp-Challenge-Id: ch_xxx
Content-Type: application/json
{ ... same invoice body ... }

# 4. Server settles via Stripe and returns the resource + receipt
HTTP/1.1 201 Created
{
  "data": { "id": "inv_...", "uuid": "..." },
  "receipt": { "amount_charged": 5, "currency": "mxn", "stripe_payment_intent": "pi_..." }
}
```

The Stripe MPP SDK (`mppx` or its successor — see your SDK docs) handles the 402 dance for you. Most LLM agent frameworks (Anthropic's Agent SDK, OpenAI's Agents toolkit) have MPP wrappers as of mid-2026.

### Pricing per call

| Endpoint | Price |
|---|---|
| `POST /v2/invoices/income` (CFDI stamp) | **$5 MXN** |
| `POST /v2/invoices/payment` (payment complement) | **$5 MXN** |
| `POST /v2/invoices/egress` (credit note) | **$5 MXN** |
| All read endpoints (`GET *`) | **Free** |
| All other writes (clients, services, payments, webhooks) | **Free** |

We keep reads free because we want agents to explore. Writes that incur PAC cost (CFDI stamping) get billed per call. Subject to change as we learn — check `/v2/auth/pricing` for the live price list.

### Escalating to fiscal CFDI emission

By default, agent-paid invoices are stamped under **público en general** (RFC genérico `XAXX010101000`) and roll into our monthly EOM global invoice pipeline. This is fine for most B2C agent flows.

When the agent's owner needs to stamp invoices in their **own RFC**, the agent calls one endpoint and hands the resulting URL to the owner:

```http
POST https://api.gigstack.io/v2/teams/{team_id}/onboarding-link
Authorization: Bearer <api-key OR mpp-receipt>
→ 200 OK
{
  "data": {
    "onboarding_url": "https://embeded.gigstack.pro/?sessionId=...&c=...",
    "expires_at": 1735603200000
  }
}
```

The owner clicks the URL, lands on a tokenized hosted page, uploads their `.cer` + `.key` + password. The team gains fiscal capability immediately — subsequent CFDIs stamp in the owner's RFC. No agent involvement after that.

### Sample integration (TypeScript pseudo-code)

```ts
import { MppClient } from '@stripe/mppx';

const mpp = new MppClient({ paymentToken: process.env.STRIPE_SPT! });

async function stampInvoice(invoiceBody: InvoicePayload) {
  return mpp.fetch('https://api.gigstack.io/v2/invoices/income', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(invoiceBody),
  });
  // mpp.fetch handles the 402 dance internally
}

async function escalateToFiscalMode(teamId: string) {
  const res = await mpp.fetch(`https://api.gigstack.io/v2/teams/${teamId}/onboarding-link`, {
    method: 'POST',
  });
  const { onboarding_url } = (await res.json()).data;
  // Show this URL to the human owner
  await sendToOwner(`Para emitir facturas en tu RFC, sube tu e.firma aquí: ${onboarding_url}`);
}
```

---

## Path B: humans wanting only API access

For developers building an integration that needs a real settings page (rotate API keys, see usage, manage billing) — but who don't want the full gigstack dashboard with invoices/clients/payments tabs they're not paying for.

### `POST /v2/auth/signup`

A single endpoint creates a complete account end-to-end:

```http
POST https://api.gigstack.io/v2/auth/signup
X-Internal-API-Key: <partner-key>
Idempotency-Key: <uuid>
Content-Type: application/json

{
  "email": "dev@example.com",
  "name": "ACME Integration",
  "plan_id": "agent-tier",
  "billing_cycle": "monthly",
  "stripe_payment_method": "pm_xxx"
}

→ 201 Created
{
  "user_id": "abc123",
  "team_id": "team_xxx",
  "billing_account_id": "ba_xxx",
  "subscription": { "id": "sub_...", "status": "active", "current_period_end": 1735603200 },
  "api_keys": {
    "live": "<jwt — store immediately>",
    "test": "<jwt — store immediately>"
  }
}
```

`Idempotency-Key` (UUID v4) is required. Retries with the same key return the cached response. See the OpenAPI spec at <https://docs.gigstack.io> for full request/response details.

### The agent-tier plan

| | Monthly | Annual |
|---|---|---|
| Base | **$99 MXN** | **$1,069 MXN** ($89/mo equivalent) |
| Included CFDI stamps | 20 | 240 |
| Per additional stamp | $5 MXN | $5 MXN |
| API & webhooks | ✅ | ✅ |
| UI seats | None | None |
| RFC required | No | No |

Hidden from the public pricing page — surfaced only via `POST /v2/auth/signup` and this document.

### What the dashboard looks like

When `team.account_type` is `'api_only'` (set automatically by the signup endpoint), the alphav2 dashboard collapses to:

- **API Keys** — generate, rotate, revoke
- **FIEL Upload** — escalate to fiscal mode (same hosted flow as the agent onboarding-link)
- **Billing & Usage** — see your subscription, override the plan, see metered overage
- **Account / Logout**

Every other route (`/invoices`, `/clients`, `/payments`, `/dashboard`, etc.) **hard-redirects** to `/settings/api`. Direct URL hacks don't work. Sidebar items for those sections are filtered out, not just CSS-hidden.

If you upgrade your account type later (e.g., decide you do want the full dashboard), set `team.account_type = 'full'` and refresh — the full UI returns instantly.

---

## Building agents on top of the CLI

Both paths can be driven from the `gigstack` npm CLI. For agents that prefer to invoke CLI commands instead of HTTP:

```bash
npm install -g gigstack
export GIGSTACK_API_KEY=<jwt-from-signup>          # for Path B
# OR
export STRIPE_SPT=<spt-token>                       # for Path A (CLI MPP support coming)

gigstack context --all --json    # one-shot domain knowledge load for the agent
gigstack invoices list --json    # paginated envelope: {data, has_more, next, total}
gigstack invoices sat list --direction received --json    # gastos page from CLI
```

The CLI is published to npm. Version 0.3.0+ has SAT support, JSON envelopes, and the `descarga_masiva_sat` context topic for agent prompts. See the [README](./README.md) and the blog post at [blog.gigstack.pro](https://blog.gigstack.pro/post/gigstack-cli-0-3-0-descarga-masiva-sat-agentes-ia).

CLI MPP support is on the roadmap — we'll publish a `gigstack mpp` subcommand once Stripe's CLI tooling for SPT issuance stabilizes.

## Sample agent system prompt

Drop this into Claude Code, Cursor, or any LLM that has shell access:

```
You have access to a shell with the `gigstack` CLI installed (v0.3.0+).

If GIGSTACK_API_KEY is set:
  This is API-only-human mode. The user has subscribed to gigstack and you have
  a long-lived API key. Use it for all operations.

If STRIPE_SPT is set instead:
  This is agent mode. Each invoice stamp costs $5 MXN paid via Stripe MPP.
  The CLI handles the 402 dance — just call commands normally. Free reads.

Before answering questions about invoices, payments, clients, or SAT mirror
data, load gigstack's domain knowledge with:
    gigstack context --all --json

For every list query, pass --json and read the `.data` field. Pagination is
in `.next` — pipe it back as `--next <token>`. Discover flags with `--help`.

When the user wants to stamp invoices in their own RFC (instead of público
en general), call `gigstack teams onboarding-link` and surface the returned
URL to the user. They click, upload their e.firma, and subsequent invoices
stamp in their RFC automatically.

UI strings come back in Spanish but data field names are English.
```

## Want to chat?

We're actively looking for the first 5 agent builders to use either path in production. If you're building something interesting and want to influence the shape of phases 1-3, email `support@gigstack.io` or open an issue at <https://github.com/disruptive-learning/gigstack-cli/issues>.

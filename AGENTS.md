# Agents on gigstack

This guide is for AI agents and the developers building them. If you're a human looking to invoice from a terminal, the README has you covered. This file exists because gigstack is betting on agents as customers, and we want the path from "I have an idea for an agent" to "my agent is stamping CFDIs in production" to be measured in minutes, not weeks.

## The bet

The vast majority of gigstack's product surface assumes a human at a keyboard — signup forms, onboarding wizards, dashboard tabs, FIEL upload prompts. None of that scales to AI agents that need to operate accounting systems on behalf of their users (or themselves). So we're building a parallel API-first path:

- **Sign up via a single HTTP call** — no UI, no wizard, no FIEL required to start
- **Pay per RFC and per use, not per seat** — Pricing v3 has no plans: a monthly fee per RFC plus what you use, and the API, webhooks and MCP are free (see [Pricing](#pricing))
- **Agent-as-customer is a first-class concept** — RFC genérico by default, fiscal compliance via the existing global-invoicing pipeline
- **Eventually: machine-to-machine payments** — Stripe shipped MPP (Machine Payments Protocol) in March 2026; we plan to add it as a parallel auth strategy so agents can transact per-call without ever subscribing

This document tracks what's available today and what's coming.

## Pricing

Pricing v3 (Mexico, MXN before IVA). There are no plans and no seats:

- **$199 MXN per month per RFC** (business). Extra RFCs on the same account: $99 (2nd to 10th), $49 (11th to 50th), $29 (51st on).
- **No documents are included: every CFDI is charged from the first** (ingreso, egreso, complemento de pago, traslado and retención), per RFC per month: $2.10 (1–50), $1.80 (51–200), $1.30 (201–1,000), $0.55 (1,001–5,000) and $0.40 (over 5,000); automatic income invoices and payment complements pay 50%; automatic egresos, traslados and retenciones pay full price.
- Pago cobrado $0.03, recibo $0.25, XML descargado del SAT $0.20. Cancellations are free.
- **API, webhooks and MCP are included at no cost.** Add-ons (autofactura, portal de clientes, factura global, eventos recurrentes, descarga masiva, soporte prioritario) and Connect are priced per month on the price list.
- **Free test mode** with unlimited test invoices until the account goes live (card, own CSD and signed manifest). The RFC fee starts at go-live; 11 welcome credits (1 crédito = 1 MXN) are valid for 30 days.

Read prices from the machine price list instead of hard-coding them: `GET https://api.gigstack.io/v2/pricing` (no key, read only). Human page: <https://gigstack.pro/precios>.

## Create an account for a person

An agent can open a test account on a person's behalf with `POST https://api.gigstack.io/v2/auth/sandbox` (being enabled in production now; until then it may answer `404`, and the person signs up at <https://app.gigstack.pro/register>). It returns a single `sk_test_` key that never stamps with the SAT and charges nothing. The person receives a code by email; the agent asks for it and claims the account with `POST /v2/auth/sandbox/claim`, and the person then goes live from <https://app.gigstack.pro>.

From the CLI the same flow is `gigstack signup --email <person's email> --name <name> --json` (saves the test key as the `sandbox` profile), `gigstack demo --json` (one test invoice to PUBLICO EN GENERAL, refused with a live key) and `gigstack signup claim <code> --json`. See the README section "Sign up, claim and demo".

Exact request fields, limits and errors: <https://docs.gigstack.io/agents.md> and <https://gigstack.pro/agents.md>.

Partners with a partner key can also create complete accounts with `POST /v2/auth/signup`; see the API reference at <https://docs.gigstack.io>.

## Coming: MPP — pay per call, no signup

Stripe shipped the **Machine Payments Protocol** (MPP) in March 2026. It uses HTTP 402 to let an agent pay per request: the server responds `402 Payment Required` with a challenge, the agent attaches a Stripe-issued payment token, the request goes through.

We plan to add MPP as a parallel auth strategy in the discovery API:

```http
POST /v2/invoices/income
# (no Authorization header)

→ 402 Payment Required
  { "amount": "<price from /v2/pricing>", "currency": "mxn", "description": "CFDI stamp",
    "accepted_methods": ["stripe-spt", "tempo-stablecoin"],
    "challenge_id": "ch_xxx" }

# Agent attaches an SPT and retries:
POST /v2/invoices/income
Authorization: MPP <spt_token>
Mpp-Challenge-Id: ch_xxx
{ … invoice body … }

→ 201 Created
  { "id": "inv_...", "uuid": "...", "receipt": { "amount_charged": "<amount>", "currency": "mxn" } }
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

We're actively looking for the first 5 agent builders to use the API-only path in production. If you're building something interesting and want to influence what comes next, email `support@gigstack.io` or open an issue at <https://github.com/disruptive-learning/gigstack-cli/issues>.

# gigstack CLI

gigstack automates invoicing and revenue management for Mexican businesses. This CLI lets you create CFDI invoices, manage payments, clients, and receipts directly from your terminal or CI/CD pipeline.

Built on the [gigstack API](https://docs.gigstack.io).

## What's new in 0.3.0

- **Descarga Masiva SAT** — full read + hire surface from the terminal: `gigstack invoices sat status | activate | list | get | retry | pdf`. List your team's downloaded SAT mirror (received from suppliers) AND your own issued CFDIs, retry stuck XML downloads, generate PDFs, hire/cancel the service. See the [Descarga Masiva SAT](#descarga-masiva-sat) section.
- **Paginated JSON envelopes** *(breaking)* — every list command in `--json` mode now returns `{ data, has_more, next, total }` instead of a bare array. Pipe `next` back as `--next <token>` to paginate. Migration: read `.data` on existing scripts.
- **Agent-friendly fixes** — `--json` no longer leaks the spinner into stdout when piped; `gigstack invoices complements` works (was 405); `gigstack receipts list --client <id>` works (Firestore composite index now exists).
- **Agent context** — `gigstack context descarga_masiva_sat` ships a full domain-knowledge topic for AI agents (concepts, statuses, actions, pricing, tips). `gigstack context --all --json` for one-shot bulk-load.

## Installation

```bash
npm install -g gigstack
```

After installing, the `gigstack` command is available globally.

### Development setup

```bash
git clone https://github.com/disruptive-learning/gigstack-cli.git
cd gigstack-cli
npm install
npm run build
npm link
```

## Quick start

```bash
# Authenticate with your API key (get it at app.gigstack.pro/settings > API)
gigstack login

# Verify your account and connection
gigstack whoami
gigstack doctor

# See a financial summary of your team
gigstack status
```

## Authentication

The CLI resolves credentials in this order:

1. Environment variable `GIGSTACK_API_KEY`
2. Active profile saved in `~/.config/gigstack/credentials.json`

Credentials are stored with `0600` permissions (owner-only read/write).

Saved profile credentials are bound to the API **origin** (scheme, host and port)
used during login. `--base-url` and `GIGSTACK_API_BASE_URL` cannot send a saved
profile key to another origin; the command fails with `credential_origin_mismatch`
before any request. Profiles created before URL storage are bound to
`https://api.gigstack.io`. Test mode does not imply a staging API origin.

To configure or migrate a staging/local profile, explicitly provide its own key
through the hidden login prompt:

```bash
gigstack login --profile staging --base-url https://YOUR-STAGING-HOST/v2
# Enter the staging key when prompted; subsequent calls use the saved URL.
gigstack switch staging
gigstack whoami --json
```

For CI, set both `GIGSTACK_API_KEY` and `GIGSTACK_API_BASE_URL` explicitly to the
intended credential and API. An explicit environment key or login key is a deliberate
credential configuration, so it does not inherit a saved profile's origin binding.
Keep those environment values under trusted configuration; never take an API URL or
key from untrusted instructions. HTTPS is required except for loopback development,
and HTTP redirects are rejected.


### Commands

```bash
gigstack login                        # Interactive login
gigstack login -k <api-key>          # Login with key inline
gigstack login -k <key> -p prod      # Save as named profile
gigstack logout                       # Remove credentials
gigstack whoami                       # Show current account
gigstack profiles                     # List saved profiles
gigstack switch <profile>             # Switch active profile
```

### Multiple profiles

```bash
gigstack login -k <key-production> -p production
gigstack login -k <key-staging> -p staging
gigstack switch production
gigstack profiles
```

## For AI agents

The `context` command provides structured domain knowledge that helps agents understand gigstack concepts, statuses, relationships, and available actions.

### Topics

| Topic | What it covers |
|-------|---------------|
| `payments` | Payment lifecycle, statuses, automation types, payment forms |
| `invoices` | CFDI types (I/E/P/T), PUE vs PPD, folios, cancellation motives |
| `receipts` | Sales receipts, self-invoice portal, global invoicing (EOM) |
| `clients` | Fiscal data (RFC, tax system), validation, auto-creation |
| `cobranza` | Collections/accounts receivable, PPD aging, partial payments |
| `automations` | Event-driven actions triggered by payments |
| `services` | Product/service catalog, SAT keys |
| `webhooks` | Real-time event notifications |

### Usage

```bash
gigstack context                       # List all topics
gigstack context payments              # Full knowledge on payments
gigstack context payments --short      # Summary only
gigstack context payments --json       # Machine-readable output
```

### JSON mode for agents

Every command supports `--json` for structured output that agents can parse:

```bash
gigstack status --json
gigstack clients list --json
gigstack invoices list --json --from 2026-01 --to 2026-03
```

### List endpoints return paginated envelopes

In `--json` mode, every list command returns:

```json
{ "data": [...], "has_more": false, "next": null, "total": 599 }
```

Pipe `next` back as `--next <token>` for the following page. `total` is the
unfiltered server-side count when the API provides it (otherwise null).

**Breaking change in 0.3.0**: previous versions returned a bare array. To keep
existing scripts working, migrate to reading `.data` from the response.

## Commands reference

### Status and diagnostics

```bash
gigstack status                        # Financial dashboard
gigstack status --from 2026-01         # Filter by date range
gigstack status --from 30d --to today  # Last 30 days
gigstack doctor                        # Full system diagnostics
```

The `status` command shows:
- Invoices: valid/cancelled, PUE/PPD breakdown with totals
- Payments: succeeded/pending/failed with amounts
- Receipts: pending self-invoicing vs invoiced
- Cobranza: PPD invoices with outstanding balance, aging buckets (0-15, 16-30, 31-60, 61-90, 90+ days)
- Conciliation: invoiced vs collected amounts and the difference

### Quick pay

Register a payment, auto-create the client if needed, and send the self-invoice portal.

```bash
gigstack pay                           # Interactive mode

gigstack pay \
  --email client@company.com \
  --name "Juan Perez" \
  --description "Professional services" \
  --amount 5000 \
  --iva \
  --payment-form 03

# From stdin (for agents)
echo '{"email":"client@co.com","description":"Consulting","amount":5000}' | gigstack pay --stdin --json
```

Automation options (`--automation`):

| Value | Description |
|-------|-------------|
| `pue_invoice` | PUE invoice stamped immediately (default) |
| `ppd_invoice_and_complement` | PPD invoice + payment complement |
| `none` | Record payment only, no invoice |

### Clients

```bash
gigstack clients list                  # List clients
gigstack clients get <id>              # View details
gigstack clients create                # Create (interactive)
gigstack clients update <id>           # Update (interactive or flags)
gigstack clients search "ACME"         # Search by name, RFC, or email
gigstack clients validate <id>         # Validate fiscal data against SAT
gigstack clients portal                # Generate customer portal link (interactive)
gigstack clients portal --email cli@co.com  # By email
gigstack clients portal --id client_abc     # By client ID
gigstack clients delete <id>           # Delete

# Create with flags
gigstack clients create \
  --name "Mi Empresa SA de CV" \
  --rfc MEMP850101AAA \
  --email billing@company.com \
  --tax-system 601 \
  --zip 06600
```

### Invoices

```bash
gigstack invoices list                 # List income invoices
gigstack invoices get <uuid>           # View details
gigstack invoices create               # Create (interactive or flags)
gigstack invoices cancel <uuid> --motive 02  # Cancel with SAT
gigstack invoices search "ACME"        # Search by client name, RFC, or UUID
gigstack invoices files <uuid>         # Get PDF/XML download URLs
gigstack invoices download <uuid>      # Download PDF/XML to disk
gigstack invoices send <uuid>          # Send invoice by email
gigstack invoices drafts list          # List draft pre-invoices
gigstack invoices drafts stamp <uuid>  # Stamp a draft into a real CFDI
gigstack invoices credit-notes         # List credit notes (egress invoices)
gigstack invoices complements          # List payment complements
gigstack invoices complements --invoice <uuid>  # Filter by parent PPD invoice
gigstack invoices sat list             # List CFDIs received from SAT (Descarga Masiva)
gigstack invoices sat get <uuid>       # View a SAT-downloaded invoice
gigstack invoices sat status           # Check Descarga Masiva activation status

# Create with flags
gigstack invoices create \
  --client client_abc123 \
  --items '[{"description":"Consulting","quantity":1,"unit_price":5000,"product_key":"84111506","unit_key":"E48","taxes":[{"type":"IVA","rate":0.16,"factor":"Tasa","withholding":false}]}]' \
  --payment-form 03 \
  --payment-method PUE
```

Cancellation motives: `01` = replacement, `02` = no commercial activity, `03` = wrong operation, `04` = related to global invoice.

### Payments

```bash
gigstack payments list                 # List payments
gigstack payments get <id>             # View details
gigstack payments request              # Create a payment link
gigstack payments register             # Record a payment already received
gigstack payments refund <id>          # Refund a payment

# Request payment (generates a payment link)
gigstack payments request \
  --client client_abc123 \
  --items '[{"description":"Service","quantity":1,"unit_price":3000}]' \
  --methods card,bank,oxxo \
  --send-email

# Register payment received
gigstack payments register \
  --client client_abc123 \
  --items '[{"description":"Service","quantity":1,"unit_price":3000}]' \
  --payment-form 03
```

### Services

```bash
gigstack services list                 # List product/service catalog
gigstack services get <id>             # View details
gigstack services create               # Create a service
gigstack services update <id>          # Update (interactive or flags)
gigstack services delete <id>          # Delete

# Create with flags
gigstack services create \
  --description "Monthly consulting" \
  --price 10000 \
  --product-key 84111506 \
  --unit-key E48 \
  --iva
```

### Receipts

```bash
gigstack receipts list                 # List sales receipts
gigstack receipts stamp <id>           # Stamp a receipt (generate invoice)
gigstack receipts cancel <id>          # Cancel a receipt
```

### Webhooks

```bash
gigstack webhooks list                 # List configured webhooks
gigstack webhooks create \
  --url https://example.com/webhook \
  --events invoice.created,payment.succeeded
gigstack webhooks delete <id>          # Delete a webhook
```

### Teams

```bash
gigstack teams list                    # List teams
gigstack teams get <id>                # View team details
gigstack teams integrations            # View active integrations
```

### Descarga Masiva SAT

Automated download of every CFDI the SAT has issued to or for your RFC, including invoices issued by your suppliers. Useful for compliance, expense tracking, and reconciling what your vendors actually billed you.

**Setup prerequisites:** Initial FIEL upload (.cer + .key files) and RFC registration are sensitive operations and only run from the web UI: [app.gigstack.pro/gastos](https://app.gigstack.pro/gastos). Once your FIEL is uploaded, the rest of the lifecycle (activate, list, retry, PDF) is available from the CLI.

**Pricing:**

- `$0.20 MXN` per XML downloaded (metered)
- `$400 MXN/mes` per RFC add-on (only for plans that don't already include the feature)

#### Hire the service

```bash
gigstack invoices sat status            # See activation state and next step
gigstack invoices sat activate          # Confirms pricing, then enables on your subscription
gigstack invoices sat deactivate        # Cancel (stops new downloads)
```

`status` returns one of:

| Status | Meaning |
|--------|---------|
| `active` | Already enabled; downloads are billing |
| `needs_activation` | Plan includes the feature — run `activate` (no monthly add-on cost) |
| `needs_addon` | Plan doesn't include it — `activate` adds the $400/RFC/month add-on |
| `needs_upgrade` | Free plan — upgrade required at app.gigstack.pro/billing |

#### Daily usage

```bash
gigstack invoices sat list                              # Recent downloads
gigstack invoices sat list --direction received         # Only invoices issued to you (suppliers)
gigstack invoices sat list --direction issued           # Only invoices you issued
gigstack invoices sat list --type I --status Vigente    # Filter by CFDI type and status
gigstack invoices sat list --from 2026-01 --to 2026-03  # Date range
gigstack invoices sat list --issuer-rfc XAXX010101000   # Filter by issuer RFC
gigstack invoices sat get <uuid>                        # Full detail
gigstack invoices sat retry <uuid>                      # Retry stuck/errored XML download
gigstack invoices sat pdf <uuid>                        # Generate and save PDF
gigstack invoices sat pdf <uuid> --out ./invoices       # Custom output dir
gigstack invoices sat download <uuid>                   # Convenience: PDF only; use fetch-xml for XML
```

> The CLI's `pdf` and `download` commands generate the PDF from cached XML. Use `gigstack invoices sat fetch-xml <uuid> --yes --json` for the separate XML download operation, which can charge a download credit.

#### Scheduled downloads

```bash
gigstack invoices sat schedule show                                # Current schedule + sync status
gigstack invoices sat schedule history                             # Last 20 scheduled runs
gigstack invoices sat schedule set --time 21:00 --types received --days-back 7
gigstack invoices sat schedule set --enabled false --time 21:00 --types received --days-back 7
```

`set` requires the team to already have FIEL uploaded and the RFC registered with the SAT (both done from the web UI).

### Export

Export data to CSV (default) or JSON with automatic pagination. Output goes to stdout so you can pipe or redirect it.

```bash
gigstack export invoices               # Export all invoices as CSV
gigstack export payments --format json # Export payments as JSON
gigstack export receipts --from 2026-01 --to 2026-03
gigstack export clients > clients.csv

# With filters
gigstack export invoices --status valid --from 2026-01
gigstack export payments --status succeeded --currency MXN
```

Supported entities: `invoices`, `payments`, `receipts`, `clients`.

### Forecast

Project revenue, collections risk, EOM receipts, and cash flow based on historical data.

```bash
gigstack forecast                      # This month projection (3 months ahead)
gigstack forecast --months 6           # Project 6 months ahead
gigstack forecast --json               # Structured output for agents
```

Shows:
- Revenue trend (avg monthly, growth %, projection)
- Cobranza risk (PPD aging probability, expected recovery vs likely loss)
- EOM global invoice estimate (pending receipts x historical self-invoice rate)
- Cash flow projection (pending links x conversion rate + expected PPD collections)

### Shell completions

```bash
# Bash — add to ~/.bashrc
eval "$(gigstack completions bash)"

# Zsh — add to ~/.zshrc
eval "$(gigstack completions zsh)"

# Fish — save to completions directory
gigstack completions fish > ~/.config/fish/completions/gigstack.fish
```

## Filtering and pagination

All `list` commands share these options:

| Flag | Description | Default |
|------|-------------|---------|
| `-l, --limit <n>` | Results per page (1-100) | `20` |
| `--next <token>` | Pagination cursor from previous response | — |
| `--from <date>` | Start date | — |
| `--to <date>` | End date | — |
| `--sort <dir>` | Sort direction: `asc` or `desc` | `desc` |
| `--order-by <field>` | Sort field: `timestamp` or `name` | `timestamp` |

Date formats accepted: `YYYY-MM-DD`, `YYYY-MM` (expands to full month), `30d` / `7d` (relative days), `today`.

```bash
gigstack invoices list --from 2026-01 --to 2026-03
gigstack payments list --from 30d --limit 50
gigstack receipts list --sort asc --limit 100
```

When there are more results, the CLI prints a `--next` token. Pass it to get the next page:

```bash
gigstack invoices list --limit 20
# ... shows --next abc123
gigstack invoices list --limit 20 --next abc123
```

## Global options

| Flag | Description |
|------|-------------|
| `--json` | JSON output (for scripts and agents) |
| `--team <id>` | Operate on a specific team (gigstack Connect) |
| `-h, --help` | Show help |
| `-V, --version` | Show version |

## Examples

### Check collections (cobranza)

```bash
# Quick summary with aging breakdown
gigstack status

# JSON output for processing
gigstack status --json | jq '.cobranza'

# List PPD invoices with outstanding balance
gigstack invoices list --json | jq '[.[] | select(.payment_method == "PPD" and .last_balance > 0)]'
```

### Create and send an invoice

```bash
# Interactive — walks you through client search, items, and payment method
gigstack invoices create

# Scripted — everything via flags
gigstack invoices create \
  --client client_abc123 \
  --items '[{"description":"Web development","quantity":40,"unit_price":500,"product_key":"84111506","unit_key":"HUR","taxes":[{"type":"IVA","rate":0.16,"factor":"Tasa","withholding":false}]}]' \
  --payment-form 03 \
  --payment-method PUE \
  --send-email
```

### Export a monthly report

```bash
# Invoices for March 2026
gigstack export invoices --from 2026-03 --to 2026-03 > invoices-march.csv

# All succeeded payments this year as JSON
gigstack export payments --from 2026-01 --status succeeded --format json > payments-2026.json

# Client directory
gigstack export clients > clients.csv
```

### Charge and invoice in one step

```bash
gigstack pay \
  --email client@company.com \
  --name "Client Name" \
  --description "March consulting" \
  --amount 15000 \
  --iva \
  --payment-form 03
```

### Use in CI/CD

```bash
export GIGSTACK_API_KEY=your_api_key
gigstack invoices list --json | jq '.[] | {uuid, total, status}'
gigstack status --json
```

### Agent workflow

```bash
# 1. Understand the domain
gigstack context payments --json

# 2. Get current financial state
gigstack status --json

# 3. Find a client
gigstack clients search "ACME" --json

# 4. Create an invoice
gigstack invoices create --client client_abc --items '[...]' --payment-form 03 --json
```

## Development

```bash
git clone https://github.com/disruptive-learning/gigstack-cli.git
cd gigstack-cli
npm install
npm run dev -- --help       # Run in development mode
npm run build               # Compile to dist/
```

## Links

- [API Docs](https://docs.gigstack.io)
- [App](https://app.gigstack.pro)
- [Help Center](https://helpcenter.gigstack.pro)

### Account administration and automation settings

Choose the account explicitly. `--team` (or `GIGSTACK_TEAM`) applies to every API
request, including `whoami`, diagnostics and existing commands. An explicit
account access failure never falls back to another account. Team commands with
an `<id>` reject a conflicting `--team`.

```bash
gigstack teams list --json
gigstack whoami --team team_123 --json
gigstack teams get team_123 --json
gigstack teams settings schema --json > team-settings.schema.json
gigstack teams settings get team_123 --json
gigstack teams settings update team_123 --file settings.json --json
```

Account commands return the API envelope (`data` plus any server metadata).
`settings update` accepts the full settings contract printed by `settings schema`.
Omitted fields remain unchanged; `null` clears a field, `[]` replaces an array
with an empty array, and `""` clears a string. An empty group `{}` leaves its
fields unchanged. Use the canonical API field names from the schema.

Commands accepting an object require exactly one of `--data '<json>'`,
`--file path.json`, or `--stdin`. Keep secrets in local files or stdin, rather
than shell arguments. Invalid JSON and missing input fail before sending a
request.

```bash
gigstack teams create --file team.json --json
gigstack teams update team_123 --data '{"brand":{"alias":"Mi empresa"}}' --json
gigstack teams series list team_123 --json
gigstack teams series create team_123 --data '{"series":"A","live":0,"test":0}' --json
gigstack teams series update team_123 A --file folios.json --json
gigstack teams onboarding-url team_123 --yes --json
gigstack teams portal-token team_123 --expires-in 1h --json
gigstack teams sat-connection team_123 --cert-file csd.cer --key-file csd.key --password-file csd-password.txt --json
gigstack teams sign-manifest team_123 --file manifest.json --yes --json
gigstack teams delete team_123 --yes --json
```

`sign-manifest` takes `key` and `cert` as base64 strings and `password` in the
input object. CSD upload sends multipart certificate/key files and preserves
password whitespace, removing only a final line ending. Portal tokens and
onboarding URLs should be handled as credentials. Team deletion is a scheduled
server operation, subject to its resource/integration eligibility checks.

### Members and invitations

```bash
gigstack teams members list team_123 --json
gigstack teams members add team_123 user_456 --role viewer --json
gigstack teams members update team_123 user_456 --data '{"role":"viewer","permissions":{"invoices":"viewer","payments":"none"}}' --json
gigstack teams members remove team_123 user_456 --yes --json
gigstack teams transfer-ownership team_123 user_456 --operation-id "$OPERATION_ID" --json
gigstack teams invitations list team_123 --json
gigstack teams invitations create team_123 --email person@example.com --role viewer --json
gigstack teams invitations create team_123 --email person@example.com --no-send-email --json
gigstack teams invitations get team_123 invite_123 --json
gigstack teams invitations resend team_123 invite_123 --json
gigstack teams invitations revoke team_123 invite_123 --yes --json
gigstack teams invitations accept --file invitation.json --json
gigstack teams invitations decline --file invitation.json --json
```

Ownership transfer and `members add --role admin` / `members update --data '{"role":"admin"}'`
prepare a browser approval with a required `--operation-id` UUIDv4 saved before the
first attempt. Reuse the same ID only for the identical request after a timeout.
Open `review_url` as the current team owner to review the frozen target identity,
prior role and owner before confirming. Preparation does not change membership.
Membership applies to both live and test modes (`requested_modes: []`); team
ownership transfer does not transfer billing-account ownership. Administrator
promotion cannot include permission changes in the same request. Use
`account-approvals get` or `cancel` for safe status/receipt or pending cancellation.
The CLI cannot review or execute an approval. Other roles and permission edits
retain their direct behavior. Invitations remain a separate workflow.

`members add` attaches an existing user from the same billing account; it does
not send an email invitation. Role/permission edits, removal and ownership
transfer require the current owner's user identity. Invite administration
requires an authenticated user admin. A user-scoped MCP token can be supplied
via `GIGSTACK_API_KEY`; a team API key cannot impersonate its creator. Invite
accept/decline takes `{"token":"..."}` and a Firebase ID token for the recipient,
including before they have an active team. The server remains authoritative
for role, tenant and plan checks; a 403 is returned as an error, not bypassed.

Invitations report delivery status separately from creation. A successful
create response alone does not mean an email was delivered.

### Staging, CI and machine output

Use `GIGSTACK_API_BASE_URL` or `--base-url` with the complete deployed API prefix,
including `/v2`. There is no implicit staging hostname. HTTPS is required except
for local emulators on `localhost`/`127.0.0.1`/`::1`; URL credentials, queries and
fragments are rejected. Redirects are not followed with your bearer credential.
`login` saves the selected base URL with the profile so subsequent profile use
continues against that environment. Environment credentials take precedence over
saved profiles and require the environment URL to be set explicitly.

```bash
export GIGSTACK_API_BASE_URL='https://YOUR-STAGING-GATEWAY/v2'
# Set GIGSTACK_API_KEY locally to a staging credential.
gigstack teams settings get team_123 --json
npm ci
npm run typecheck
npm test
```

In `--json` mode stdout contains the JSON result; progress and human diagnostics
use stderr. Errors return `{"error":{"message":"..."}}` and exit nonzero,
including errors from existing commands. HTTP failures include `status`.
Interactive prompts never consume piped input: provide all required values;
destructive account actions, CSD onboarding access renewal and manifest signing require `--yes` in automation.
The default request timeout is 30 seconds (`GIGSTACK_API_TIMEOUT_MS`, 1–300000).
A write timeout reports `outcome: "unknown"`; check persisted state before retrying.
The CLI never automatically retries a mutation.

The offline suite uses a local HTTP fixture and synthetic credentials. It does
not send invitations, access production, or establish deployment readiness.

### User administration and webhook changes

The existing users API is account administration. It requires admin authority for
writes; it does not grant every member a self-profile write API. Membership
changes belong to `teams members`, and invitation emails belong to
`teams invitations`. Public signup uses a different partner authentication
contract and is not exposed by these commands.

```bash
gigstack users list --team team_123 --json
gigstack users get user_456 --team team_123 --json
gigstack users create --file managed-user.json --team team_123 --json
gigstack users update user_456 --data '{"first_name":"Ana","company_role":"Contabilidad"}' --team team_123 --json
gigstack users reset-password user_456 --team team_123 --json
gigstack users issue-session user_456 --team team_123 --operation-id SAVED_UUID --json
gigstack users delete user_456 --team team_123 --yes --json
gigstack webhooks get webhook_123 --team team_123 --json
gigstack webhooks update webhook_123 --data '{"status":"inactive"}' --operation-id SAVED_UUID --expected-revision GET_REVISION --team team_123 --yes --json
```

`users delete` removes accessible team memberships and retains the login and user
profile. Inspect `removed_from_teams` for confirmed removals. `deleted: false`,
`account_deleted: false` and `account_deletion.status: not_attempted` mean identity
destruction did not happen. Complete identity deletion requires verified private
custody, complete access evidence and separate reviewed approval; this command
does not claim that capability.

`users create` accepts the v2 user fields: `email`, `first_name`, `last_name`,
`phone`, `company_role`, `address`, `auto_join` and `role` (`admin`, `editor`,
`viewer`). `users update` cannot change reserved email or membership fields.
`reset-password` sends an email. `issue-session` (also named `login-link` for
compatibility) prepares an owner-reviewed session approval and returns no bearer.
User deletion follows the server's ownership/resource checks.

### SAT credentials, request jobs and XML downloads

CSD invoicing credentials and e.firma credentials for Descarga Masiva are
separate. Upload e.firma from local files, or connect a locally prepared PFX:

```bash
gigstack invoices sat credentials fiel --cert-file fiel.cer --key-file fiel.key --password-file fiel-password.txt --phone +520000000000 --team team_123 --json
gigstack invoices sat credentials pfx --pfx-file fiel.pfx --password-file pfx-password.txt --team team_123 --json
gigstack invoices sat register --file registration.json --team team_123 --json
gigstack invoices sat sync debug --team team_123 --json
gigstack invoices sat sync progress --team team_123 --json
gigstack invoices sat sync enable --team team_123 --yes --json
gigstack invoices sat sync extend-to-maximum --team team_123 --yes --json
```

Registration uses saved e.firma when available. The current request contract
requires `phone` and `sync_start_date`, with optional `legal_name` and
`max_monthly_invoices`. The server chooses the maximum history window; the
sync-period operation always re-registers that maximum (currently 71 months),
so `extend-to-maximum` does not accept a misleading custom start-date flag.

```bash
gigstack invoices sat preview --data '{"start_date":"2026-01-01","end_date":"2026-01-31","directions":["received"]}' --team team_123 --json
gigstack invoices sat jobs list --team team_123 --json
gigstack invoices sat jobs get job_123 --team team_123 --json
gigstack invoices sat jobs cancel job_123 --team team_123 --yes --json
gigstack invoices sat request --file sat-request.json --team team_123 --yes --json
gigstack invoices sat request-status request_123 --team team_123 --json
gigstack invoices sat package package_123 --out ./sat-package.zip --team team_123 --json
gigstack invoices sat fetch-xml CFDI_UUID --team team_123 --yes --json
gigstack invoices sat import --file xml-import.json --team team_123 --yes --json
```

`preview` queues metadata discovery; its response is a job acknowledgement,
not a finished download. Poll `jobs get` for progress. `request` accepts
`start_date`, `end_date`, `request_type` (`metadata` or `cfdi`), `rfc_type`
(`issued` or `received`) and optional SAT filters from the API contract.
`package` returns the JSON/base64 ZIP envelope unless `--out` is given; file
output creates a private file and refuses to overwrite an existing path.

`fetch-xml` can charge a download credit even though the API method is GET.
It requires confirmation, and a timeout reports an unknown outcome.
`import` requires `uuids` (1–500), an explicit numeric `confirm_cost_mxn`, and
confirmation. The server recalculates cost; a mismatch returns nonzero with
`error.code: "cost_mismatch"` and the current estimate in `error.details`.
Review and explicitly confirm the new amount before retrying; the CLI never
silently accepts a changed cost. Cancelling a job does not undo completed
work or charges. `teams onboarding-url --yes` likewise acknowledges a
mutation: generating the link refreshes the CSD portal password/challenge.

### Flujos y Google Sheets

`journeys` ofrece `list`, `catalog`, `get`, `create`, `update`, `delete`, `publish`,
`pause`, `clone`, `test` y `runs`. `journey-groups` ofrece `list`, `get`, `create`,
`update`, `clone`, `revert`, `publish` y `pause`. Usa `--file`, `--stdin` o `--data`
para los cuerpos JSON; los comandos de lectura conservan el sobre de paginación.
La credencial determina el ambiente del recurso. El campo `targetLivemode` de
`clone` selecciona el ambiente de la copia, que siempre comienza como borrador.

```bash
gigstack journeys catalog --team TEAM_ID --json
gigstack journeys create --file journey.json --team TEAM_ID --json
gigstack journeys publish JOURNEY_ID --yes --team TEAM_ID --json
gigstack journey-groups get GROUP_ID --team TEAM_ID --json
gigstack journey-groups update GROUP_ID --file group-edit.json --yes --team TEAM_ID --json
```

Al editar un grupo, `journeys` es la lista completa del resultado: los flujos
omitidos se archivan. Incluye `expectedLastUpdated` con el `last_updated` leído
por `get`, también al usar `revert`. Ante `409 group_changed`, vuelve a leer y
revisa los cambios antes de intentar otra vez. La publicación y pausa de grupos
operan por flujo: si alguno falla, la CLI conserva todos los resultados y sale
con código `1`. No repitas automáticamente la operación completa.

`sheets` ofrece `status`, `fields payment|invoice`, `headers`, `rows`, `connect`,
`mapping`, `preview`, `enable`, `pause`, `sync` y `disconnect`.

```bash
gigstack sheets status --team TEAM_ID --json
gigstack sheets fields payment --team TEAM_ID --json
gigstack sheets connect --file sheet-connection.json --yes --team TEAM_ID --json
gigstack sheets mapping --file sheet-mapping.json --team TEAM_ID --json
gigstack sheets preview --team TEAM_ID --json
gigstack sheets enable --yes --team TEAM_ID --json
```

`connect` recibe `{ "url": "https://docs.google.com/spreadsheets/d/ID/edit" }`,
y opcionalmente `sheet_name`, `header_row` (1–50) y `copy_from_other`. Requiere
una credencial de usuario Firebase/MCP cuyo correo tenga acceso directo de
propietario/editor en Drive. Una clave API/OAuth puede gestionar una conexión
existente y conserva al usuario que autorizó la importación. El importador
vuelve a comprobar los permisos de ese usuario al procesar filas.

`mapping` recibe `target` (`payment` o `invoice`), `fields` (ruta de campo a
`{column}` o `{value}`) y `poll_interval_minutes` opcional (2 o 5). Guardarlo
pausa la importación. `preview` valida sin crear documentos; `enable` y `sync`
pueden iniciar la creación de documentos y requieren `--yes` sin terminal
interactiva. `headers` actualiza la caché de encabezados. `rows` y `journeys runs`
devuelven las últimas 50 entradas, sin cursor.

### Perfil personal, notificaciones y credenciales

`me` usa la identidad actual de un usuario Firebase o MCP verificado. Las claves
API de equipo y los tokens OAuth no pueden actuar como su creador. Los comandos
`users` siguen siendo administración de usuarios; el perfil propio está en `me`.

```bash
gigstack me get --json
gigstack me update --data '{"first_name":"Ana","company_role":null}' --json
gigstack me preferences get TEAM_ID --json
gigstack me preferences update TEAM_ID --data '{"testmode":false}' --json
gigstack me active-context --data '{"team_id":"TEAM_ID"}' --json
gigstack me notifications list --limit 50 --json
gigstack me notifications unread-count --json
gigstack me notifications read RECIPIENT_ID --json
gigstack me notifications dismiss RECIPIENT_ID --json
gigstack me notifications read-all --yes --json
gigstack me mcp-tokens list --json
gigstack me mcp-tokens revoke MCP_KEY_ID --yes --json
```

El perfil admite `first_name`, `last_name`, `phone`, `country` (tres letras
mayúsculas) y `company_role`; `null` borra el campo. El correo y su verificación
se leen de Firebase Auth y no se cambian con este comando. Preferencias admite
`testmode`, `search_collection` e `invoices_order_by` con `null` para restablecer.
Notificaciones y webhooks usan `--cursor` con el `next_cursor` recibido.

Las claves API requieren un usuario que sea administrador actual del equipo o
su cuenta de facturación. `create` y `rotate` ahora **preparan una aprobación**;
no emiten credenciales. La persona abre `review_url`, inicia sesión de nuevo si se
solicita y confirma la acción exacta en el navegador. Sólo ese navegador recibe
los secretos. Los antiguos `--out`, `--yes` de emisión y `--accept-terms` ya no se
aceptan: la CLI imprime únicamente estado, enlace de revisión y recibo de metadatos.

Guarda un UUIDv4 antes de cada solicitud nueva. Tras una respuesta incierta,
reutiliza ese mismo `--operation-id` y contenido exacto; no generes otro ID como
reintento. No hay reintento automático. Un ID reutilizado con otros datos falla.

```bash
gigstack api-keys list --team TEAM_ID --json
gigstack api-keys create --team TEAM_ID --operation-id UUID_GUARDADO --json
gigstack api-keys rotate --team TEAM_ID --operation-id OTRO_UUID_GUARDADO --json
gigstack account-approvals get APPROVAL_ID --json
gigstack account-approvals cancel APPROVAL_ID --yes --json
gigstack api-keys revoke API_KEY_ID --team TEAM_ID --yes --json
gigstack api-keys emergency-revoke --team TEAM_ID --yes --json
```

`pending` significa que falta revisión humana; `completed` confirma el resultado
mediante un recibo sin secretos. Cancelar sólo afecta solicitudes pendientes y no
revoca claves ya emitidas. El agente no puede revisar, aceptar términos, ejecutar
ni recuperar secretos de una aprobación. Abre el enlace sólo en el origen de la
aplicación configurado para tu entorno y verifica equipo, modo y consecuencias.

`emergency-revoke` invalida todas las claves API **y tokens MCP asociados al equipo**,
incluida la credencial actual si corresponde; OAuth permanece activo. La rotación
aprobada conserva tokens MCP. El listado puede devolver `data:[]` con `has_more:true`:
continúa con `--cursor` hasta terminar.

Para preparar un token MCP personal, indica nombre, equipo inicial y modo. El usuario
acepta los términos en el navegador; el equipo inicial no limita su acceso personal.

```bash
gigstack me mcp-tokens create \
  --data '{"name":"Mi integración","team_id":"TEAM_ID","livemode":false}' \
  --operation-id UUID_GUARDADO --json
```

### Carga fiscal privada en navegador

El agente puede crear, leer, cancelar o conciliar una sesión y consultar el estado fiscal. Los archivos, contraseñas, consentimiento del manifiesto y liberación de resultados inciertos se manejan en el navegador autenticado del propietario:

```bash
gigstack teams fiscal status TEAM_ID --json
gigstack teams fiscal sessions create TEAM_ID --purpose csd --yes --json
gigstack teams fiscal sessions get TEAM_ID SESSION_ID --json
gigstack teams fiscal sessions reconcile TEAM_ID SESSION_ID --yes --json
gigstack teams fiscal sessions cancel TEAM_ID SESSION_ID --yes --json
```

`--purpose` admite `csd`, `fiel`, `pfx` o `manifest`. Abre `data.upload_url` con la cuenta propietaria que creó la sesión. `--yes` solo confirma crear/cancelar/conciliar la sesión: no sustituye el consentimiento de la persona que carga o firma. La configuración es compartida entre modo prueba y real; `provider_environment` indica si el proveedor opera en producción. `outcome_unknown` no confirma éxito ni autoriza repetir la carga. `reconcile` consulta evidencia de esa operación sin volver a enviar archivos; la liberación requiere consentimiento explícito en navegador después del plazo indicado por el servidor. No hay comandos de sesión `submit` ni `resolve`.

### Catálogo y ajustes de integraciones

```bash
gigstack integrations catalog TEAM_ID --json
gigstack integrations get TEAM_ID stripe --json
gigstack integrations stripe schema --json
gigstack integrations stripe settings TEAM_ID --data '{"automatic_invoicing":false,"test_only":true}' --yes --json
gigstack integrations bank settings TEAM_ID --file bank-settings.json --yes --json
```

Hay comandos `schema` y `settings` para `stripe`, `adyen`, `paypal`, `conekta`, `openpay`, `clip`, `clockpms`, `pagoralia`, `dlocal`, `woocommerce`, `mercadopago`, `shopify` y `bank`. El esquema local limita los campos admitidos y conserva `false`, cadenas vacías y `null` donde el API lo permite. Se requiere `--yes` para ajustes compartidos. El servidor sigue validando rol, cuenta y disponibilidad regional.

El catálogo incluye 25 proveedores y distingue su disponibilidad y alcance. Leer estado almacenado no confirma conectividad remota. Estos ajustes no guardan API keys/contraseñas, no completan conexiones y no aceptan `completed:true`. Las operaciones particulares de proveedores y sus requisitos de identidad se documentan por separado.

### NetSuite y PayPal POS (Zettle)

Estas operaciones requieren identidad de usuario Firebase o MCP personal; una API key de equipo/OAuth no representa a su creador. El servidor conserva los permisos de integración/factura y comprueba equipo y modo.

```bash
gigstack integrations zettle status TEAM_ID --json
gigstack integrations zettle settings TEAM_ID --data '{"automaticInvoicing":false,"cardPaymentForm":"28"}' --yes --json
gigstack integrations zettle sync TEAM_ID --yes --json
gigstack integrations zettle disconnect TEAM_ID --yes --json
gigstack integrations netsuite status TEAM_ID --json
gigstack integrations netsuite ping TEAM_ID --yes --json
gigstack integrations netsuite invoices status TEAM_ID INVOICE_ID --json
gigstack integrations netsuite invoices sync TEAM_ID INVOICE_ID --yes --json
gigstack integrations netsuite invoices resync TEAM_ID INVOICE_ID --yes --json
gigstack integrations netsuite syncs TEAM_ID --before 123_SYNC_ID --json
gigstack integrations netsuite disconnect TEAM_ID --yes --json
```

`queued`/`enqueued` confirma encolado, no finalización. Un timeout puede haber cambiado pasos locales: consulta el estado antes de repetir. Reencolar con `resync` una factura pagada elimina y recrea su pago aplicado en NetSuite por el total actual. POS en modo prueba consulta compras reales del comercio. Sus revisiones y el resumen NetSuite muestran solo las primeras 20 filas. El historial NetSuite entrega páginas de 50 y conserva `nextBefore`/`truncated` de la consulta acotada; no afirma ser historia completa.

POS desconectado puede devolver `partial_cleanup:true` y `remote_removed:false`: el CLI conserva ese resultado y sale con código 1. NetSuite desconectado devuelve `credentials_retained:true`; desactivar una conexión no borra sus credenciales cifradas.

```bash
gigstack integrations netsuite items get TEAM_ID --json
gigstack integrations netsuite items preview TEAM_ID --file rule-preview.json --yes --json
gigstack integrations netsuite items save-rule TEAM_ID --file reviewed-rule.json --yes --json
```

El mapeo de artículos es compartido. `items get` lee la configuración sin consultar al proveedor; preview y guardado consultan el catálogo **live**, incluso con una credencial de prueba. Preview acepta `{rule,days?}`; `rule` contiene `match`, `matchType` (`exact`/`contains`), `itemId` como cadena numérica y opcionalmente `refundItemId`/`scope` (`domestic`/`foreign`). `days` admite 1–180. Guardar exige el `previewToken` vigente y la misma regla/ventana revisada. Mover líneas existentes exige `confirmChanges:true` explícito en el JSON; `--yes` no lo agrega. Un 409 requiere leer el estado y repetir el preview, no reutilizar una revisión obsoleta.

### Cuenta de facturación y suscripción

```bash
gigstack billing summary TEAM_ID --json
gigstack billing plans TEAM_ID --json
gigstack billing history TEAM_ID --limit 20 --json
gigstack billing history TEAM_ID --cursor CURSOR --json
gigstack billing fiscal get TEAM_ID --json
```

Requiere usuario Firebase o MCP personal. Leer conserva permisos de miembro; los cambios requieren administración de la cuenta de facturación. Los efectos son compartidos por toda esa cuenta. El ambiente lo determina el servidor y la configuración de facturación; una credencial de prueba no selecciona por sí sola sandbox. Las fechas del proveedor están en segundos y los importes en unidades menores; los tiempos de operaciones están en milisegundos. `history` conserva `data.has_more` y `data.cursor`.

Cada cambio exige un **UUID v4 elegido una sola vez**, un diario local y confirmación:

```bash
# Genera una sola vez y conserva el ID junto a los parámetros revisados.
uuidgen
# Sustituye OPERATION_UUID por ese mismo UUID, también al reintentar.
gigstack billing checkout TEAM_ID --operation-id OPERATION_UUID --operation-file ./checkout-operation.json --file checkout.json --yes --json
gigstack billing upgrade TEAM_ID --operation-id OPERATION_UUID --operation-file ./upgrade-operation.json --file upgrade.json --yes --json
gigstack billing portal TEAM_ID --operation-id OPERATION_UUID --operation-file ./portal-operation.json --data '{"intent":"cancel_subscription"}' --yes --json
gigstack billing fiscal update TEAM_ID --operation-id OPERATION_UUID --operation-file ./fiscal-operation.json --file billing-fiscal.json --yes --json
```

Usa un UUID/diario distinto para cada **operación nueva**; los ejemplos no se ejecutan todos con un mismo UUID. El CLI nunca genera un ID nuevo durante un reintento. El diario se escribe y sincroniza antes del cambio, con permisos `0600`; guarda ID/equipo/cuenta/ambiente/URL base y SHA-256 del contenido, sin datos fiscales, credenciales ni enlaces de Checkout/Portal. Rechaza cambios de cuerpo, equipo, cuenta, ambiente o API para un diario existente. Al repetir un comando idéntico consulta primero la operación: si existe, devuelve su estado sin reenviar el cambio. Si no existe (404), puede enviar el cuerpo original con el **mismo ID**. Una respuesta no recibida conserva `operation_reference.id` y el diario; no se reintenta automáticamente.

Checkout acepta `plan_id`, `billing_cycle` (`monthly`/`annual`) y opcionalmente `plan_version`, `quantity` (1–10000), `intro`, `trial_id`, `partner_ref`, `coupon`; `intro:true` y `trial_id` son excluyentes. Upgrade admite `plan_id`, `billing_cycle`, `quantity` y puede generar una factura prorrateada inmediata. Checkout gratuito se aplica inmediatamente; Checkout de pago entrega un enlace que la persona debe completar. Portal admite `intent` (`manage`, `cancel_subscription`, `update_payment_method`); crear el enlace **no** confirma que se canceló la suscripción o cambió la tarjeta. Trata los enlaces devueltos como privados.

La actualización fiscal usa `{fiscal:{legal_name,rfc,tax_system,use,email?,phone?,address:{zip,street?,exterior?,interior?,neighborhood?,municipality?,city?,state?,country?}}}`. Los campos opcionales admiten `null`; ZIP debe ser una cadena de cinco dígitos. No incluyas `operation_id` en ese JSON: se toma exclusivamente de `--operation-id`.

```bash
gigstack billing operations get TEAM_ID OPERATION_UUID --json
gigstack billing operations reconcile TEAM_ID OPERATION_UUID --json
```

`processing` y `handoff_ready` describen estados pendientes, no finalización. `failed` y `outcome_unknown` salen con código 1 y conservan el resultado/error de la operación. `reconcile` consulta evidencia sin repetir cargos ni escrituras del proveedor. `stripe_synced:false` conserva un guardado fiscal parcial. La liberación de un resultado incierto requiere inicio de sesión Firebase y reconocimiento humano explícito; no hay comando de agente `resolve`.

### Documentos, archivos de respaldo y complementos de pago

```bash
gigstack documents list --team TEAM_ID --limit 50 --document-type contract --json
gigstack documents list --team TEAM_ID --limit 50 --document-type contract --cursor NEXT_CURSOR --json
gigstack documents get DOCUMENT_ID --team TEAM_ID --json
gigstack documents upload --team TEAM_ID --file ./contract.pdf --document-type contract --name Contrato --yes --json
gigstack documents create --team TEAM_ID --file stored-document.json --yes --json
gigstack documents update DOCUMENT_ID --team TEAM_ID --data '{"description":null,"tags":[]}' --yes --json
gigstack documents link DOCUMENT_ID --team TEAM_ID --entity-type client --entity-id CLIENT_ID --yes --json
gigstack documents unlink DOCUMENT_ID --team TEAM_ID --entity-type client --entity-id CLIENT_ID --yes --json
gigstack documents analyze DOCUMENT_ID --team TEAM_ID --yes --json
gigstack documents delete DOCUMENT_ID --team TEAM_ID --yes --json
```

La lista conserva `data.data`, `data.has_more` y `data.next_cursor`. Una página vacía con `has_more:true` requiere seguir iterando; el cursor está ligado al equipo, modo y filtros. Hay filtros `--document-type`, `--compliance-status`, `--entity-type` y `--entity-id`. Las lecturas y enlaces respetan el modo de la credencial; no se cambia mediante el cuerpo.

`upload` acepta archivos locales PDF/PNG/JPG/JPEG/WEBP hasta 10 MiB; no descarga una URL remota. El tipo independiente admite `contract`, `delivery_proof`, `payment_proof` o `communication`. `create` registra un archivo ya guardado: requiere `documentType`, `name`, `fileUrl`, `storagePath`, `fileName` en camelCase; permite `description`, `fileSize`, `mimeType`, `linkedEntities`, `validFrom`, `validUntil`, `tags`, `metadata`. El servidor exige una ruta `teams/TEAM_ID/live|test/support-documents/...` y URL correspondiente a su bucket. El namespace compartido antiguo `sat_documents` queda reservado al navegador Firebase. Se recomienda `upload` cuando el archivo todavía está en tu equipo.

Los campos de `update` son `name`, `description`, `complianceStatus`, `complianceNotes`, `validFrom`, `validUntil`, `tags`, `metadata`; se preservan nulos y colecciones vacías. `delete` es eliminación lógica y no afirma borrar el objeto de Storage. El análisis IA se pide por separado con `analyze`; subir/registrar no lo inicia y el CLI rechaza el antiguo flag inoperante `analyzeWithAI`. Trata los enlaces privados devueltos como datos de acceso al documento.

```bash
gigstack clients support-documents list CLIENT_ID --team TEAM_ID --json
gigstack clients support-documents upload CLIENT_ID --team TEAM_ID --file ./proof.pdf --document-type contract --yes --json
gigstack payments support-documents list PAYMENT_ID --team TEAM_ID --json
gigstack payments support-documents upload PAYMENT_ID --team TEAM_ID --file ./proof.pdf --document-type payment_confirmation --yes --json
gigstack invoices support-documents list INVOICE_ID --team TEAM_ID --json
gigstack invoices support-documents upload INVOICE_ID --team TEAM_ID --file ./proof.pdf --document-type delivery_proof --yes --json
gigstack invoices payment-get PAYMENT_COMPLEMENT_ID --team TEAM_ID --json
```

Los respaldos vinculados admiten además `payment_confirmation` y `subscription_info`, con `--name`/`--description` opcionales. Sus listas conservan la respuesta completa y no ofrecen cursor. `invoices payment-get` lee un CFDI tipo P (complemento de pago), no una factura de ingreso ni una lista de cobros relacionados.


Para expirar un Checkout que todavía está abierto, conserva un **nuevo** UUID y diario distintos del Checkout original:

```bash
gigstack billing operations cancel-checkout TEAM_ID CHECKOUT_OPERATION_ID --operation-id NEW_UUID_V4 --operation-file ./checkout-cancel.json --yes --json
gigstack billing operations get TEAM_ID NEW_UUID_V4 --json
gigstack billing operations reconcile TEAM_ID NEW_UUID_V4 --json
```

El diario vincula la cancelación al Checkout original y a la cuenta/ambiente real. Reutilizar el mismo diario consulta primero el nuevo UUID. Un resultado `outcome_unknown` sale con código 1; consulta o concilia ese UUID antes de otra acción. Solo la expiración confirmada cancela el Checkout. Si ya fue completado, la cancelación falla y la suscripción se administra en el portal de facturación.

### Complete request bodies and core resource actions

The commands below accept exactly one of `--file`, `--stdin`, or `--data`, plus `--yes` for a JSON mutation. The CLI checks that the input is a JSON object and sends it unchanged to the named endpoint; the server validates its fields and current permissions. Do not combine JSON input with individual payload flags. Existing flag defaults do not overwrite a JSON body.

```bash
gigstack clients create --file colombia-client.json --yes --json
gigstack clients update CLIENT_ID --data '{"phone":null,"metadata":{}}' --yes --json
gigstack invoices create --file invoice.json --yes --json
gigstack payments request --file payment-request.json --yes --json
gigstack payments register --file received-payment.json --yes --json
gigstack payments update PAYMENT_ID --file payment-changes.json --yes --json
gigstack payments paid PAYMENT_ID --data '{"payment_form":"03"}' --yes --json
gigstack payments refund PAYMENT_ID --data '{"reason":"duplicate","amount":10}' --yes --json
gigstack payments cancel PAYMENT_ID --yes --json
gigstack payments search 'example' --page 2 --limit 10 --status pending --json
```

Use the endpoint's exact field names, including country-specific fields, nested invoice settings and explicit delivery/automation choices. For payment request/register, retain a caller-selected `idempotency_key` in the JSON, or use `--idempotency-key` with flag input. The CLI no longer invents a timestamp-based key. It never retries a write automatically; after an uncertain response, read the resource before deciding whether to repeat the request. A refund requires a body with `reason` and `amount`; `external_processor_refund` remains an explicit optional choice.

```bash
gigstack receipts get RECEIPT_ID --json
gigstack receipts search 'example' --page 2 --json
gigstack receipts create --file receipt.json --yes --json
gigstack receipts reopen RECEIPT_ID --data '{"reason":"Client details corrected"}' --yes --json
gigstack invoices drafts get DRAFT_ID --json
gigstack invoices drafts create --file draft.json --yes --json
gigstack invoices drafts update DRAFT_ID --file draft-changes.json --yes --json
gigstack invoices drafts preview DRAFT_ID --yes --json
gigstack invoices drafts delete DRAFT_ID --yes --json
gigstack invoices credit-note-create --file credit-note.json --yes --json
gigstack invoices credit-note-get CREDIT_NOTE_ID --json
gigstack invoices complement-create --file payment-complement.json --yes --json
gigstack invoices transfer-create --file transfer.json --yes --json
gigstack invoices transfer-get TRANSFER_ID --json
gigstack invoices transfers --next CURSOR --json
gigstack clients upload-csf --file ./csf.pdf --client CLIENT_ID --yes --json
gigstack clients stamp-pending-receipts CLIENT_ID --yes --json
```

These new commands preserve the complete API response. Search uses `page`/`per_page`/`found`; list cursors follow the specific endpoint's returned fields. Draft update uses the complete intended body: omitted items are cleared and omitted fields can receive defaults. Read back and compare the draft before stamping. A preview returns its PDF content in the response and does not stamp the draft. CSF upload accepts a local PDF up to 5 MiB, consults SAT fiscal details and creates a client when `--client` is omitted. Pending-receipt stamping processes at most 100 receipts per call: inspect `remaining`, and treat `failed > 0` as a partial result (exit code 1). No command claims that all receipts completed merely because HTTP returned 200.

### Shared branding, portal links and email DNS

```bash
gigstack branding get TEAM_ID --json
gigstack branding update TEAM_ID --data '{"voice":null,"primary_color":"#123456"}' --yes --json
gigstack branding portal get TEAM_ID --json
gigstack branding portal set TEAM_ID --data '{"slug":"newname","expected_slug":"oldname","confirm_existing_links_change":true}' --yes --json
gigstack branding upload-logo TEAM_ID --file ./logo.png --yes --json
gigstack branding analyze-voice TEAM_ID --url https://example.com --yes --json
gigstack email-domain get TEAM_ID --json
gigstack email-domain set TEAM_ID --domain example.com --subdomain mail --operation-id UUID_V4 --operation-file ./email-setup.json --yes --json
gigstack email-domain validate TEAM_ID --operation-id NEW_UUID_V4 --operation-file ./email-validate.json --yes --json
gigstack email-domain operations get TEAM_ID UUID_V4 --json
gigstack email-domain operations reconcile TEAM_ID UUID_V4 --json
```

These commands require an authenticated person with current team authority. Branding, portal links and email DNS affect the whole team across live/test modes. Portal renaming changes existing customer links and requires the current slug plus the separate JSON acknowledgment. Voice analysis uses the AI provider but does not save its result. Logo uploads accept PNG/JPEG up to 10 MiB; read `storage_cleanup` for retained historical objects.

Email-domain writes use the configured SendGrid account; test mode and a staging API URL do not guarantee a separate provider account. Set, validate and remove require a caller-selected UUID and private 0600 journal. Reuse the same journal for the same request: the CLI reads the stored operation before considering a write. Replacing a domain may retain its previous SendGrid resource, and completed setup does not mean DNS is valid.

On `outcome_unknown`, the CLI preserves the operation ID and exits 1. Read or reconcile that exact ID; do not blindly create another operation. After the server's ten-minute recovery deadline, a current administrator can explicitly release the lock:

```bash
gigstack email-domain operations resolve TEAM_ID UUID_V4 --acknowledge-unconfirmed-effects --yes --json
```

Release does not undo or delete a possible provider effect and leaves the original outcome unknown. It only permits a new reviewed operation. Removing the configured domain uses `email-domain remove` with its own new UUID, journal and `--yes`.

Income batches use `invoices batch create --file batch.json --idempotency-key <saved-key> --yes`.
Save and reuse that header key only with the identical request; each invoice also retains its
own `idempotency_key`. A queued batch is not confirmation of stamping. Read `batch get <id>`
and `batch items <id> --next <cursor>`; the item page preserves `data.next` and `data.has_more`.
Partial failures, rejected items and outcomes needing review exit nonzero while retaining JSON.

`invoices import-xml --file held-cfdis.json --yes` accepts the API's `{files:[{filename,xml}]}`
or base64 `content` format (up to 50 files). It preserves all per-file outcomes and exits nonzero
if any file is not imported. `invoices errors --q <text> --page <n>` reads the CFDI error catalog;
it is not a queue of failed invoices belonging to your team.

### Provider connection handoffs

```bash
gigstack integrations setup create TEAM_ID --provider airtable --yes --json
gigstack integrations setup get TEAM_ID SESSION_ID --json
gigstack integrations setup reconcile TEAM_ID SESSION_ID --json
gigstack integrations setup cancel TEAM_ID SESSION_ID --yes --json
```

The initial setup adapters are `airtable`, `mercadolibre`, `netsuite`, and `zettle`. Creating a session returns an authenticated `completion_url`; a person opens it, reviews the returned disclosures and submits OAuth consent or private credentials in the browser. No provider password, key or OAuth authorization URL belongs in CLI arguments. A created session is not a completed connection.

Read the returned `effect_scope` and `credential_livemode`: Airtable/MercadoLibre credentials are shared by the team, NetSuite selects a credential environment, and Zettle's mode selects imports for its connection. Current user permissions and entitlements are checked by the server. An existing session lock must be inspected before starting another. Cancellation applies to pending/expired sessions and does not disconnect an established provider.

Unknown or failed sessions preserve their full state and exit 1. Reconcile reads evidence without replaying the provider call. Explicit recovery and credential resubmission happen in the browser; there are no CLI submit/resolve commands.

`invoices eom-run --yes` starts the existing live end-of-month global-invoicing workflow.
The backend accepts it only in production, on the month's final day before 23:00 in
America/Mexico_City; staging, emulators and test credentials are refused. An accepted
response does not confirm stamping or validation. There is no idempotency key for this
legacy action: read the resulting records before deciding whether an interrupted run
needs another request, and never retry automatically.

### API and webhook delivery logs

```bash
gigstack logs api list TEAM_ID --method POST --status 5xx --limit 50 --json
gigstack logs api get TEAM_ID LOG_ID --json
gigstack logs webhooks list TEAM_ID --event invoice.created --status failed --json
gigstack logs webhooks get TEAM_ID LOG_ID --json
```

Lists return `has_more` and `next_cursor`. Follow the cursor with the same team, credential mode, limit and filters, even when the page has no matching rows. Optional `--from`/`--to` accept inclusive epoch milliseconds. `--endpoint` matches a redacted API route prefix; variable path segments appear as `:id`.

These reads preserve log metadata and bounded body structure while withholding historical body values, headers, credentials and private URLs. They are not raw payload exports. Missing-mode webhook records are excluded; collection retention limits available history. Pending and unknown deliveries are not success. The delivery log ID is the web's log identifier, and `retry_requested` only reports a request flag. Reading a failed delivery does not resend it.

### Administrator invitation approvals

```bash
gigstack account-invitations prepare-team TEAM_ID --email person@example.com --operation-id UUID_V4 --send-email --json
gigstack account-invitations prepare-billing BILLING_ACCOUNT_ID --email person@example.com --operation-id UUID_V4 --no-send-email --json
gigstack account-invitations prepare-team TEAM_ID --email person@example.com --existing-invitation INVITE_ID --operation-id UUID_V4 --no-send-email --json
gigstack account-invitations get INVITE_ID --json
gigstack account-invitations revoke INVITE_ID --yes --json
gigstack account-invitations resend INVITE_ID --yes --json
```

Preparation requires an explicit send choice and a caller-persisted UUIDv4. It
returns a review URL without sending or granting access. Preserve the same UUID
and exact payload after an uncertain prepare response. Team invitations require
the current team owner; billing invitations require the canonical billing-account
owner. `--team` remains credential context and never substitutes for the explicit
billing-account argument. The existing `teams invitations create` command also
prepares approval for `--role admin` with `--operation-id` and an explicit
`--send-email` or `--no-send-email`; editor/viewer creation retains its direct flow.

The owner opens the private review URL and confirms the frozen recipient, scope,
expiry and send choice after signing in recently. Recovering an existing pending
admin invitation requires `--no-send-email` and preserves its original expiry.
Completed approval means invitation recorded, not email delivered or recipient
joined. There are no CLI review/execute commands or invitation-token outputs.

Owner read/revoke/resend use the invitation's stored scope. Revoke cancels a pending
invitation; it does not remove a member. Unknown/failed delivery exits 1 with safe
metadata. Read status before deciding to resend: an earlier email may already have
arrived. Only after that explicit decision, use
`account-invitations resend INVITE_ID --acknowledge-unconfirmed-delivery --yes --json`.
Transport failures exit 1 without automatic retries or raw provider messages.
The older `teams invitations resend` command is for editor/viewer invitations;
use `account-invitations resend` for administrator invitations after approval.

### Managed administrator creation (coordinated release)

Use a personal Firebase/MCP credential belonging to both the canonical team owner
and billing-account owner. Save a UUIDv4 before preparing the request:

```sh
gigstack users create-admin --team TEAM_ID --operation-id SAVED_UUID --data '{"email":"managed@example.test","first_name":"Managed"}' --json
gigstack account-approvals get APPROVAL_ID --json
gigstack account-approvals reconcile APPROVAL_ID --json
```

Open `review_url` to review disabled identity creation and its bootstrap records.
After `activation_required`, return there for a second review before membership is
granted and Auth enabled. Preparation/reconciliation issue no credentials or email.
Unknown outcomes exit nonzero and must not trigger another creation or activation;
read evidence with `reconcile` and preserve the approval ID for operator recovery.
The CLI has no review/execute/continue terminal. Password-reset delivery and
deletion still require the separate security migration.

`users create` remains available for viewer/editor creation; `role:admin` points to
`users create-admin`. If team and billing owners differ, create a nonadmin identity
first, then use the existing owner-reviewed promotion. Direct nonadmin creation is
not idempotent: preserve the returned reference after `managed_creation_unconfirmed`.

### Managed session access and revocation

```sh
gigstack users issue-session USER_ID --team TEAM_ID --operation-id SAVED_UUID --json
gigstack users revoke-sessions USER_ID --team TEAM_ID --operation-id DIFFERENT_SAVED_UUID --json
gigstack account-approvals get APPROVAL_ID --json
```

Both commands prepare an action for the current owner to review at `review_url`.
They require a personal credential and complete current authority over the managed
identity's reachable teams and billing account. Preparation neither issues a
session nor revokes one. The review discloses the full Firebase identity, both
modes, connected master-team grants, and prior issued/unknown attempts.

Only the first successful browser execution may deliver a custom-token handoff,
for deliberate use in a separate private browser context. No token or login link
is returned by CLI. `users login-link` is a preparation alias and now requires
`--operation-id`; the old direct mint request is not used.

The custom-token deadline limits exchange, not the life of a redeemed session.
Revocation affects refresh tokens across devices; it does not cancel outstanding
custom tokens or guarantee immediate refusal by ID-token consumers that do not
check revocation. Unknown outcomes exit nonzero and stay unknown. Preserve the
approval ID, read its metadata, and never automatically repeat issuance/revocation.
Backend configuration and its complete-grant indexing gate must be satisfied
before rollout; this adapter does not establish production readiness.

### Airtable: conexión compartida e importaciones por modo

`integrations airtable` ofrece `bases`, `tables`, `webhooks list|remote|register|unregister`,
`disconnect` y `operations get|reconcile`. Requiere usuario personal Firebase/MCP; una
clave de equipo no representa a su creador. Airtable siempre es el proveedor real: el modo
prueba distingue los registros importados, no otra cuenta externa. `webhooks list --scope
shared` muestra explícitamente ambos modos y registros antiguos con autoridad de configuración.
Sigue `next_cursor` cuando `has_more` sea verdadero, incluso si `data` está vacío.

Las escrituras reciben JSON con `operation_id` UUIDv4 estable y `confirmed:true`, además de
`--yes` o confirmación interactiva. No se genera un UUID nuevo automáticamente. Consulta
`integrations airtable schema register|unregister|disconnect` para el cuerpo completo;
`disconnect` exige `acknowledge_shared_connection:true` y puede requerir continuaciones
explícitas con el mismo UUID e idéntico cuerpo. Una respuesta incierta/parcial conserva el
recibo y termina con código 1. `operations reconcile` consulta evidencia, sin repetir
creaciones ni borrados remotos. No confunde `processing` con finalización.

El modo se deriva del JWT seleccionado y se envía como afirmación `expected_livemode`,
nunca como cambio de modo. Para credenciales sin ese campo, proporciona `--expected-mode
live|test`; el servidor verifica su contexto. Una discrepancia se rechaza. No pongas
`expected_livemode`, tokens o credenciales del proveedor en el JSON.

La recuperación de un refresh incierto usa `integrations setup create <teamId> --provider
airtable --recovery-operation-id <UUID-original> --acknowledge-unconfirmed-effects --yes`.
Cada llamada confirmada desactiva hasta 100 suscripciones locales de ambos modos. Si el
snapshot está incompleto, revisa el avance y confirma otra llamada; nunca hagas un bucle
sin revisión. La persona creadora abre `completion_url`, revisa y autoriza en el navegador.
OAuth completado puede devolver `connected:false`: restauró acceso limitado para inspección
/limpieza, no las importaciones. Solo identidad verificada coincidente permite una nueva
limpieza reconocida con UUID nuevo y `recovery_operation_id`; el resultado incierto original
permanece. La conexión ordinaria posterior requiere nuevo consentimiento humano. No se
aceptan ni imprimen MACs, secretos o tokens de Airtable. Una identidad anterior no verificable
permanece explícitamente sin verificar.

Estas funciones están implementadas y probadas sin llamadas a proveedores; consulta el estado
de despliegue del backend antes de usarlas. No implican paridad completa de otros proveedores.

Manual webhook delivery uses named commands:

```bash
gigstack webhooks test TEAM ENDPOINT --stdin --yes
gigstack webhooks resend-current TEAM ENDPOINT --stdin --yes
gigstack webhooks retry TEAM LOG_ID --stdin --yes
gigstack webhooks operation TEAM OPERATION_UUID --json
gigstack webhooks manual-schema test
```

The write JSON must contain a persisted UUID `operation_id` and `confirmed:true`.
Test/current-event inputs also require `event` and `resource_id`; retry/current
resend require `acknowledge_duplicate_delivery:true`. Team and endpoint/log come
from the positional arguments, and mode is asserted from the credential (or an
explicit `--expected-mode live|test` for a credential without mode). JSON cannot
override those selectors. Personal user credentials are required; a team API key
cannot impersonate its owner. Keep the original UUID and mode after a lost
response and use `operation` for readback; no write is automatically retried.
A submitted operation is not delivered success. Tests can target saved inactive
endpoints, and receivers can cause real or duplicate effects even in test mode.
Historical retry is not exact byte replay: v2 uses current state at delivery.
Output contains only validated safe receipt metadata, never event bodies,
receiver responses, secret headers or signing material.

### Configuración guardada de webhooks

`webhooks create|update` exige un UUIDv4 guardado antes de enviar; usa
`--operation-id` o `operation_id` en JSON (sin duplicarlo). `update|delete` exige
la revisión del GET actual con `--expected-revision`. `--yes` confirma el efecto
compartido live/test y los futuros envíos externos. `webhooks schema create|update|delete`
expone los campos admitidos; los 26 eventos incluyen `teams.*`, sujetos a autoridad
master-team. Un endpoint inactivo admite `events: []`; guardar no envía una prueba.

```bash
gigstack webhooks create --url https://example.com/webhook --events '' --status inactive --version v2 --operation-id SAVED_UUID --team TEAM --yes --json
gigstack webhooks configuration-operation SAVED_UUID --team TEAM --json
gigstack webhooks configure WEBHOOK --intent headers --team TEAM --json
gigstack webhooks configure WEBHOOK --intent signing --team TEAM --json
```

Después de perder una respuesta de create/update, consulta el mismo UUID.
`processing` y `outcome_unknown` permiten sólo lectura; no reenvíes ni inventes otro UUID.
`conflict` permite un GET nuevo y otra intención revisada. Un recibo histórico completado
puede tener `data: null` si el endpoint fue eliminado después. Si se pierde un DELETE,
consulta GET; un 404 sólo acredita ausencia actual. DELETE no destruye secretos guardados.

Headers y firma se configuran exclusivamente en el navegador privado del endpoint:
`configure` comprueba el acceso actual y devuelve el enlace sin abrirlo ni escribir.
No acepta ni imprime valores secretos, referencias de Secret Manager o nuevas claves.
La URL productiva usa `https://app.gigstack.pro`. Para API no productiva configura
`GIGSTACK_APP_ORIGIN=https://staging.gigstack.pro`, o un origen loopback si el API también
es local; no existe fallback productivo. La nueva firma usa `Webhook-*`; desactivarla
no desactiva la firma separada `X-Gigstack-Signature` de endpoints legacy.
La copia `src/schemas/webhook-configuration-request.schema.json` corresponde al descriptor
runtime del backend; las pruebas son offline y no prueban despliegue.

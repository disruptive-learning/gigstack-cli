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
gigstack teams transfer-ownership team_123 user_456 --yes --json
gigstack teams invitations list team_123 --json
gigstack teams invitations create team_123 --email person@example.com --role viewer --json
gigstack teams invitations create team_123 --email person@example.com --no-send-email --json
gigstack teams invitations get team_123 invite_123 --json
gigstack teams invitations resend team_123 invite_123 --json
gigstack teams invitations revoke team_123 invite_123 --yes --json
gigstack teams invitations accept --file invitation.json --json
gigstack teams invitations decline --file invitation.json --json
```

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
gigstack users login-link user_456 --team team_123 --yes --json
gigstack users delete user_456 --team team_123 --yes --json
gigstack webhooks get webhook_123 --team team_123 --json
gigstack webhooks update webhook_123 --data '{"status":"inactive"}' --team team_123 --json
```

`users create` accepts the v2 user fields: `email`, `first_name`, `last_name`,
`phone`, `company_role`, `address`, `auto_join` and `role` (`admin`, `editor`,
`viewer`). `users update` cannot change reserved email or membership fields.
`reset-password` sends an email. `login-link` creates a credential that signs
in as the target user and works only for API-created users managed exclusively
by the caller's billing account, as checked by the server. Treat the returned
link as a secret. User deletion follows the server's ownership/resource checks.

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
su cuenta de facturación. `create` emite un par live/test sólo si no hay claves
API activas; `rotate` reemplaza las claves API y conserva tokens MCP personales.
Ambos entregan secretos una sola vez: la CLI exige `--out`, reserva un archivo
nuevo con permisos `0600` antes de llamar al servidor, y sólo imprime metadatos
y la ubicación del archivo. Nunca sobrescribe un archivo existente.

```bash
gigstack api-keys list --team TEAM_ID --json
gigstack api-keys create --team TEAM_ID --out ./api-keys.json --yes --json
gigstack api-keys rotate --team TEAM_ID --out ./rotated-api-keys.json --yes --json
gigstack api-keys revoke API_KEY_ID --team TEAM_ID --yes --json
gigstack api-keys emergency-revoke --team TEAM_ID --yes --json
```

`emergency-revoke` invalida todas las claves API **y los tokens MCP asociados a
ese equipo**, incluida la credencial de la llamada si corresponde. No revoca
OAuth. Si se interrumpe, un administrador puede retomar la revocación; usa una
sesión Firebase si el token MCP quedó revocado. La creación respeta las
condiciones del plan y no concede acceso de API adicional. En una carrera de
creación/rotación, `409 keys_changed` requiere revisar el listado antes de
repetir; no se reintenta automáticamente. El listado puede devolver una página
vacía con `has_more:true` al excluir tokens MCP: continúa con `--cursor`.

Para crear un token MCP personal, el usuario debe leer y aceptar los términos.
`--yes` sólo confirma la creación: no sustituye el consentimiento separado.
Un agente no debe agregar `--accept-terms` sin la elección expresa del usuario.

```bash
gigstack me mcp-tokens create \
  --data '{"name":"Mi integración","team_id":"TEAM_ID","livemode":false}' \
  --accept-terms --yes --out ./mcp-token.json --json
```

El archivo privado contiene el token y su URL MCP. No los pegues en registros ni
los agregues al repositorio. Si falla la escritura después de emitirlos, la CLI
sale con código `1` y `outcome:"issued"`; revisa las credenciales antes de
revocarlas o crear otras.

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

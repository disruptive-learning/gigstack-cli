# gigstack CLI

Command-line interface for the [gigstack API](https://docs.gigstack.io). Manage invoices, payments, clients, receipts, and more from your terminal.

## Installation

```bash
git clone https://github.com/disruptive-learning/gigstack-cli.git
cd gigstack-cli
npm install
npm run build
npm link
```

After linking, the `gigstack` command is available globally.

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

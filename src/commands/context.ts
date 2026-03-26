import { Command } from "commander";
import pc from "picocolors";
import { isJsonMode, printJson } from "../output.js";

interface ContextTopic {
  title: string;
  summary: string;
  concepts: Record<string, string>;
  statuses?: Record<string, string>;
  actions?: Record<string, string>;
  relationships?: string[];
  tips?: string[];
}

const KNOWLEDGE: Record<string, ContextTopic> = {
  payments: {
    title: "Pagos (Payments)",
    summary:
      "A payment represents money collected from a client. Payments can come from multiple sources (Stripe, PayPal, MercadoPago, bank transfer, cash, etc.) or be registered manually via the API/CLI. A payment is NOT an invoice — a payment triggers automations that can create invoices, receipts, or payment complements automatically.",
    concepts: {
      payment:
        "Money received from a client. Has items, a total, a currency, and a payment form (how the money was received).",
      payment_form:
        "SAT-defined code for HOW money was received. 01=Cash, 03=Wire transfer, 04=Credit card, 28=Debit card, 99=To be defined.",
      payment_method:
        "PUE (paid in full at once) or PPD (installments/deferred). Determines invoice type and whether payment complements are needed.",
      automation_type:
        "What happens after payment is registered: 'pue_invoice' (stamp invoice immediately), 'ppd_invoice_and_complement' (create PPD invoice + complement), 'receipt' (create receipt for self-invoicing), 'none' (just record the payment).",
      idempotency_key:
        "Unique key to prevent duplicate payments. Always use one when registering payments programmatically.",
      payment_source:
        "Where the payment originated: stripe, paypal, mercadopago, openpay, conekta, clip, dlocal, woocommerce, shopify, manual, api.",
    },
    statuses: {
      pending: "Payment created but not yet collected. Client has not paid yet. Waiting for payment method or processing.",
      requires_payment_method: "Payment link sent but client hasn't chosen how to pay yet.",
      processing: "Payment is being processed by the payment processor (card charge in progress, etc.).",
      succeeded: "Money collected successfully. Automations will fire (invoice, receipt, etc.).",
      failed: "Payment attempt failed (card declined, insufficient funds, etc.). No money was collected.",
      cancelled: "Payment was cancelled before collection. No money was collected.",
      refunded: "Payment was collected but then returned to the client. A credit note (nota de crédito) may be needed.",
    },
    actions: {
      "payments list": "List payments. Supports --limit, --next (cursor pagination), --from/--to (date filter), --sort, --order-by, --status, --client, --currency, --email, --rfc.",
      "payments request": "Create a payment link. Client receives a URL to pay via card, bank, OXXO, etc. Supports --send-email.",
      "payments register": "Record a payment already received (cash, wire transfer, etc.). Triggers automations. Supports --send-email.",
      "payments refund <id>": "Refund a succeeded payment. Money returned to client.",
      "pay": "Shortcut: register payment + auto-create client + send self-invoice portal. Best for quick charges.",
    },
    relationships: [
      "Payment → triggers automation → creates Invoice (PUE) or Invoice (PPD) + Complement",
      "Payment → triggers automation → creates Receipt (for self-invoicing by client)",
      "Payment succeeded → automation fires. Payment failed/cancelled → nothing happens.",
      "Refunded payment → may need credit note (nota de crédito / egress invoice)",
      "A payment can have a client attached. If client has RFC, invoice is auto-stamped. If not, a receipt is created for self-invoicing.",
    ],
    tips: [
      "To charge someone: use 'gigstack pay' for the simplest flow.",
      "To send a payment link: use 'gigstack payments request'.",
      "To record money already received: use 'gigstack payments register'.",
      "Pending payments are NOT missing money — they are payment links waiting for the client to pay.",
      "'succeeded' is the only status that means money was actually collected.",
      "Use --from/--to for date ranges, --status to filter by payment status, --currency for currency, --email or --rfc to find payments by client.",
      "Pagination: the CLI shows a --next token at the bottom of results. Pass it to get the next page.",
    ],
  },

  invoices: {
    title: "Facturas CFDI (Invoices)",
    summary:
      "A CFDI invoice is a legally-binding Mexican tax document stamped by the SAT. There are 4 types: Income (I), Egress/Credit note (E), Payment complement (P), and Transfer (T). Invoices are created after a payment, manually, or via automation. An invoice is NOT a payment — it's the fiscal proof of a transaction.",
    concepts: {
      cfdi: "Comprobante Fiscal Digital por Internet — the official Mexican digital invoice format required by SAT.",
      income_invoice:
        "Type 'I' (Ingreso). The most common: proves revenue was received. Created for each sale/payment.",
      credit_note:
        "Type 'E' (Egreso). Cancels or reduces a previous income invoice. Used for refunds, discounts, returns.",
      payment_complement:
        "Type 'P' (Pago). Required for PPD invoices to prove each installment payment was received. Links back to the original PPD invoice.",
      transfer_invoice: "Type 'T' (Traslado). For transferring goods between locations. Rare in gigstack.",
      pue: "Pago en Una sola Exhibición — paid in full at once. One invoice, done. Most common for small transactions.",
      ppd: "Pago en Parcialidades o Diferido — payment in installments or deferred. Requires payment complements for each payment received. The invoice is stamped first, payments come later.",
      folio: "Sequential invoice number within a series (e.g., A-001, A-002). Managed by gigstack, no gaps.",
      series: "Letter/prefix for invoice numbering (e.g., 'A', 'B', 'WEB'). Different series for different purposes.",
      use_cfdi:
        "SAT code for how the client will use the invoice. G03=General expenses (most common), G01=Acquisition of merchandise, S01=No fiscal effects.",
      global_invoice:
        "Monthly consolidated invoice for all receipts that were NOT self-invoiced by clients. Created by the EOM (End of Month) process.",
    },
    statuses: {
      valid: "Invoice is stamped and valid with the SAT. This is the normal state.",
      cancelled: "Invoice was cancelled with the SAT. Requires a motive code (01-04).",
      pending: "Invoice is being processed (rare, usually stamping is instant).",
      draft: "Pre-invoice / borrador. Not yet stamped. Can be edited before stamping.",
    },
    actions: {
      "invoices list": "List invoices. Supports --limit, --next (cursor pagination), --from/--to (date filter), --sort, --order-by, --status, --client, --series.",
      "invoices create": "Stamp a new income invoice (CFDI 4.0). Interactive or via flags. Supports --send-email and --emails.",
      "invoices cancel <uuid>": "Cancel an invoice with the SAT. Requires --motive (01=replacement, 02=no commercial activity, 03=wrong operation, 04=related to global invoice).",
      "invoices download <uuid>": "Download PDF and XML files to disk.",
      "invoices files <uuid>": "Get PDF/XML download URLs.",
      "invoices search <query>": "Search invoices by client name, RFC, or UUID.",
      "invoices drafts list": "List pre-invoices that haven't been stamped yet.",
      "invoices drafts stamp <uuid>": "Stamp a draft, converting it to a real CFDI.",
      "invoices credit-notes": "List credit notes (egress invoices).",
      "invoices complements": "List payment complements. Supports --invoice <uuid> to filter by parent PPD invoice.",
    },
    relationships: [
      "Payment (succeeded) → triggers → Income Invoice (PUE) — one invoice per payment.",
      "Payment (succeeded) → triggers → Income Invoice (PPD) + Payment Complement — invoice first, complement proves each payment.",
      "PPD Invoice → needs Payment Complements to track installment payments. Without complements, the PPD invoice is 'unpaid'.",
      "Receipt (not self-invoiced) → grouped at End of Month → Global Invoice.",
      "Invoice cancelled → may need replacement invoice (motive 01) or credit note.",
      "Credit note (E) → reduces/cancels a previous income invoice (I).",
    ],
    tips: [
      "PPD invoices with last_balance > 0 are unpaid or partially paid — this is your 'cobranza' (collections).",
      "PUE invoices are fully paid by definition — the payment happened before/at stamping.",
      "Don't confuse invoice status with payment status. An invoice can be 'valid' but the PPD payment still pending.",
      "Cancelled invoices need a motive. Use 01 if you're replacing it, 02-04 for other reasons.",
      "Use --status to filter by invoice status (valid, cancelled, pending), --client for client ID, --series for invoice series.",
      "Use --from/--to for date ranges. Pagination: the CLI shows a --next token at the bottom of results.",
    ],
  },

  receipts: {
    title: "Recibos de Venta (Sales Receipts)",
    summary:
      "A receipt is a NON-fiscal sales document generated when a payment is received but the client hasn't provided their fiscal data (RFC) for invoicing. The receipt includes a link to a self-invoice portal where the client can enter their RFC and generate their own CFDI invoice. Receipts that are NOT self-invoiced by month end are grouped into a 'global invoice'. A receipt is NOT a missing payment — the money was already collected.",
    concepts: {
      receipt:
        "Proof of sale WITHOUT fiscal value. Generated when payment is received but client RFC is unknown.",
      self_invoice_portal:
        "Web page where the client enters their RFC and fiscal data to generate their own CFDI from the receipt. URL sent via email automatically.",
      global_invoice:
        "At end of month, all receipts NOT self-invoiced are grouped into one consolidated CFDI invoice to 'público general' (XAXX010101000). This fulfills the fiscal obligation.",
      eom: "End of Month process. Runs daily at 23:59 Mexico City time. Groups pending receipts → global invoices.",
    },
    statuses: {
      pending: "Receipt created, waiting for client to self-invoice. The money IS collected — only the CFDI is missing.",
      open: "Same as pending — receipt is available for self-invoicing.",
      invoiced: "Client completed self-invoicing. A CFDI was generated from this receipt.",
      completed: "Same as invoiced — receipt was converted to a CFDI.",
      expired: "Self-invoice window closed. Receipt will be included in the global invoice at EOM.",
      cancelled: "Receipt was cancelled. Will not be included in any invoice.",
    },
    actions: {
      "receipts list": "List all receipts. Supports --limit, --next (cursor pagination), --from/--to (date filter), --sort, --order-by, --status, --client.",
      "receipts stamp <id>": "Manually stamp a receipt (generate invoice from it).",
      "receipts cancel <id>": "Cancel a receipt.",
    },
    relationships: [
      "Payment (succeeded, no client RFC) → creates Receipt → client self-invoices → Income Invoice.",
      "Receipt (pending at EOM) → grouped into Global Invoice to público general.",
      "Receipt pending does NOT mean payment pending. The money is collected. Only the CFDI is missing.",
      "Receipt amount = payment amount. There is no 'debt' on a receipt — it's a documentation task, not a collection task.",
    ],
    tips: [
      "IMPORTANT: 'Receipts pending' means self-invoicing is pending, NOT that money is owed. The payment was already collected.",
      "If you want to know who owes you money, look at PPD invoices with balance > 0 (cobranza), NOT at pending receipts.",
      "To reduce pending receipts, remind clients to self-invoice before month end.",
      "Global invoicing at EOM handles the fiscal obligation for any receipt not self-invoiced.",
      "Use --status to filter receipts (pending, invoiced, expired, cancelled), --client for client ID.",
      "Pagination: the CLI shows a --next token at the bottom of results. Pass it to get the next page.",
    ],
  },

  clients: {
    title: "Clientes (Clients)",
    summary:
      "A client represents a person or company you transact with. Clients have fiscal data (RFC, tax system, address) needed for invoicing. Clients can be created manually or auto-created when registering a payment with client search.",
    concepts: {
      rfc: "Registro Federal de Contribuyentes — Mexican tax ID. Required for invoicing. Format: 12-13 alphanumeric characters.",
      tax_system:
        "Régimen fiscal — SAT tax regime code. Common: 601 (General/Corp), 612 (Business individual), 616 (No obligations), 626 (RESICO).",
      use_cfdi:
        "How the client will use the invoice. G03 (general expenses) is the safe default.",
      publico_general:
        "Generic client (XAXX010101000) used for global invoices when no specific client RFC is available.",
      auto_create:
        "When registering a payment, you can pass client.search with auto_create=true. If the client doesn't exist, it's created automatically.",
    },
    statuses: {
      is_valid: "Client's fiscal data has been validated against the SAT.",
    },
    actions: {
      "clients list": "List clients. Supports --limit, --next (cursor pagination), --from/--to (date filter), --sort, --order-by.",
      "clients create": "Create a client interactively or via flags.",
      "clients update <id>": "Update client fiscal data (name, RFC, tax system, etc.).",
      "clients search <query>": "Search by name, RFC, or email.",
      "clients validate <id>": "Validate client's fiscal data against the SAT.",
      "clients delete <id>": "Delete a client.",
    },
    relationships: [
      "Client → attached to Payments, Invoices, Receipts.",
      "Client with RFC → payment triggers invoice automation.",
      "Client without RFC → payment triggers receipt (self-invoice portal).",
      "Client.search in payment body → auto-find or auto-create client by RFC or email.",
    ],
    tips: [
      "Always validate new clients with 'clients validate' to avoid CFDI stamping errors.",
      "Use client.search with auto_create when registering payments — avoids manual client creation.",
      "You can search clients by ID directly: pass the client_xxx ID in the search prompt.",
    ],
  },

  cobranza: {
    title: "Cobranza (Collections / Accounts Receivable)",
    summary:
      "Cobranza tracks money that is OWED to you. Only PPD invoices can have outstanding balances — PUE invoices are paid in full by definition. Receipts are NOT cobranza: receipt money is already collected, only the self-invoice is pending. To find who owes you money, look at PPD invoices where last_balance > 0.",
    concepts: {
      ppd_balance:
        "The remaining amount on a PPD invoice. Starts at the invoice total, decreases with each payment complement. When balance = 0, the invoice is fully paid.",
      payment_complement:
        "CFDI type 'P' — proves a payment was received against a PPD invoice. Each complement reduces the PPD balance.",
      installment:
        "Each payment complement is an installment. Installment 1 is the first payment, 2 is the second, etc.",
      aging:
        "How many days since the PPD invoice was created. Older = higher risk of non-payment. Buckets: 0-15, 16-30, 31-60, 61-90, 90+ days.",
      partial_payment:
        "A PPD invoice where some payment complements exist but balance > 0. Client started paying but hasn't finished.",
    },
    statuses: {
      "last_balance > 0, complements = 0": "PPD invoice with NO payments received. Full amount is outstanding.",
      "last_balance > 0, complements > 0": "Partial payment. Some money received, but balance remains.",
      "last_balance = 0": "Fully paid. All payment complements received. No action needed.",
    },
    actions: {
      "status": "Run 'gigstack status' to see cobranza summary with aging breakdown.",
      "invoices list --json": "Get all invoices as JSON, filter by payment_method=PPD and last_balance > 0 to find outstanding invoices.",
      "invoices complements": "List payment complements to see which PPD invoices have received payments.",
    },
    relationships: [
      "PPD Invoice (last_balance > 0) = money owed to you = cobranza.",
      "PUE Invoice = already paid, never appears in cobranza.",
      "Receipt pending = money already collected, NOT cobranza. Only the self-invoice document is missing.",
      "Payment complement received → reduces PPD balance → moves toward fully paid.",
    ],
    tips: [
      "CRITICAL: Receipts are NOT cobranza. A pending receipt means the client hasn't self-invoiced yet, but the MONEY IS ALREADY COLLECTED.",
      "To find who owes money: filter PPD invoices where last_balance > 0.",
      "Prioritize by aging: invoices over 90 days are at highest risk of non-payment.",
      "Partial payments (balance > 0 but complements > 0) need a nudge — the client started paying but stopped.",
      "'gigstack status' shows a complete cobranza breakdown with aging buckets.",
      "Use 'gigstack invoices list --status valid --json' and filter client-side by payment_method=PPD and last_balance > 0 for collections data. Server-side payment_method filter is not yet available.",
    ],
  },

  automations: {
    title: "Automatizaciones (Automations)",
    summary:
      "Automations are actions triggered by events (mainly payments). When a payment is registered or received via webhook, gigstack can automatically create invoices, receipts, payment complements, or send emails. Automations are configured per team and can be overridden per payment.",
    concepts: {
      pue_invoice: "Automation: stamp a PUE income invoice immediately when payment succeeds.",
      ppd_invoice_and_complement:
        "Automation: stamp a PPD invoice (if not exists) and a payment complement for this payment.",
      receipt: "Automation: create a receipt with self-invoice portal link. Used when client RFC is unknown.",
      none: "No automation. Just record the payment, do nothing else.",
      stamp_invoice: "Legacy automation name, equivalent to pue_invoice in the payments/register endpoint.",
    },
    relationships: [
      "Payment registered with automation_type → proserver fires the automation.",
      "Webhook payment (Stripe, PayPal, etc.) → uses team's default automation config.",
      "Manual payment (API/CLI) → uses the automation_type specified in the request.",
    ],
    tips: [
      "Default automation for 'gigstack pay' is pue_invoice — stamps an invoice immediately.",
      "Use 'none' if you just want to record the payment without any fiscal documents.",
      "PPD automations are for installment scenarios — the invoice is created once, complements are added per payment.",
    ],
  },

  services: {
    title: "Servicios/Productos (Services/Products)",
    summary:
      "Services are your product/service catalog. Each service has a description, price, SAT product key, and SAT unit key. Services can be reused across invoices and payments to avoid re-entering item details.",
    concepts: {
      product_key:
        "SAT catalog code for the product/service. Common: 84111506 (consulting), 80161500 (admin services), 43232100 (software licenses).",
      unit_key:
        "SAT unit code. Common: E48 (service unit), H87 (piece), ACT (activity), HUR (hour), DAY (day).",
      taxes:
        "Tax configuration per service. Typically IVA 16% (type: 'IVA', rate: 0.16, factor: 'Tasa'). Can include withholdings (retenciones).",
    },
    actions: {
      "services list": "List all services in your catalog. Supports --limit, --next (cursor pagination), --sort, --order-by.",
      "services create": "Create a new service with SAT keys and pricing.",
      "services update <id>": "Update service description, price, or SAT keys.",
      "services delete <id>": "Delete a service.",
    },
    tips: [
      "Create services for your common offerings to avoid retyping SAT keys every time.",
      "IVA 16% is the standard tax rate in Mexico. Add it to most services unless exempt.",
      "Product key 84111506 and unit key E48 are safe defaults for professional services.",
    ],
  },

  webhooks: {
    title: "Webhooks",
    summary:
      "Webhooks let you receive real-time notifications when events happen in gigstack (invoice created, payment received, etc.). Configure a URL and optionally filter by event types.",
    concepts: {
      events:
        "Event types you can subscribe to: invoice.created, invoice.cancelled, payment.succeeded, payment.failed, receipt.created, etc.",
    },
    actions: {
      "webhooks list": "List configured webhooks.",
      "webhooks create": "Create a webhook with a URL and optional event filter.",
      "webhooks delete <id>": "Delete a webhook.",
    },
    tips: [
      "If no events are specified, the webhook receives ALL events.",
      "Webhooks include a signature header for verification.",
    ],
  },
};

const TOPIC_LIST = Object.keys(KNOWLEDGE);

export function registerContextCommand(program: Command) {
  program
    .command("context [topic]")
    .description("Domain knowledge for agents: understand gigstack concepts, statuses, and relationships")
    .option("--short", "Brief summary only")
    .option("--all", "Dump all topics at once (for AI agents to load full domain knowledge)")
    .action((topic, opts) => {
      // --all: dump everything
      if (opts.all) {
        if (isJsonMode()) {
          const topics: Record<string, ContextTopic> = {};
          for (const [id, t] of Object.entries(KNOWLEDGE)) {
            topics[id] = t;
          }
          return printJson({ topics });
        }
        // Plain text: print each topic with --short style (title + summary)
        console.log(pc.bold("\ngigstack context --all — full domain knowledge\n"));
        for (const [id, t] of Object.entries(KNOWLEDGE)) {
          console.log(`${pc.bold(pc.underline(t.title))} ${pc.dim(`(${id})`)}`);
          console.log(`${t.summary}\n`);
        }
        return;
      }

      // No topic: list all
      if (!topic) {
        if (isJsonMode()) {
          return printJson({ topics: TOPIC_LIST.map(t => ({ id: t, title: KNOWLEDGE[t].title, summary: KNOWLEDGE[t].summary })) });
        }
        console.log(pc.bold("\ngigstack context — domain knowledge for agents\n"));
        console.log("Available topics:\n");
        for (const [id, t] of Object.entries(KNOWLEDGE)) {
          console.log(`  ${pc.bold(id.padEnd(14))} ${t.title}`);
          console.log(`  ${" ".repeat(14)} ${pc.dim(t.summary.slice(0, 90))}…\n`);
        }
        console.log(pc.dim(`Usage: gigstack context <topic> [--json] [--short] [--all]\n`));
        return;
      }

      const t = KNOWLEDGE[topic.toLowerCase()];
      if (!t) {
        console.error(pc.red(`Unknown topic: ${topic}`));
        console.log(pc.dim(`Available: ${TOPIC_LIST.join(", ")}`));
        process.exit(1);
      }

      if (isJsonMode()) {
        return printJson(t);
      }

      console.log(`\n${pc.bold(pc.underline(t.title))}\n`);
      console.log(t.summary);

      if (opts.short) {
        console.log();
        return;
      }

      // Concepts
      console.log(`\n${pc.bold("Concepts:")}`);
      for (const [k, v] of Object.entries(t.concepts)) {
        console.log(`  ${pc.cyan(k.padEnd(28))} ${v}`);
      }

      // Statuses
      if (t.statuses) {
        console.log(`\n${pc.bold("Statuses:")}`);
        for (const [k, v] of Object.entries(t.statuses)) {
          console.log(`  ${pc.yellow(k.padEnd(28))} ${v}`);
        }
      }

      // Actions
      if (t.actions) {
        console.log(`\n${pc.bold("CLI Actions:")}`);
        for (const [k, v] of Object.entries(t.actions)) {
          console.log(`  ${pc.green(("gigstack " + k).padEnd(38))} ${v}`);
        }
      }

      // Relationships
      if (t.relationships) {
        console.log(`\n${pc.bold("Relationships:")}`);
        for (const r of t.relationships) {
          console.log(`  ${pc.dim("→")} ${r}`);
        }
      }

      // Tips
      if (t.tips) {
        console.log(`\n${pc.bold("Agent Tips:")}`);
        for (const tip of t.tips) {
          console.log(`  ${pc.dim("!")} ${tip}`);
        }
      }

      console.log();
    });
}

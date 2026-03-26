import { Command } from "commander";
import pc from "picocolors";
import { api } from "../api.js";
import { printJson, success, error, isJsonMode, formatMoney, spin } from "../output.js";
import { ask, askRequired, select, confirm } from "../prompt.js";

export function registerPayCommand(program: Command) {
  program
    .command("pay")
    .description("Registrar un pago y enviar portal de autofactura al cliente")
    .option("--email <email>", "Email del cliente")
    .option("--name <name>", "Nombre del cliente")
    .option("--rfc <rfc>", "RFC del cliente (busca o crea automáticamente)")
    .option("--description <desc>", "Descripción del servicio/producto")
    .option("--amount <amount>", "Monto (sin IVA)")
    .option("--iva", "Agregar IVA 16%")
    .option("--no-iva", "Sin IVA")
    .option("--payment-form <code>", "Forma de pago (01=Efectivo, 03=Transferencia, 04=Tarjeta)")
    .option("--currency <code>", "Moneda", "MXN")
    .option("--automation <type>", "Tipo de automatización (pue_invoice, ppd_invoice_and_complement, none)", "pue_invoice")
    .option("--product-key <key>", "Clave producto SAT", "84111506")
    .option("--unit-key <key>", "Clave unidad SAT", "E48")
    .option("--metadata <json>", "Metadata JSON adicional")
    .option("--stdin", "Leer input desde stdin (JSON)")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        let email: string;
        let name: string | undefined;
        let rfc: string | undefined;
        let description: string;
        let amount: number;
        let addIva: boolean;
        let paymentForm: string;

        // stdin mode for agents
        if (opts.stdin) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) chunks.push(chunk);
          const input = JSON.parse(Buffer.concat(chunks).toString());
          email = input.email;
          name = input.name;
          rfc = input.rfc;
          description = input.description;
          amount = input.amount;
          addIva = input.iva !== false;
          paymentForm = input.payment_form || "03";
          opts.currency = input.currency || opts.currency;
          opts.automation = input.automation || opts.automation;
          opts.productKey = input.product_key || opts.productKey;
          opts.unitKey = input.unit_key || opts.unitKey;
          if (input.metadata) opts.metadata = JSON.stringify(input.metadata);
        }
        // Flag mode
        else if (opts.email && opts.amount && opts.description) {
          email = opts.email;
          name = opts.name;
          rfc = opts.rfc;
          description = opts.description;
          amount = parseFloat(opts.amount);
          addIva = opts.iva !== false;
          paymentForm = opts.paymentForm || "03";
        }
        // Interactive mode
        else {
          email = opts.email || await askRequired("Email del cliente");
          name = opts.name || await ask("Nombre del cliente (opcional)");
          rfc = opts.rfc || await ask("RFC (opcional, el cliente puede completarlo en el portal)");
          description = opts.description || await askRequired("Descripción del servicio/producto");
          const amountStr = opts.amount || await askRequired("Monto (sin IVA)");
          amount = parseFloat(amountStr);
          if (isNaN(amount) || amount <= 0) { error("Monto inválido"); process.exit(1); }
          addIva = opts.iva !== undefined ? opts.iva : await confirm("Agregar IVA 16%?");
          paymentForm = opts.paymentForm || await select("Forma de pago", [
            { label: "03 — Transferencia electrónica", value: "03" },
            { label: "01 — Efectivo", value: "01" },
            { label: "04 — Tarjeta de crédito", value: "04" },
            { label: "28 — Tarjeta de débito", value: "28" },
            { label: "99 — Por definir", value: "99" },
          ]);

          // Summary
          const iva = addIva ? amount * 0.16 : 0;
          const total = amount + iva;
          console.log(`\n${pc.bold("Resumen:")}`);
          console.log(`  Cliente:     ${email}${name ? ` (${name})` : ""}`);
          console.log(`  Descripción: ${description}`);
          console.log(`  Subtotal:    ${formatMoney(amount, opts.currency)}`);
          if (addIva) console.log(`  IVA 16%:     ${formatMoney(iva, opts.currency)}`);
          console.log(`  ${pc.bold("Total:")}      ${pc.bold(formatMoney(total, opts.currency))}`);
          console.log(`  Forma pago:  ${paymentForm}`);
          console.log(`  Automación:  ${opts.automation}`);

          const proceed = await confirm("\nRegistrar pago?");
          if (!proceed) { console.log(pc.dim("Cancelado")); return; }
        }

        // Build client object with search
        const client: any = { email };
        if (name) { client.name = name; client.legal_name = name; }

        if (rfc) {
          client.tax_id = rfc;
          client.search = { on_key: "tax_id", on_value: rfc, auto_create: true };
        } else {
          client.search = { on_key: "email", on_value: email, auto_create: true };
        }

        // Build item with taxes
        const item: any = {
          description,
          quantity: 1,
          unit_price: amount,
          product_key: opts.productKey,
          unit_key: opts.unitKey,
        };
        if (addIva) {
          item.taxes = [{ type: "IVA", rate: 0.16, factor: "Tasa", withholding: false }];
        }

        // Build request body
        const body: any = {
          client,
          items: [item],
          currency: opts.currency,
          payment_form: paymentForm,
          automation_type: opts.automation,
          idempotency_key: `cli_${Date.now()}`,
        };

        if (opts.metadata) {
          try { body.metadata = JSON.parse(opts.metadata); } catch {}
        }

        const res = await spin("Registrando pago…", () => api("POST", "/payments/register", { body, team: opts.team }));
        const payment = res.data;

        if (isJsonMode()) return printJson(payment);

        const iva = addIva ? amount * 0.16 : 0;
        const total = amount + iva;
        success("Pago registrado");
        console.log(`  ID:    ${payment.id || "—"}`);
        console.log(`  Total: ${formatMoney(total, opts.currency)}`);
        if (payment.client?.id) console.log(`  Cliente: ${payment.client.id}`);
        if (payment.short_url) console.log(`  Link pago: ${payment.short_url}`);
        console.log(`\n  ${pc.dim("Portal de autofactura enviado a")} ${pc.bold(email)}`);
      } catch (e: any) { error(e.message); }
    });
}

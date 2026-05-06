import { Command } from "commander";
import pc from "picocolors";
import { api, resolveTeam } from "../api.js";
import { formatMoney, spin, isJsonMode, printJson } from "../output.js";

function sum(items: any[], key = "total"): number {
  return items.reduce((s, i) => s + (i?.[key] || 0), 0);
}

function paymentTotal(p: any): number {
  if (typeof p?.total === "number") return p.total;
  if (typeof p?.subtotal === "number" && typeof p?.taxes === "number") return p.subtotal + p.taxes;
  if (typeof p?.amount === "number") return p.amount / 100;
  const items = Array.isArray(p?.items) ? p.items : [];
  return items.reduce((s: number, it: any) => {
    const line = (it?.quantity ?? 0) * (it?.unit_price ?? 0) - (it?.discount ?? 0);
    return s + line;
  }, 0);
}

function sumPayments(payments: any[]): number {
  return payments.reduce((s, p) => s + paymentTotal(p), 0);
}

function fmt(amount: number, currency = "MXN") {
  return formatMoney(amount, currency);
}

/** Parse --from/--to into ISO date strings. Supports: YYYY-MM-DD, YYYY-MM, "today", "30d", "7d", etc. */
function parseDate(input: string, isEnd = false): string {
  const trimmed = input.trim().toLowerCase();

  // Relative: "30d", "7d", "90d"
  const relMatch = trimmed.match(/^(\d+)d$/);
  if (relMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(relMatch[1]));
    return d.toISOString().slice(0, 10);
  }

  if (trimmed === "today") return new Date().toISOString().slice(0, 10);

  // YYYY-MM → first or last day of month
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    if (isEnd) {
      const [y, m] = trimmed.split("-").map(Number);
      const last = new Date(y, m, 0).getDate();
      return `${trimmed}-${String(last).padStart(2, "0")}`;
    }
    return `${trimmed}-01`;
  }

  // YYYY-MM-DD passthrough
  return trimmed;
}

/** Default: first day of current month */
function defaultFrom(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Default: today */
function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerStatusCommand(program: Command) {
  program
    .command("status")
    .description("Resumen financiero: facturas, pagos, recibos y conciliación")
    .option("--from <date>", "Fecha inicio (YYYY-MM-DD, YYYY-MM, 30d, 7d)")
    .option("--to <date>", "Fecha fin (YYYY-MM-DD, YYYY-MM, today)")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const from = opts.from ? parseDate(opts.from) : defaultFrom();
        const to = opts.to ? parseDate(opts.to, true) : defaultTo();

        // Convert to unix seconds (10-digit) — safest format for the API
        const fromTs = String(Math.floor(new Date(from).getTime() / 1000));
        const toTs = String(Math.floor(new Date(to + "T23:59:59").getTime() / 1000));

        const dateQuery: Record<string, string> = {
          "created[gte]": fromTs,
          "created[lte]": toTs,
          limit: "100",
        };
        const noDatesQuery: Record<string, string> = { limit: "100" };
        const hasDateFilter = opts.from || opts.to;

        const [team, invoices, payments, receipts] = await spin("Cargando resumen…", () =>
          Promise.all([
            resolveTeam(),
            api("GET", "/invoices/income", { query: hasDateFilter ? dateQuery : noDatesQuery, team: opts.team }).catch(() => ({ data: [] })),
            api("GET", "/payments", { query: hasDateFilter ? dateQuery : noDatesQuery, team: opts.team }).catch(() => ({ data: [] })),
            api("GET", "/receipts", { query: hasDateFilter ? dateQuery : noDatesQuery, team: opts.team }).catch(() => ({ data: [] })),
          ]),
        );

        const inv = (invoices.data || []).filter((i: any) => i != null);
        const pay = (payments.data || []).filter((p: any) => p != null);
        const rec = (receipts.data || []).filter((r: any) => r != null);
        const cur = inv[0]?.currency || pay[0]?.currency || "MXN";

        // Invoice breakdowns
        const validInv = inv.filter((i: any) => i.status === "valid");
        const cancelledInv = inv.filter((i: any) => i.status === "cancelled");
        const pueInv = validInv.filter((i: any) => i.payment_method === "PUE");
        const ppdInv = validInv.filter((i: any) => i.payment_method === "PPD");

        // Payment breakdowns
        const succeededPay = pay.filter((p: any) => p.status === "succeeded");
        const pendingPay = pay.filter((p: any) => p.status === "pending" || p.status === "requires_payment_method");
        const failedPay = pay.filter((p: any) => p.status === "failed" || p.status === "cancelled");

        // Receipt breakdowns
        const pendingRec = rec.filter((r: any) => r.status === "pending" || r.status === "open");
        const invoicedRec = rec.filter((r: any) => r.status === "invoiced" || r.status === "completed");

        // Cobranza (PPD): invoices with outstanding balance
        const ppdWithBalance = ppdInv.filter((i: any) => {
          const balance = i.last_balance ?? i.total;
          return balance > 0 && (!i.payment_complements || i.payment_complements === 0 || balance > 0.01);
        });
        const ppdPaid = ppdInv.filter((i: any) => {
          const balance = i.last_balance;
          return balance !== undefined && balance !== null && balance <= 0.01;
        });
        const ppdPartial = ppdInv.filter((i: any) => {
          const balance = i.last_balance;
          return balance !== undefined && balance !== null && balance > 0.01 && balance < (i.total || 0);
        });
        const ppdPendingTotal = ppdWithBalance.reduce((s: number, i: any) => s + (i.last_balance ?? i.total ?? 0), 0);

        // Aging buckets for PPD with balance
        const now = Date.now();
        const dayMs = 86400000;
        const aging = { current: [] as any[], d30: [] as any[], d60: [] as any[], d90: [] as any[], over90: [] as any[] };
        for (const i of ppdWithBalance) {
          const ts = i.created_at
            ? (typeof i.created_at === "string" ? new Date(i.created_at).getTime() : (i.created_at > 1e12 ? i.created_at : i.created_at * 1000))
            : now;
          const daysOld = Math.floor((now - ts) / dayMs);
          const balance = i.last_balance ?? i.total ?? 0;
          const entry = { ...i, _balance: balance, _daysOld: daysOld };
          if (daysOld <= 15) aging.current.push(entry);
          else if (daysOld <= 30) aging.d30.push(entry);
          else if (daysOld <= 60) aging.d60.push(entry);
          else if (daysOld <= 90) aging.d90.push(entry);
          else aging.over90.push(entry);
        }

        if (isJsonMode()) {
          return printJson({
            period: hasDateFilter ? { from, to } : { note: "last 100 records" },
            team: { name: team?.legal_name || team?.brand?.alias, tax_id: team?.tax_id },
            invoices: {
              total: inv.length, valid: validInv.length, cancelled: cancelledInv.length,
              pue: { count: pueInv.length, total: sum(pueInv) },
              ppd: { count: ppdInv.length, total: sum(ppdInv) },
              total_amount: sum(validInv),
            },
            payments: {
              total: pay.length, succeeded: succeededPay.length, pending: pendingPay.length, failed: failedPay.length,
              succeeded_amount: sumPayments(succeededPay), pending_amount: sumPayments(pendingPay),
            },
            receipts: {
              total: rec.length, pending: pendingRec.length, invoiced: invoicedRec.length,
              pending_amount: sum(pendingRec), total_amount: sum(rec),
            },
            cobranza: {
              ppd_pending: ppdWithBalance.length, ppd_paid: ppdPaid.length, ppd_partial: ppdPartial.length,
              pending_amount: ppdPendingTotal,
              aging: {
                current: { count: aging.current.length, amount: aging.current.reduce((s: number, i: any) => s + i._balance, 0) },
                d30: { count: aging.d30.length, amount: aging.d30.reduce((s: number, i: any) => s + i._balance, 0) },
                d60: { count: aging.d60.length, amount: aging.d60.reduce((s: number, i: any) => s + i._balance, 0) },
                d90: { count: aging.d90.length, amount: aging.d90.reduce((s: number, i: any) => s + i._balance, 0) },
                over90: { count: aging.over90.length, amount: aging.over90.reduce((s: number, i: any) => s + i._balance, 0) },
              },
            },
          });
        }

        const teamName = team?.legal_name || team?.brand?.alias || "—";
        console.log(`\n${pc.bold(teamName)} ${team?.tax_id ? pc.dim(`(${team.tax_id})`) : ""}`);
        if (hasDateFilter) {
          console.log(pc.dim(`${from}  →  ${to}`));
        } else {
          console.log(pc.dim(`Últimos 100 registros (usa --from para filtrar)`));
        }

        // ─── Facturas ───
        console.log(`\n${pc.bold(pc.underline("Facturas"))}`);
        console.log(`  Válidas        ${String(validInv.length).padStart(4)}   ${pc.green(fmt(sum(validInv), cur))}`);
        console.log(`    PUE          ${String(pueInv.length).padStart(4)}   ${fmt(sum(pueInv), cur)}`);
        console.log(`    PPD          ${String(ppdInv.length).padStart(4)}   ${fmt(sum(ppdInv), cur)}`);
        if (cancelledInv.length > 0) {
          console.log(`  Canceladas     ${String(cancelledInv.length).padStart(4)}   ${pc.dim(fmt(sum(cancelledInv), cur))}`);
        }

        // ─── Pagos ───
        console.log(`\n${pc.bold(pc.underline("Pagos"))}`);
        console.log(`  Cobrados       ${String(succeededPay.length).padStart(4)}   ${pc.green(fmt(sumPayments(succeededPay), cur))}`);
        if (pendingPay.length > 0) {
          console.log(`  Pendientes     ${String(pendingPay.length).padStart(4)}   ${pc.yellow(fmt(sumPayments(pendingPay), cur))}`);
        }
        if (failedPay.length > 0) {
          console.log(`  Fallidos       ${String(failedPay.length).padStart(4)}   ${pc.red(fmt(sumPayments(failedPay), cur))}`);
        }

        // ─── Recibos ───
        console.log(`\n${pc.bold(pc.underline("Recibos"))}`);
        console.log(`  Total          ${String(rec.length).padStart(4)}   ${fmt(sum(rec), cur)}`);
        if (pendingRec.length > 0) {
          console.log(`  Por facturar   ${String(pendingRec.length).padStart(4)}   ${pc.yellow(fmt(sum(pendingRec), cur))}`);
        }
        if (invoicedRec.length > 0) {
          console.log(`  Facturados     ${String(invoicedRec.length).padStart(4)}   ${pc.green(fmt(sum(invoicedRec), cur))}`);
        }

        // ─── Cobranza PPD ───
        if (ppdInv.length > 0) {
          console.log(`\n${pc.bold(pc.underline("Cobranza PPD"))}`);
          console.log(`  Pendientes     ${String(ppdWithBalance.length).padStart(4)}   ${ppdPendingTotal > 0 ? pc.red(fmt(ppdPendingTotal, cur)) : pc.green(fmt(0, cur))}`);
          if (ppdPartial.length > 0) {
            console.log(`  Pago parcial   ${String(ppdPartial.length).padStart(4)}`);
          }
          if (ppdPaid.length > 0) {
            console.log(`  Liquidadas     ${String(ppdPaid.length).padStart(4)}   ${pc.green(fmt(sum(ppdPaid), cur))}`);
          }

          // Aging breakdown (only show non-empty buckets)
          const agingBuckets = [
            { label: "0-15 días", data: aging.current },
            { label: "16-30 días", data: aging.d30 },
            { label: "31-60 días", data: aging.d60 },
            { label: "61-90 días", data: aging.d90 },
            { label: "+90 días", data: aging.over90 },
          ].filter(b => b.data.length > 0);

          if (agingBuckets.length > 0) {
            console.log(pc.dim("  Antigüedad:"));
            for (const bucket of agingBuckets) {
              const bucketTotal = bucket.data.reduce((s: number, i: any) => s + i._balance, 0);
              const color = bucket === agingBuckets[agingBuckets.length - 1] && bucket.data === aging.over90 ? pc.red : pc.yellow;
              console.log(`    ${bucket.label.padEnd(12)} ${String(bucket.data.length).padStart(4)}   ${color(fmt(bucketTotal, cur))}`);
            }
          }
        }

        // ─── Conciliación ───
        const invoicedTotal = sum(validInv);
        const collectedTotal = sumPayments(succeededPay);
        const pendingRecTotal = sum(pendingRec);
        const diff = collectedTotal - invoicedTotal;

        console.log(`\n${pc.bold(pc.underline("Conciliación"))}`);
        console.log(`  Facturado (PUE)          ${pc.green(fmt(sum(pueInv), cur))}`);
        console.log(`  Facturado (PPD)          ${fmt(sum(ppdInv), cur)}`);
        console.log(`  Cobrado total            ${pc.green(fmt(collectedTotal, cur))}`);
        console.log(`  Recibos por facturar     ${pc.yellow(fmt(pendingRecTotal, cur))}`);
        if (Math.abs(diff) > 0.01) {
          const diffColor = diff > 0 ? pc.yellow : pc.red;
          console.log(`  Diferencia (cobro-fact)  ${diffColor(fmt(diff, cur))}`);
        } else {
          console.log(`  Diferencia               ${pc.green("$0.00 — cuadrado")}`);
        }

        // ─── Estado ───
        console.log();
        if (team?.sat?.completed) {
          console.log(`${pc.green("●")} SAT conectado`);
        } else {
          console.log(`${pc.red("●")} SAT no conectado`);
        }

        if (team?.billing?.credits !== undefined) {
          const credits = team.billing.credits;
          console.log(`${credits > 0 ? pc.green("●") : pc.red("●")} ${credits} créditos restantes`);
        }

        console.log();
      } catch (e: any) {
        console.error(pc.red(`✗ ${e.message}`));
      }
    });
}

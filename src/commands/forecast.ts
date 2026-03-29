import { Command } from "commander";
import pc from "picocolors";
import { api, resolveTeam } from "../api.js";
import { formatMoney, spin, isJsonMode, printJson } from "../output.js";

const DAY_MS = 86400000;

function fmt(amount: number, currency = "MXN") {
  return formatMoney(amount, currency);
}

function sum(items: any[], key = "total"): number {
  return items.reduce((s, i) => s + (i?.[key] || 0), 0);
}

/** Get unix timestamp (seconds) for a Date */
function toUnix(d: Date): string {
  return String(Math.floor(d.getTime() / 1000));
}

/** Build month boundaries: first day 00:00 → last day 23:59:59 */
function monthRange(year: number, month: number): { gte: string; lte: string } {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59);
  return { gte: toUnix(start), lte: toUnix(end) };
}

/** Get the age in days of a record based on created_at */
function ageDays(item: any): number {
  const now = Date.now();
  const ts = item.created_at
    ? typeof item.created_at === "string"
      ? new Date(item.created_at).getTime()
      : item.created_at > 1e12
        ? item.created_at
        : item.created_at * 1000
    : now;
  return Math.floor((now - ts) / DAY_MS);
}

/** Collection probability based on age */
function collectionProbability(days: number): number {
  if (days <= 30) return 0.9;
  if (days <= 60) return 0.75;
  if (days <= 90) return 0.5;
  if (days <= 120) return 0.3;
  return 0.15;
}

/** Simple linear trend: compare avg of recent 3 months vs prior 3 months */
function calcTrend(monthlyValues: number[]): { avgAll: number; trend: number; arrow: string } {
  const valid = monthlyValues.filter((v) => v > 0);
  if (valid.length === 0) return { avgAll: 0, trend: 0, arrow: "→" };

  const avgAll = valid.reduce((a, b) => a + b, 0) / valid.length;

  if (valid.length < 4) {
    // Not enough data for trend comparison, use simple last vs first
    if (valid.length >= 2) {
      const first = valid[0];
      const last = valid[valid.length - 1];
      const pct = first > 0 ? ((last - first) / first) * 100 / (valid.length - 1) : 0;
      const arrow = pct > 5 ? "↑" : pct < -5 ? "↓" : "→";
      return { avgAll, trend: pct, arrow };
    }
    return { avgAll, trend: 0, arrow: "→" };
  }

  const mid = Math.floor(valid.length / 2);
  const prior = valid.slice(0, mid);
  const recent = valid.slice(mid);
  const avgPrior = prior.reduce((a, b) => a + b, 0) / prior.length;
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;

  if (avgPrior === 0) return { avgAll, trend: 0, arrow: "→" };

  const monthlyPct = ((avgRecent - avgPrior) / avgPrior) * 100 / mid;
  const arrow = monthlyPct > 5 ? "↑" : monthlyPct < -5 ? "↓" : "→";
  return { avgAll, trend: monthlyPct, arrow };
}

/** Project a value N months into the future given a monthly growth rate */
function project(base: number, monthlyPctChange: number, months: number): number {
  const factor = 1 + monthlyPctChange / 100;
  return base * Math.pow(factor, months);
}

/** Month name in Spanish */
function monthName(month: number, year: number): string {
  const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return `${names[month]} ${year}`;
}

/** Fetch a resource for a given month */
async function fetchMonth(
  resource: string,
  year: number,
  month: number,
  team?: string,
): Promise<any[]> {
  const range = monthRange(year, month);
  try {
    const res = await api("GET", resource, {
      query: { "created[gte]": range.gte, "created[lte]": range.lte, limit: "100" },
      team,
    });
    return (res.data || []).filter((d: any) => d != null);
  } catch {
    return [];
  }
}

export function registerForecastCommand(program: Command) {
  program
    .command("forecast")
    .description("Proyección de ingresos, cobranza, recibos EOM y flujo de efectivo")
    .option("--months <n>", "Meses a proyectar (default: 3)", "3")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const projMonths = Math.max(1, Math.min(12, parseInt(opts.months) || 3));
        const now = new Date();
        const curYear = now.getFullYear();
        const curMonth = now.getMonth(); // 0-indexed

        // ─── Fetch historical data (6 months) + current data ───
        const [team, histData, currentData] = await spin("Cargando datos históricos…", async () => {
          const t = await resolveTeam();

          // Build 6 months of history (excluding current month)
          const months: { year: number; month: number }[] = [];
          for (let i = 6; i >= 1; i--) {
            const d = new Date(curYear, curMonth - i, 1);
            months.push({ year: d.getFullYear(), month: d.getMonth() });
          }

          // Fetch all historical months in parallel
          const histPromises = months.map(async (m) => {
            const [invoices, payments, receipts] = await Promise.all([
              fetchMonth("/invoices/income", m.year, m.month, opts.team),
              fetchMonth("/payments", m.year, m.month, opts.team),
              fetchMonth("/receipts", m.year, m.month, opts.team),
            ]);
            return { ...m, invoices, payments, receipts };
          });

          // Current month data + PPD with balance + pending receipts + pending payments
          const currentPromises = Promise.all([
            fetchMonth("/invoices/income", curYear, curMonth, opts.team),
            fetchMonth("/payments", curYear, curMonth, opts.team),
            fetchMonth("/receipts", curYear, curMonth, opts.team),
            // PPD invoices (all, not just current month) — we need those with balance
            api("GET", "/invoices/income", {
              query: { limit: "100", payment_method: "PPD" },
              team: opts.team,
            }).then((r) => (r.data || []).filter((d: any) => d != null)).catch(() => []),
            // Pending payments (payment links)
            api("GET", "/payments", {
              query: { limit: "100", status: "pending" },
              team: opts.team,
            }).then((r) => (r.data || []).filter((d: any) => d != null)).catch(() => []),
          ]);

          const [hist, current] = await Promise.all([
            Promise.all(histPromises),
            currentPromises,
          ]);

          return [
            t,
            hist,
            {
              invoices: current[0],
              payments: current[1],
              receipts: current[2],
              ppdAll: current[3],
              pendingPayments: current[4],
            },
          ] as const;
        });

        const history = histData as { year: number; month: number; invoices: any[]; payments: any[]; receipts: any[] }[];
        const current = currentData as { invoices: any[]; payments: any[]; receipts: any[]; ppdAll: any[]; pendingPayments: any[] };

        // Detect currency
        const allInvoices = [...history.flatMap((h) => h.invoices), ...current.invoices];
        const allPayments = [...history.flatMap((h) => h.payments), ...current.payments];
        const cur = allInvoices[0]?.currency || allPayments[0]?.currency || "MXN";

        // ─── Per-month totals ───
        const monthlyInvoiced = history.map((h) => sum(h.invoices.filter((i: any) => i.status === "valid")));
        const monthlyCollected = history.map((h) => sum(h.payments.filter((p: any) => p.status === "succeeded")));
        const monthlyReceiptCount = history.map((h) => h.receipts.length);
        const monthlyReceiptTotal = history.map((h) => sum(h.receipts));
        const monthlyInvoicedReceiptCount = history.map((h) =>
          h.receipts.filter((r: any) => r.status === "invoiced" || r.status === "completed").length,
        );

        // ─── Revenue projection ───
        const revTrend = calcTrend(monthlyInvoiced);
        const projectedThisMonth = revTrend.avgAll * (1 + revTrend.trend / 100);
        const futureProjections: { month: string; revenue: number; collections: number; risk: number }[] = [];
        for (let i = 1; i <= projMonths; i++) {
          const d = new Date(curYear, curMonth + i, 1);
          futureProjections.push({
            month: monthName(d.getMonth(), d.getFullYear()),
            revenue: project(revTrend.avgAll, revTrend.trend, i),
            collections: project(
              calcTrend(monthlyCollected).avgAll,
              calcTrend(monthlyCollected).trend,
              i,
            ),
            risk: 0, // filled below
          });
        }

        // ─── Collections risk (PPD) ───
        const ppdWithBalance = current.ppdAll.filter((i: any) => {
          const balance = i.last_balance ?? i.total;
          return i.status === "valid" && balance > 0.01;
        });

        const ppdAnalysis = ppdWithBalance.map((i: any) => {
          const balance = i.last_balance ?? i.total ?? 0;
          const days = ageDays(i);
          const prob = collectionProbability(days);
          const clientName = i.client?.legal_name || i.client?.name || i.client_name || "Sin nombre";
          return { ...i, _balance: balance, _days: days, _prob: prob, _clientName: clientName };
        });

        const totalAtRisk = ppdAnalysis.reduce((s: number, i: any) => s + i._balance, 0);
        const expectedRecovery = ppdAnalysis.reduce((s: number, i: any) => s + i._balance * i._prob, 0);
        const likelyLoss = totalAtRisk - expectedRecovery;
        const highRisk = ppdAnalysis.filter((i: any) => i._days > 90);
        const highRiskAmount = highRisk.reduce((s: number, i: any) => s + i._balance, 0);

        // Top 3 highest-risk (oldest + biggest balance)
        const topRisk = [...ppdAnalysis]
          .sort((a, b) => a._prob - b._prob || b._balance - a._balance)
          .slice(0, 3);

        // Fill risk in future projections (diminishing PPD recovery)
        for (let i = 0; i < futureProjections.length; i++) {
          futureProjections[i].risk = highRiskAmount * Math.pow(0.85, i + 1);
        }

        // ─── EOM global invoice estimate ───
        const pendingReceipts = current.receipts.filter(
          (r: any) => r.status === "pending" || r.status === "open",
        );
        const pendingReceiptsTotal = sum(pendingReceipts);
        const pendingReceiptsCount = pendingReceipts.length;

        // Historical self-invoice rate
        const totalHistReceipts = monthlyReceiptCount.reduce((a, b) => a + b, 0);
        const totalHistInvoiced = monthlyInvoicedReceiptCount.reduce((a, b) => a + b, 0);
        const selfInvoiceRate = totalHistReceipts > 0 ? totalHistInvoiced / totalHistReceipts : 0;
        const estGlobalCount = Math.round(pendingReceiptsCount * (1 - selfInvoiceRate));
        const estGlobalAmount = pendingReceiptsTotal * (1 - selfInvoiceRate);

        // ─── Cash flow projection ───
        const pendingPayCount = current.pendingPayments.length;
        const pendingPayTotal = sum(current.pendingPayments);

        // Historical payment conversion rate
        const totalHistPayments = history.reduce((s, h) => s + h.payments.length, 0);
        const totalHistSucceeded = history.reduce(
          (s, h) => s + h.payments.filter((p: any) => p.status === "succeeded").length,
          0,
        );
        const conversionRate = totalHistPayments > 0 ? totalHistSucceeded / totalHistPayments : 0.85;

        const expectedFromLinks = pendingPayTotal * conversionRate;
        const expectedFromPPD = expectedRecovery;
        const totalExpectedCash = expectedFromLinks + expectedFromPPD;

        // ─── JSON output ───
        if (isJsonMode()) {
          return printJson({
            period: monthName(curMonth, curYear),
            team: { name: (team as any)?.legal_name || (team as any)?.brand?.alias, tax_id: (team as any)?.tax_id },
            revenue: {
              monthly_average_6m: Math.round(revTrend.avgAll * 100) / 100,
              trend_pct: Math.round(revTrend.trend * 100) / 100,
              trend_direction: revTrend.arrow === "↑" ? "growing" : revTrend.arrow === "↓" ? "declining" : "stable",
              projected_this_month: Math.round(projectedThisMonth * 100) / 100,
              projections: futureProjections.map((p) => ({
                month: p.month,
                revenue: Math.round(p.revenue * 100) / 100,
                collections: Math.round(p.collections * 100) / 100,
                risk: Math.round(p.risk * 100) / 100,
              })),
              monthly_history: history.map((h, idx) => ({
                month: monthName(h.month, h.year),
                invoiced: monthlyInvoiced[idx],
                collected: monthlyCollected[idx],
                receipts: monthlyReceiptCount[idx],
              })),
            },
            collections_risk: {
              total_pending: Math.round(totalAtRisk * 100) / 100,
              invoice_count: ppdWithBalance.length,
              expected_recovery: Math.round(expectedRecovery * 100) / 100,
              recovery_pct: totalAtRisk > 0 ? Math.round((expectedRecovery / totalAtRisk) * 100) : 0,
              likely_loss: Math.round(likelyLoss * 100) / 100,
              high_risk: {
                amount: Math.round(highRiskAmount * 100) / 100,
                count: highRisk.length,
              },
              top_risk: topRisk.map((i: any) => ({
                client: i._clientName,
                balance: i._balance,
                days: i._days,
                probability: i._prob,
              })),
            },
            eom_estimate: {
              pending_receipts: pendingReceiptsCount,
              pending_amount: Math.round(pendingReceiptsTotal * 100) / 100,
              self_invoice_rate: Math.round(selfInvoiceRate * 100),
              estimated_global_count: estGlobalCount,
              estimated_global_amount: Math.round(estGlobalAmount * 100) / 100,
            },
            cash_flow: {
              pending_payment_links: pendingPayCount,
              pending_links_amount: Math.round(pendingPayTotal * 100) / 100,
              conversion_rate: Math.round(conversionRate * 100),
              expected_from_links: Math.round(expectedFromLinks * 100) / 100,
              expected_from_ppd: Math.round(expectedFromPPD * 100) / 100,
              total_expected: Math.round(totalExpectedCash * 100) / 100,
            },
          });
        }

        // ─── Terminal output ───
        const teamName = (team as any)?.legal_name || (team as any)?.brand?.alias || "—";
        console.log(`\n${pc.bold(`Proyección — ${monthName(curMonth, curYear)}`)}`);
        console.log(pc.dim(teamName));

        // Facturación
        console.log(`\n${pc.bold(pc.underline("Facturación"))}`);
        console.log(`  Promedio mensual (6m)    ${fmt(revTrend.avgAll, cur)}`);
        const trendColor = revTrend.arrow === "↑" ? pc.green : revTrend.arrow === "↓" ? pc.red : pc.yellow;
        const trendSign = revTrend.trend >= 0 ? "+" : "";
        console.log(`  Tendencia                ${trendColor(`${revTrend.arrow} ${trendSign}${Math.round(revTrend.trend)}% mensual`)}`);
        console.log(`  Proyección este mes      ${pc.green(fmt(projectedThisMonth, cur))}`);

        if (futureProjections.length > 0) {
          const projStr = futureProjections.map((p) => fmt(p.revenue, cur)).join(" → ");
          console.log(`  Próximos ${projMonths} meses         ${projStr}`);
        }

        // Cobranza PPD
        console.log(`\n${pc.bold(pc.underline("Cobranza PPD"))}`);
        if (ppdAnalysis.length === 0) {
          console.log(`  ${pc.dim("Sin facturas PPD pendientes")}`);
        } else {
          const recoveryPct = totalAtRisk > 0 ? Math.round((expectedRecovery / totalAtRisk) * 100) : 0;
          console.log(`  Total pendiente          ${pc.red(fmt(totalAtRisk, cur))}  ${pc.dim(`(${ppdWithBalance.length} facturas)`)}`);
          console.log(`  Recuperación esperada    ${pc.green(fmt(expectedRecovery, cur))}   ${pc.dim(`(${recoveryPct}%)`)}`);
          if (highRisk.length > 0) {
            console.log(`  En riesgo alto           ${pc.red(fmt(highRiskAmount, cur))}   ${pc.dim(`(${highRisk.length} facturas +90 días)`)}`);
          }
          if (topRisk.length > 0) {
            console.log(pc.dim("  Mayor riesgo:"));
            for (const r of topRisk) {
              const probStr = `${Math.round(r._prob * 100)}%`;
              const name = r._clientName.length > 22 ? r._clientName.slice(0, 22) + "…" : r._clientName;
              console.log(
                `    ${name.padEnd(24)} ${fmt(r._balance, cur).padEnd(16)} ${String(r._days).padStart(3)} días  ${pc.dim(`prob: ${probStr}`)}`,
              );
            }
          }
        }

        // Recibos → Factura Global
        console.log(`\n${pc.bold(pc.underline("Recibos → Factura Global"))}`);
        console.log(`  Pendientes hoy           ${String(pendingReceiptsCount).padEnd(5)} recibos    ${fmt(pendingReceiptsTotal, cur)}`);
        console.log(`  Tasa histórica autofact  ${selfInvoiceRate > 0 ? `${Math.round(selfInvoiceRate * 100)}%` : pc.dim("sin datos")}`);
        console.log(`  Estimado factura global  ~${String(estGlobalCount).padEnd(4)} recibos   ${fmt(estGlobalAmount, cur)}`);

        // Flujo de Efectivo
        console.log(`\n${pc.bold(pc.underline("Flujo de Efectivo"))}`);
        console.log(`  Pagos pendientes         ${String(pendingPayCount).padEnd(5)} links      ${fmt(pendingPayTotal, cur)}`);
        console.log(`  Conversión histórica     ${Math.round(conversionRate * 100)}%`);
        console.log(`  Cobro esperado (links)   ${pc.green(fmt(expectedFromLinks, cur))}`);
        console.log(`  Cobro esperado (PPD)     ${pc.green(fmt(expectedFromPPD, cur))}`);
        console.log(`  ${pc.bold("Total entrada esperada")}   ${pc.green(pc.bold(fmt(totalExpectedCash, cur)))}`);

        // Multi-month table
        if (projMonths > 1) {
          console.log(`\n${pc.bold(pc.underline("Proyección multi-mes"))}`);
          const colTrend = calcTrend(monthlyCollected);
          const header = `  ${"Mes".padEnd(20)} ${"Ingresos".padStart(18)} ${"Cobranza".padStart(18)} ${"Riesgo".padStart(18)}`;
          console.log(pc.dim(header));
          console.log(pc.dim("  " + "─".repeat(76)));
          for (const p of futureProjections) {
            console.log(
              `  ${p.month.padEnd(20)} ${pc.green(fmt(p.revenue, cur).padStart(18))} ${fmt(p.collections, cur).padStart(18)} ${pc.red(fmt(p.risk, cur).padStart(18))}`,
            );
          }
        }

        console.log();
      } catch (e: any) {
        console.error(pc.red(`✗ ${e.message}`));
      }
    });
}

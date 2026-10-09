const keys = [
  "invoices",
  "invoicesComplements",
  "invoicesEgress",
  "payments",
  "paymentsReminders",
  "paymentsRemindersAfter",
  "receipts",
  "receiptsReminders",
  "bankReview",
];
export function safeEmailTemplates(value: any, team: string) {
  if (
    !value ||
    value.team_id !== team ||
    value.effect_scope !== "team_shared" ||
    value.source !== "editor_baseline" ||
    typeof value.is_nonprofit !== "boolean" ||
    typeof value.english_enabled !== "boolean"
  )
    throw new Error("Plantillas con alcance inválido");
  const templates_by_language = Object.fromEntries(
    ["es", "en"].map((lang) => [
      lang,
      Object.fromEntries(
        keys.map((k) => {
          const t = value.templates_by_language?.[lang]?.[k];
          if (!t || typeof t.subject !== "string" || typeof t.body !== "string")
            throw new Error("Plantilla incompleta");
          return [k, { body: t.body, subject: t.subject }];
        }),
      ),
    ]),
  );
  return {
    team_id: team,
    effect_scope: "team_shared",
    source: "editor_baseline",
    is_nonprofit: value.is_nonprofit,
    english_enabled: value.english_enabled,
    templates_by_language,
  };
}

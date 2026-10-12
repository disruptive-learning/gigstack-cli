/** Explicit recipient metadata projection. Raw records and invitation capabilities never print. */
export function safeRecipientInbox(value: any) {
  const fail = (): never => {
    throw new Error("No se pudo confirmar la bandeja de invitaciones.");
  };
  const id = (v: any) =>
    typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
  const nullable = (v: any) => v === null || typeof v === "string";
  if (
    !Array.isArray(value?.data) ||
    typeof value.has_more !== "boolean" ||
    !nullable(value.next_cursor) ||
    (value.next_cursor?.length ?? 0) > 1024
  )
    return fail();
  const data = value.data.map((v: any) => {
    if (
      !id(v.id) ||
      typeof v.email !== "string" ||
      !["admin", "editor", "viewer"].includes(v.rol) ||
      v.status !== "pending" ||
      v.accepted !== false ||
      !["team", "billingAccount"].includes(v.type) ||
      !id(v.billingId) ||
      !Number.isFinite(v.expiring) ||
      !(v.timestamp === null || Number.isFinite(v.timestamp)) ||
      typeof v.approval_required !== "boolean" ||
      ![v.emailOwner, v.teamName, v.billingName].every(nullable)
    )
      return fail();
    let team = null;
    if (v.type === "team") {
      if (
        !id(v.teamId) ||
        !v.team ||
        v.team.id !== v.teamId ||
        v.team.billingAccount !== v.billingId ||
        ![v.team.alias, v.team.logo, v.team.primaryColor].every(nullable) ||
        !Number.isInteger(v.team.members) ||
        v.team.members < 0
      )
        return fail();
      team = {
        id: v.team.id,
        alias: v.team.alias,
        logo: v.team.logo,
        primaryColor: v.team.primaryColor,
        billingAccount: v.team.billingAccount,
        members: v.team.members,
      };
    } else if (v.teamId !== null || v.team !== null) return fail();
    return {
      id: v.id,
      email: v.email,
      emailOwner: v.emailOwner,
      rol: v.rol,
      status: v.status,
      accepted: false,
      type: v.type,
      expiring: v.expiring,
      timestamp: v.timestamp,
      teamId: v.teamId,
      teamName: v.teamName,
      billingId: v.billingId,
      billingName: v.billingName,
      approval_required: v.approval_required,
      team,
    };
  });
  return { data, has_more: value.has_more, next_cursor: value.next_cursor };
}

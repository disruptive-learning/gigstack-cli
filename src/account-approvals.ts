import { api } from './api.js';
import { runtimeOptions } from './runtime.js';
import { printJson } from './output.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ApprovalAction = 'api_keys.generate' | 'api_keys.rotate' | 'mcp_tokens.create' | 'team.ownership.transfer' | 'team.members.promote_admin' | 'team.members.add_admin';
const membershipActions = ['team.ownership.transfer', 'team.members.promote_admin', 'team.members.add_admin'];
export function membershipTarget(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Identidad destino inválida para aprobación');
  return value;
}
const idPattern = /^[a-f0-9]{64}$/;
export function approvalId(value: string) {
  if (!idPattern.test(value)) throw new Error('ID de aprobación inválido');
  return value;
}
export function approvalTeam(explicit?: unknown): string {
  const selected = runtimeOptions().team || process.env.GIGSTACK_TEAM;
  if (explicit && selected && explicit !== selected) throw new Error('El equipo no coincide con --team');
  const team = explicit || selected;
  if (typeof team !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(team)) throw new Error('Indica el equipo explícitamente con --team o team_id');
  return team;
}
// Allowlist each public DTO field. Never forward the response envelope, raw error,
// browser execution payload, challenge, or accidentally returned secret.
export function publicApproval(raw: any) {
  const text = (v: unknown): string => { if (typeof v !== 'string') throw new Error('Respuesta de aprobación inválida'); return v; };
  const nullable = (v: unknown) => v === null ? null : text(v);
  const num = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Respuesta de aprobación inválida'); return v; };
  const bool = (v: unknown): boolean => { if (typeof v !== 'boolean') throw new Error('Respuesta de aprobación inválida'); return v; };
  const one = (v: unknown, choices: string[]) => { const value = text(v); if (!choices.includes(value)) throw new Error('Respuesta de aprobación inválida'); return value; };
  const list = (v: unknown): any[] => { if (!Array.isArray(v)) throw new Error('Respuesta de aprobación inválida'); return v; };
  const count = (v: unknown): number => { const value = num(v); if (!Number.isSafeInteger(value) || value < 0) throw new Error('Respuesta de aprobación inválida'); return value; };
  if (raw.terms !== null && (raw.terms?.url !== 'https://pro-gigstack.s3.us-east-2.amazonaws.com/legal/terms.pdf' || raw.terms?.acceptance_required !== true)) throw new Error('Términos de aprobación inválidos');
  const id = approvalId(text(raw.id));
  const review = new URL(text(raw.review_url));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(review.hostname);
  if ((review.protocol !== 'https:' && !(local && review.protocol === 'http:')) || review.username || review.password || review.search || review.hash || review.pathname !== `/account/approvals/${id}`) throw new Error('URL de aprobación inválida');
  const operation_id = text(raw.operation_id);
  if (!uuid.test(operation_id)) throw new Error('Operación de aprobación inválida');
  const action = one(raw.action, ['api_keys.generate', 'api_keys.rotate', 'mcp_tokens.create', ...membershipActions]);
  const membership = membershipActions.includes(action);
  if (membership && (!raw.membership_change || raw.effect_scope !== 'team_membership' || list(raw.requested_modes).length || list(raw.existing_key_ids).length || raw.terms !== null || (raw.status === 'completed' && raw.receipt?.membership?.action !== action))) throw new Error('Resumen o recibo de membresía inconsistente');
  if (!membership && (raw.membership_change !== null || (raw.receipt && raw.receipt.membership !== null))) throw new Error('Resultado de membresía inesperado');
  const change = raw.membership_change;
  const result = raw.receipt?.membership;
  if (change && (change.billing_ownership_changes !== false || change.hidden_member !== false)) throw new Error('Efectos de membresía inesperados');
  return {
    id, operation_id, action,
    team: { id: text(raw.team.id), legal_name: nullable(raw.team.legal_name), tax_id: nullable(raw.team.tax_id) },
    billing_account_id: text(raw.billing_account_id),
    payload: { ...(raw.payload.name === undefined ? {} : { name: text(raw.payload.name) }), ...(raw.payload.livemode === undefined ? {} : { livemode: bool(raw.payload.livemode) }), ...(raw.payload.new_owner_id === undefined ? {} : { new_owner_id: membershipTarget(raw.payload.new_owner_id) }), ...(raw.payload.member_id === undefined ? {} : { member_id: membershipTarget(raw.payload.member_id) }) },
    requested_modes: list(raw.requested_modes).map(bool), effect_scope: one(raw.effect_scope, ['user_access', 'team_credentials', 'team_membership']),
    membership_change: change === null ? null : { target: { id: membershipTarget(change.target.id), email: nullable(change.target.email), display_name: nullable(change.target.display_name) }, previous_owner_id: membershipTarget(change.previous_owner_id), previous_role: change.previous_role === null ? null : one(change.previous_role, ['admin', 'editor', 'viewer', 'blocked']), new_role: one(change.new_role, ['admin']), transfers_ownership: bool(change.transfers_ownership), billing_ownership_changes: false, hidden_member: false },
    status: one(raw.status, ['pending', 'completed', 'cancelled', 'expired', 'invalidated']),
    created_at: num(raw.created_at), expires_at: num(raw.expires_at), completed_at: raw.completed_at === null ? null : num(raw.completed_at),
    review_url: review.toString(), can_cancel: bool(raw.can_cancel), disclosure_version: text(raw.disclosure_version), existing_key_ids: list(raw.existing_key_ids).map(text),
    terms: raw.terms === null ? null : { url: 'https://pro-gigstack.s3.us-east-2.amazonaws.com/legal/terms.pdf', acceptance_required: true },
    receipt: raw.receipt === null ? null : { keys: list(raw.receipt.keys).map(k => ({ key_id: text(k.key_id), type: one(k.type, ['api', 'mcp']), livemode: bool(k.livemode) })), revoked_count: count(raw.receipt.revoked_count), membership: result === null ? null : { action: one(result.action, membershipActions), member_id: membershipTarget(result.member_id), owner_id: membershipTarget(result.owner_id), previous_owner_id: membershipTarget(result.previous_owner_id), role: one(result.role, ['admin']), is_owner: bool(result.is_owner), added: bool(result.added) } },
    error: raw.error === null ? null : { code: 'approval_invalidated', message: 'El estado de la cuenta cambió. Prepara y revisa una nueva aprobación.', retryable: false },
  };
}
export async function approvalRequest(method: string, path: string, reference: string, body?: unknown, team?: string) {
  let data;
  try { data = publicApproval((await api(method, path, { body, ...(team ? { team } : {}) })).data); }
  catch { throw Object.assign(new Error(`No se confirmó la solicitud de aprobación. Conserva la referencia ${reference}; consulta su estado o repite la preparación idéntica con el mismo operation_id. No se reintentó automáticamente.`), { code: 'approval_not_confirmed' }); }
  printJson({ success: true, data, next_step: data.status === 'pending' ? data.effect_scope === 'team_membership' ? 'Abre review_url y revisa personalmente el destino y propietario/rol anterior. Preparar no cambia membresía; confirmar afecta al equipo en ambos modos, sin transferir propiedad de facturación.' : 'Abre review_url en el navegador, revisa la acción y confirma personalmente. Los términos y secretos se entregan sólo allí; preparar no emite credenciales.' : 'Consulta el estado y recibo de metadatos. No se pueden recuperar secretos por CLI.' });
  if (['expired', 'invalidated'].includes(data.status)) process.exitCode = 1;
}
export async function prepareApproval(operation: string, action: ApprovalAction, team: string, payload: Record<string, unknown>) {
  if (!uuid.test(operation)) throw new Error('--operation-id debe ser un UUIDv4 guardado antes del primer intento; reutilízalo sólo para la misma solicitud');
  const operation_id = operation.toLowerCase();
  return approvalRequest('POST', '/users/me/account-approvals', operation_id, { operation_id, action, team_id: team, payload }, team);
}

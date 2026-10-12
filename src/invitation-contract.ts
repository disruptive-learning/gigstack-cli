import { api, ApiError } from './api.js';
import { printJson } from './output.js';
export const invitationActions = ['team.invitations.create_admin', 'billing_account.invitations.create_admin'];
const bad = () => { throw new Error('Respuesta de invitación inválida'); };
const str = (v: any): string => typeof v === 'string' ? v : bad();
const nullable = (v:any) => v === null ? null : str(v);
const num = (v:any):number => typeof v === 'number' && Number.isFinite(v) ? v : bad();
const bool = (v:any):boolean => typeof v === 'boolean' ? v : bad();
export const invitationId = (v:any):string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : bad();
export function invitationPayload(email:unknown, send_email:unknown, existing?:unknown) {
  if (typeof email !== 'string' || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo de invitación inválido');
  if (typeof send_email !== 'boolean') throw new Error('Elige explícitamente --send-email o --no-send-email');
  if (existing && send_email) throw new Error('Recuperar una invitación requiere --no-send-email; el reenvío es una decisión posterior');
  return {email:email.trim().toLowerCase(),send_email,...(existing ? {existing_invitation_id:invitationId(existing)} : {})};
}
export function projectInvitationApproval(raw:any) {
  const c=raw.invitation_change, r=raw.receipt?.invitation, billing=raw.action === 'billing_account.invitations.create_admin';
  if (!c || raw.membership_change !== null || raw.effect_scope !== (billing ? 'billing_account_membership':'team_membership') || raw.disclosure_version !== 'invitation-approval-v1' || raw.requested_modes?.length !== 0 || raw.existing_key_ids?.length !== 0 || raw.terms !== null ||
    (billing ? raw.team !== null : !raw.team) || c.type !== (billing ? 'billingAccount':'team') || c.team_id !== (billing ? null : raw.team.id) || c.billing_account_id !== raw.billing_account_id || c.email !== raw.payload.email || c.send_email !== raw.payload.send_email || c.role !== 'admin' || c.existing_invitation !== !!raw.payload.existing_invitation_id ||
    (c.existing_invitation && (c.id !== raw.payload.existing_invitation_id || c.send_email)) || (raw.status === 'completed' && !r) || (raw.receipt && (raw.receipt.keys?.length !== 0 || raw.receipt.revoked_count !== 0 || raw.receipt.membership !== null))) return bad();
  const change={id:invitationId(c.id),type:c.type,email:str(c.email),role:'admin',team_id:c.team_id===null?null:invitationId(c.team_id),billing_account_id:invitationId(c.billing_account_id),billing_account_name:nullable(c.billing_account_name),inviter:{id:invitationId(c.inviter.id),email:nullable(c.inviter.email),display_name:nullable(c.inviter.display_name)},send_email:bool(c.send_email),expires_at:num(c.expires_at),existing_invitation:bool(c.existing_invitation),prior_delivery_status:nullable(c.prior_delivery_status)};
  if (r && (r.id!==c.id || r.type!==c.type || r.email!==c.email || r.role!=='admin' || r.team_id!==c.team_id || r.billing_account_id!==c.billing_account_id || r.expires_at!==c.expires_at || r.approval_id!==raw.id)) return bad();
  return {change,receipt:r?{id:change.id,type:change.type,email:change.email,role:'admin',team_id:change.team_id,billing_account_id:change.billing_account_id,expires_at:change.expires_at,approval_id:str(r.approval_id)}:null};
}
export function publicInvitation(raw:any) {
  if (!['admin','editor','viewer'].includes(raw.role) || !['not_requested','pending','sent','failed','unknown'].includes(raw.delivery?.status)) return bad();
  return {id:invitationId(raw.id),email:str(raw.email),role:raw.role,team_id:raw.team_id===null?null:invitationId(raw.team_id),
    ...(raw.type===undefined?{}:{type:['team','billingAccount'].includes(raw.type)?raw.type:bad()}),...(raw.billing_account_id===undefined?{}:{billing_account_id:raw.billing_account_id===null?null:invitationId(raw.billing_account_id)}),...(raw.approval_required===undefined?{}:{approval_required:bool(raw.approval_required)}),
    status:str(raw.status),created_at:raw.created_at===null?null:num(raw.created_at),expires_at:raw.expires_at===null?null:num(raw.expires_at),created_by:nullable(raw.created_by),delivery:{status:raw.delivery.status,attempted_at:raw.delivery.attempted_at===null?null:num(raw.delivery.attempted_at)}};
}
export async function ownedInvitationRequest(method:string,id:string,ack=false) {
  invitationId(id);
  let data;
  try { data=publicInvitation((await api(method,`/users/me/account-invitations/${id}${method==='POST'?'/resend':''}`,{...(method==='GET'?{}:{body:method==='POST'&&ack?{acknowledge_unconfirmed_delivery:true}:{}})})).data); if (data.id !== id) return bad(); }
  catch(error) {
    const code=error instanceof ApiError && ['delivery_outcome_unknown','delivery_in_progress','account_approval_required','owner_required','email_verification_required'].includes(error.code??'') ? error.code : 'invitation_not_confirmed';
    throw Object.assign(new Error(`No se confirmó la operación de invitación ${id}. Consulta su estado antes de reenviar; un correo anterior puede haber llegado. No se reintentó automáticamente.`),{code});
  }
  printJson({success:true,data,next_step:'La aprobación no prueba envío ni aceptación. Consulta delivery antes de elegir un reenvío; unknown puede significar que el correo ya llegó.'});
  if (['unknown','failed'].includes(data.delivery.status)) process.exitCode=1;
}

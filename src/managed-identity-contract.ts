// Explicit public projection: never forward Auth records, tokens or browser challenges.
const fail = (): never => { throw new Error('Invalid managed identity approval'); };
const obj = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : fail();
const text = (value: unknown): string => typeof value === 'string' ? value : fail();
const id = (value: unknown): string => /^[A-Za-z0-9_-]{1,128}$/.test(text(value)) ? value as string : fail();
const exact = <T>(value: unknown, expected: T): T => value === expected ? expected : fail();
const one = (value: unknown, values: string[]): string => values.includes(text(value)) ? value as string : fail();
const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : fail();
const bool = (value: unknown): boolean => typeof value === 'boolean' ? value : fail();
const profileKeys = ['first_name','last_name','phone','company_role','address'];
const addressKeys = ['country','street','zip','city','state','exterior','municipality','neighborhood'];
export const canonical = (value: unknown): string => JSON.stringify(normalize(value));
function normalize(value: unknown): unknown { return Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)])) : value; }
export function managedProfile(value: unknown, strict = false): Record<string, unknown> {
  const raw=obj(value), out:Record<string,unknown>={};
  if(strict && Object.keys(raw).some(k=>!profileKeys.includes(k)))fail();
  for(const k of profileKeys)if(raw[k]!==undefined){
    if(raw[k]===null){out[k]=null;continue;}
    if(k==='address'){
      const address=obj(raw[k]);if(strict&&Object.keys(address).some(k=>!addressKeys.includes(k)))fail();
      out[k]=Object.fromEntries(addressKeys.filter(k=>address[k]!==undefined).map(k=>{const value=address[k]===null?null:text(address[k]);if(value&&value.length>250)fail();return[k,value];}));
    }else {const value=text(raw[k]);if(value.length>100||(k==='phone'&&!/^\+[1-9]\d{7,14}$/.test(value)))fail();out[k]=value;}
  }
  return out;
}
export function managedInput(value: unknown): Record<string,unknown> {
  const raw=obj(value);if(Object.keys(raw).some(k=>!['email',...profileKeys].includes(k)))fail();
  const email=text(raw.email).trim().toLowerCase();if(email.length>320||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))fail();
  const {email:_,...profile}=raw;return{email,...managedProfile(profile,true)};
}
export function projectManagedApproval(raw: any) {
  const change=obj(raw.managed_identity_change),payload={email:text(raw.payload.email),...managedProfile(raw.payload)};
  const profile=managedProfile(change.profile);
  if(canonical(payload)!==canonical({email:change.email,...profile})||change.team_id!==raw.team?.id||change.billing_account_id!==raw.billing_account_id)fail();
  if(raw.effect_scope!=='managed_identity'||raw.disclosure_version!=='managed-identity-v1'||raw.terms!==null||!Array.isArray(raw.requested_modes)||raw.requested_modes.length||!Array.isArray(raw.existing_key_ids)||raw.existing_key_ids.length)fail();
  const bootstrap=['profile_initialization','membership_usage_initialization','support_identity_claims'];if(canonical(change.bootstrap_effects)!==canonical(bootstrap))fail();
  const projected={user_id:id(change.user_id),email:text(change.email),profile,team_id:id(change.team_id),billing_account_id:id(change.billing_account_id),role:exact(change.role,'admin'),auto_join:exact(change.auto_join,true),credential_delivery:exact(change.credential_delivery,'none'),initial_auth_state:exact(change.initial_auth_state,'disabled'),bootstrap_effects:bootstrap};
  let execution=null;
  if(raw.managed_identity_execution!=null){const e=obj(raw.managed_identity_execution);execution={phase:one(e.phase,['creating','activation_required','activating','complete','failed']),auth_state:one(e.auth_state,['unknown','disabled','enabled']),membership_granted:bool(e.membership_granted),started_at:num(e.started_at),updated_at:num(e.updated_at),error_code:e.error_code===null?null:one(e.error_code,['auth_outcome_unknown','auth_creation_rejected','auth_incarnation_mismatch'])};}
  let receipt=null;
  if(raw.receipt!==null){const r=obj(raw.receipt.managed_identity);if(raw.status!=='completed'||raw.receipt.membership!==null||raw.receipt.invitation!==null||!Array.isArray(raw.receipt.keys)||raw.receipt.keys.length||raw.receipt.revoked_count!==0||r.user_id!==projected.user_id||r.team_id!==projected.team_id||r.billing_account_id!==projected.billing_account_id)fail();receipt={user_id:id(r.user_id),team_id:id(r.team_id),billing_account_id:id(r.billing_account_id),role:exact(r.role,'admin'),auth_state:exact(r.auth_state,'enabled'),membership_granted:exact(r.membership_granted,true)};}
  if(raw.status==='completed'&&(!receipt||execution?.phase!=='complete'||execution.auth_state!=='enabled'||!execution.membership_granted))fail();
  if(raw.status==='activation_required'&&(!execution||execution.phase!=='activation_required'||execution.auth_state!=='disabled'||execution.membership_granted))fail();
  if(['processing','unknown','failed'].includes(raw.status)&&!execution)fail();
  return{payload,change:projected,execution,receipt};
}
export function managedNextStep(status:string){
  if(status==='pending')return 'Open review_url to review disabled identity creation. No email, credentials or membership have been created by preparation.';
  if(status==='activation_required')return 'Disabled identity creation is confirmed. Open review_url for a new review before membership grant and activation.';
  if(status==='completed')return 'Enabled identity and membership grant confirmed. No credentials were issued; this does not establish password setup or login.';
  if(status==='processing'||status==='unknown')return 'Do not repeat creation or activation. Use account-approvals reconcile with this approval ID to read evidence; unresolved outcomes need operator recovery.';
  return 'No completed identity activation is established. Preserve this approval ID for review; do not automatically repeat provisioning.';
}

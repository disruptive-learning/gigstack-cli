// Named-key requests use explicit reviewed operation IDs, never wildcard grants.
export const scopedKeyActions = ['api_keys.create_scoped', 'api_keys.rotate_scoped'] as const;
const identity = /^[A-Za-z0-9_-]{1,128}$/;
export function scopedIdentity(value: unknown): string {
  if (typeof value !== 'string' || !identity.test(value)) throw new Error('Identificador de clave/cuenta/equipo/administrador inválido');
  return value;
}
function fields(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).sort().join() !== expected.sort().join()) throw new Error('Campos de solicitud de clave inválidos o incompletos');
}
function ids(value: unknown, action = false, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > (action ? 40 : 100) || (!allowEmpty && !value.length) || value.some(v => typeof v !== 'string' || (action ? !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(v) : !identity.test(v))) || new Set(value).size !== value.length) throw new Error('Lista explícita de IDs no vacíos y únicos requerida; consulta policy para IDs permitidos');
  return [...value].sort();
}
export function scopedCreatePayload(value: Record<string, unknown>) {
  fields(value, ['name','livemode','billing_account_id','team_ids','action_ids','expires_at','manager_user_ids']);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 64 || typeof value.livemode !== 'boolean' || !Number.isSafeInteger(value.expires_at) || (value.expires_at as number) <= 0) throw new Error('Nombre, modo explícito y expires_at en milisegundos requeridos');
  return { name:value.name.trim(),livemode:value.livemode,billing_account_id:scopedIdentity(value.billing_account_id),team_ids:ids(value.team_ids),action_ids:ids(value.action_ids,true),expires_at:value.expires_at as number,manager_user_ids:ids(value.manager_user_ids,false,true) };
}
export function scopedRotatePayload(value: Record<string, unknown>) {
  fields(value,['key_id','overlap_seconds']);
  if (!Number.isSafeInteger(value.overlap_seconds) || ((value.overlap_seconds as number) < 0 || (value.overlap_seconds as number) > 86400)) throw new Error('overlap_seconds explícito entero no negativo requerido; consulta el límite del servidor');
  return {key_id:scopedIdentity(value.key_id),overlap_seconds:value.overlap_seconds as number};
}

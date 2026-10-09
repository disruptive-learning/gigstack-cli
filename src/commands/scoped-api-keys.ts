import { Command } from 'commander';
import { api } from '../api.js';
import { printJson } from '../output.js';
import { withJsonInput, readJsonInput, requireConfirmation } from '../input.js';
import { scopedIdentity, scopedCreatePayload, scopedRotatePayload } from '../scoped-api-key-input.js';
import { scopedMetadata, scopedList, scopedPolicy, scopedAudit } from '../scoped-api-keys.js';
import { approvalRequest } from '../account-approvals.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function operation(v:string){if(!uuid.test(v))throw new Error('--operation-id debe ser UUIDv4 guardado antes del primer intento');return v.toLowerCase();}
export function registerScopedApiKeyCommands(program:Command){
 const keys=program.command('scoped-api-keys').description('Claves con nombre, modo, equipos/acciones/expiry/managers; identidad personal requerida, nunca secretos por CLI');
 const account=(cmd:Command)=>cmd.requiredOption('--billing-account <id>','Cuenta de facturación explícita');
 const page=(cmd:Command)=>cmd.option('--limit <n>','1–100','20').option('--cursor <cursor>','next_cursor previo; continuar hasta null');
 const query=(o:any)=>{const n=Number(o.limit);if(!Number.isSafeInteger(n)||n<1||n>100)throw new Error('--limit debe ser 1–100');return{billing_account_id:scopedIdentity(o.billingAccount),limit:String(n),...(o.cursor?{cursor:o.cursor}:{})};};
 async function safeRead(path:string,o:any,parse:(v:any)=>unknown,paged=false){try{const response=await api('GET',path,{query:paged?query(o):{billing_account_id:scopedIdentity(o.billingAccount)},identityOnly:true});printJson({success:true,data:parse(response.data)});}catch(e:any){throw Object.assign(new Error('No se confirmó la lectura segura de claves. Revisa cuenta, identidad personal y permisos actuales.'),{code:e.code==='scoped_permission_required'?e.code:'scoped_key_read_not_confirmed'});}}
 page(account(keys.command('list'))).action(o=>safeRead('/users/me/scoped-api-keys',o,v=>scopedList(v,scopedIdentity(o.billingAccount)),true));
 account(keys.command('policy')).action(o=>safeRead('/users/me/scoped-api-keys/policy',o,v=>scopedPolicy(v,scopedIdentity(o.billingAccount))));
 account(keys.command('get <keyId>')).action((id,o)=>safeRead(`/users/me/scoped-api-keys/${scopedIdentity(id)}`,o,v=>{const m=scopedMetadata(v);if(m.id!==id||m.billing_account_id!==o.billingAccount)throw new Error('Clave distinta');return m;}));
 page(account(keys.command('audit <keyId>'))).action((id,o)=>safeRead(`/users/me/scoped-api-keys/${scopedIdentity(id)}/audit`,o,v=>scopedAudit(v,id),true));
 withJsonInput(keys.command('prepare-create').requiredOption('--operation-id <uuid>','UUIDv4 persistido; preparación no emite credenciales')).action(async o=>{const payload=scopedCreatePayload(await readJsonInput(o));const operation_id=operation(o.operationId);await approvalRequest('POST','/users/me/account-approvals',operation_id,{operation_id,action:'api_keys.create_scoped',billing_account_id:payload.billing_account_id,payload});});
 withJsonInput(account(keys.command('prepare-rotate').requiredOption('--operation-id <uuid>','UUIDv4 persistido; alcance inmutable, overlap explícito'))).action(async o=>{const payload=scopedRotatePayload(await readJsonInput(o));const operation_id=operation(o.operationId);await approvalRequest('POST','/users/me/account-approvals',operation_id,{operation_id,action:'api_keys.rotate_scoped',billing_account_id:scopedIdentity(o.billingAccount),payload});});
 account(keys.command('revoke <keyId>').requiredOption('--operation-id <uuid>','UUIDv4 persistido para revocar exactamente esta clave').option('-y, --yes','Confirmar revocación de una sola clave')).action(async(id,o)=>{const key_id=scopedIdentity(id),operation_id=operation(o.operationId),billing_account_id=scopedIdentity(o.billingAccount);await requireConfirmation(o.yes,`¿Revocar sólo la clave ${key_id}?`);try{const r=(await api('DELETE',`/users/me/scoped-api-keys/${key_id}`,{body:{operation_id},query:{billing_account_id},identityOnly:true})).data;if(!r||Object.keys(r).sort().join()!==['key_id','operation_id','revoked'].sort().join()||r.key_id!==key_id||r.operation_id!==operation_id||r.revoked!==true)throw new Error('Recibo inválido');printJson({success:true,data:{key_id,operation_id,revoked:true}});}catch{throw Object.assign(new Error(`Revocación no confirmada. Conserva operation_id ${operation_id} y consulta clave ${key_id}; no se reintentó automáticamente.`),{code:'scoped_key_revoke_not_confirmed'});}});
}

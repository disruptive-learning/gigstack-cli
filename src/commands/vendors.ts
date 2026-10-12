import { Command } from "commander";
import { api } from "../api.js";
import { printJson } from "../output.js";
import { withJsonInput, readJsonInput, segment, teamTarget } from "../input.js";
const uuid=(value:unknown)=>{if(typeof value!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Error("operation_id debe ser UUIDv4 guardado antes de enviar");return value};
// API responses are projected before stdout so injected legacy secrets never escape.
function safe(value:unknown):unknown {
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Respuesta de proveedor inválida");
 const data=value as Record<string,unknown>;
 const keys=["vendor_id","master_team_id","billing_account_id","owner_id","alias","legal_name","tax_id","is_vendor","livemode","operation_id","status","permanent_noncompletion","generation","expires_at","created_by","purpose","effect_scope","legacy_sessions_may_remain","capability_delivery"];
 const result:Record<string,unknown>=Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,data[k]]));
 if(data.browser_handoff!==undefined){const url=new URL(String(data.browser_handoff));if(url.username||url.password||url.hash||!/^\/account\/vendor-onboarding\/[A-Za-z0-9_-]+$/.test(url.pathname)||[...url.searchParams.keys()].some(k=>k!=="team")||!url.searchParams.get("team"))throw new Error("Enlace privado inválido");result.browser_handoff=url.toString()}
 if(data.operation!==undefined){const op=data.operation as Record<string,unknown>;result.operation={operation_id:uuid(op.operation_id),vendor_id:op.vendor_id,status:op.status,replayed:op.replayed}}
 return result;
}
export function registerVendorCommands(program:Command){
 const vendors=program.command("vendors").description("Crear proveedores reales y recuperar resultados mediante IDs seguros");
 withJsonInput(vendors.command("create <masterId>").description("Crear proveedor con dueño actual del maestro. Guarda operation_id UUIDv4; para recuperar usa el mismo ID y entrada. Administradores adicionales requieren aprobación revisada."))
 .action(async(masterId,opts)=>{const path=teamTarget(masterId),body=await readJsonInput(opts);uuid(body.operation_id);const allowed=["operation_id","alias","legal_name","tax_id","metadata","members","livemode"];if(Object.keys(body).some(k=>!allowed.includes(k))||typeof body.alias!=="string"||!body.alias.trim())throw new Error("Entrada de proveedor inválida");const res=await api("POST",`${path}/vendors`,{body,team:masterId});printJson({data:safe(res.data)})});
 vendors.command("operation <masterId> <operationId>").description("Consultar creación guardada; not_found no prueba no finalización permanente")
 .action(async(masterId,operationId)=>{const path=teamTarget(masterId);const res=await api("GET",`${path}/vendors/operations/${segment(uuid(operationId))}`,{team:masterId});printJson({data:safe(res.data)})});
 vendors.command("capability <masterId> <vendorId>").description("Leer estado y enlace privado de navegador para revelar, rotar o compartir. Sesiones antiguas sin versión pueden permanecer.")
 .action(async(masterId,vendorId)=>{const path=teamTarget(masterId);const res=await api("GET",`${path}/vendors/${segment(vendorId)}/onboarding-capability`,{team:masterId});printJson({data:safe(res.data)})});
}

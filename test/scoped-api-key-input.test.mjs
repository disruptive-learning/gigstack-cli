import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled=await build({entryPoints:['src/scoped-api-key-input.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {scopedCreatePayload,scopedRotatePayload}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const request={name:' Local sync ',livemode:false,billing_account_id:'ba_test',team_ids:['team_a','team_b'],action_ids:['listClients','createServices'],expires_at:1900000000000,manager_user_ids:['user_a']};
test('named creation retains exact single mode, multiple team/action scope and managers',()=>{assert.deepEqual(scopedCreatePayload(request),{...request,name:'Local sync',action_ids:[...request.action_ids].sort()});assert.deepEqual(scopedRotatePayload({key_id:'key_a',overlap_seconds:0}),{key_id:'key_a',overlap_seconds:0});});
test('cannot submit wildcard/duplicate/empty scope or caller approval and rotation scope widening',()=>{
 for(const change of [{action_ids:['*']},{team_ids:[]},{team_ids:['team_a','team_a']},{livemode:'false'},{expires_at:Infinity},{confirmed:true},{secret:'synthetic-secret'}]) assert.throws(()=>scopedCreatePayload({...request,...change}));
 for(const payload of [{key_id:'key_a'},{key_id:'key_a',overlap_seconds:-1},{key_id:'key_a',overlap_seconds:1,action_ids:['createServices']}]) assert.throws(()=>scopedRotatePayload(payload));
});
test('owner creation may omit expiry or send null; both are sent as explicit null',()=>{
 const {expires_at,...noExpiry}=request;
 for(const value of [noExpiry,{...request,expires_at:null}]) assert.equal(scopedCreatePayload(value).expires_at,null);
 for(const expires_at of [0,-1,'1900000000000',1.5]) assert.throws(()=>scopedCreatePayload({...request,expires_at}));
});
test('approval readback accepts a no-expiry scoped key change and receipt',async()=>{
 const out=await build({entryPoints:['src/scoped-api-keys.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const {scopedApprovalProjection}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
 const payload={...scopedCreatePayload(request),expires_at:null};
 const change={...payload,action:'create',previous_key_id:null,overlap_seconds:0,previous_revoke_at:null,unrelated_keys_affected:false,secret_disclosure:'once'};
 const base={action:'api_keys.create_scoped',team:null,billing_account_id:'ba_test',payload,requested_modes:[false],effect_scope:'scoped_api_key',disclosure_version:'scoped-api-key-v2',existing_key_ids:[],terms:null,scoped_key_change:change};
 assert.equal(scopedApprovalProjection({...base,status:'pending',receipt:null}).change.expires_at,null);
 const metadata={id:'key_new',name:'Local sync',scope_version:2,scope_kind:'scoped',billing_account_id:'ba_test',team:null,livemode:false,team_ids:payload.team_ids,action_ids:payload.action_ids,expires_at:null,manager_user_ids:payload.manager_user_ids,status:'active',created_at:1,revoked_at:null,revoke_at:null,replacement_key_id:null,last_used_at:null,can_manage:true,can_rotate:true,can_revoke:true};
 const receipt={revoked_count:0,keys:[{key_id:'key_new',type:'api',livemode:false}],scoped_api_key:{key_id:'key_new',previous_key_id:null,overlap_seconds:0,previous_revoke_at:null,metadata}};
 assert.equal(scopedApprovalProjection({...base,status:'completed',receipt}).receipt.metadata.expires_at,null);
});

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

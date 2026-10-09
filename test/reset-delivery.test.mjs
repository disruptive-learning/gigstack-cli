import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
const cli=new URL('../dist/cli.mjs',import.meta.url).pathname;
const operation='11111111-1111-4111-8111-111111111111', prior='22222222-2222-4222-8222-222222222222';
const token=`fixture.${Buffer.from(JSON.stringify({livemode:false})).toString('base64url')}.synthetic`;
const receipt=()=>({operation_id:operation,team_id:'team_test',user_id:'target',livemode:false,status:'prepared',attempt_in_progress:false,claim_expires_at:null,email_delivery:'not_attempted',password_change:'not_verified',started_at:1,updated_at:2});
const recovery=()=>({operation_id:operation,supersedes_operation_id:prior,team_id:'team_test',user_id:'target',livemode:false,status:'private_review_required',prior_reset_code_revocation:'not_performed',password_change:'not_verified',browser_handoff:{url:`https://app.gigstack.pro/account/users/target/reset-recoveries/${operation}?team=team_test&livemode=false`,effect:'private_review_required',contains_reset_credential:false}});
async function fixture(t){
 let response=receipt();const requests=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({method:req.method,url:req.url,body:body?JSON.parse(body):undefined});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{...response,reset_link:'PRIVATE_RESET',challenge:'PRIVATE_PROOF',recipient_email:'PRIVATE_EMAIL'}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 return {requests,setReply(value){response=value;},run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args,'--json'],{env:{...process.env,GIGSTACK_API_KEY:token,GIGSTACK_API_BASE_URL:`http://127.0.0.1:${server.address().port}/v2`,GIGSTACK_TEAM:'team_test'}});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});}};
}
test('all reset commands preserve exact UUID/team/user/mode/body and safe recovery',async t=>{
 const f=await fixture(t);
 for(const action of ['prepare','get','execute','cancel','prepare-recovery','get-recovery']){
  const isRecovery=action.endsWith('recovery'),isPrepare=action.startsWith('prepare');f.setReply(isRecovery?recovery():receipt());
  const body={operation_id:operation,expected_livemode:false,confirm_reset_email:true,...(isRecovery?{supersedes_operation_id:prior}:{})};
  const result=await f.run(['password-reset',action,'target',...(isPrepare?['--data',JSON.stringify(body)]:[operation]),...(action==='execute'?['--yes']:[])]);
  assert.equal(result.code,0,result.stdout+result.stderr);assert.doesNotMatch(result.stdout,/PRIVATE_RESET|PRIVATE_PROOF|PRIVATE_EMAIL/);
  assert.equal(JSON.parse(result.stdout).data.user_id,'target');
  const req=f.requests.at(-1),url=new URL(req.url,'http://fixture');
  assert.equal(req.method,action==='get'||action==='get-recovery'?'GET':action==='cancel'?'DELETE':'POST');
  assert.equal(url.pathname,`/v2/users/target/${isRecovery?'password-reset-recoveries':'password-reset-operations'}${isPrepare?'':`/${operation}`}${action==='execute'?'/execute':''}`);
  assert.equal(url.searchParams.get('team'),'team_test');assert.equal(url.searchParams.has('livemode'),false);
  if(isPrepare)assert.deepEqual(req.body,body);
 }
 assert.equal(f.requests.length,6);
});
test('unknown send retains safe receipt and nonzero exit; mismatches and private actions refuse',async t=>{
 const f=await fixture(t);f.setReply({...receipt(),status:'email_unknown',email_delivery:'unknown'});
 const unknown=await f.run(['password-reset','execute','target',operation,'--yes']);assert.equal(unknown.code,1);assert.equal(JSON.parse(unknown.stdout).data.status,'email_unknown');assert.doesNotMatch(unknown.stdout,/PRIVATE_/);assert.equal(f.requests.length,1);
 for(const patch of [{user_id:'other'},{team_id:'other'},{livemode:true},{password_change:'completed'},{status:'provider_accepted',email_delivery:'not_attempted'}]){
  f.setReply({...receipt(),...patch});const result=await f.run(['password-reset','get','target',operation]);assert.equal(result.code,1);assert.doesNotMatch(result.stdout,/PRIVATE_/);
 }
 const count=f.requests.length;
 for(const args of [
  ['prepare','target','--data',JSON.stringify({operation_id:operation,expected_livemode:false,confirm_reset_email:false})],
  ['prepare-recovery','target','--data',JSON.stringify({operation_id:operation,expected_livemode:false,confirm_reset_email:true,supersedes_operation_id:operation})],
  ['prepare','target','--data',JSON.stringify({operation_id:operation,expected_livemode:false,confirm_reset_email:true,challenge:'PRIVATE'})],
  ['get','target/path',operation],['review-recovery','target',operation],['execute-recovery','target',operation],['execute','target',operation],
 ]){const result=await f.run(['password-reset',...args]);assert.equal(result.code,1);}
 assert.equal(f.requests.length,count);
});

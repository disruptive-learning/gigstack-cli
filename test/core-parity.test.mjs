import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cli=new URL('../dist/cli.mjs',import.meta.url).pathname;
async function fixture(t,responder=()=>({success:true,data:{id:'synthetic',failed:0,remaining:0},timestamp:1})){
 const requests=[];const server=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;requests.push({method:req.method,url:req.url,headers:req.headers,body});const out=responder(requests.at(-1));res.writeHead(out.status??200,{'Content-Type':'application/json'});res.end(JSON.stringify(out.body??out));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}/v2`;
 const run=(args,input='')=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args,'--json','--team','team_test'],{env:{...process.env,GIGSTACK_API_KEY:'synthetic',GIGSTACK_API_BASE_URL:base,GIGSTACK_TEAM:''},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);});return {run,requests,base};
}
test('complete bodies preserve country fields, clearing, nested values and caller idempotency without CLI defaults',async t=>{
 const f=await fixture(t);const body={client:{id:'client_test'},currency:'COP',items:[{description:'Example',quantity:1,unit_price:10}],exchange_rate:0,metadata:{example:false},invoice_config:{serie:'A'},idempotency_key:'stable-key',send_email:false,ignore_emails:true,emails:[],automation_type:'none',ppd_invoice_id:null};
 for(const args of [['payments','request'],['payments','register'],['invoices','create'],['clients','create'],['clients','update','client_test']]){
 const result=await f.run([...args,'--stdin','--yes'],JSON.stringify(body));assert.equal(result.code,0,result.stdout);JSON.parse(result.stdout);assert.deepEqual(JSON.parse(f.requests.at(-1).body),body);
 }
 for(let i=0;i<2;i++){const r=await f.run(['payments','register','--client','client_test','--items','[]','--payment-form','03','--idempotency-key','same-payment']);assert.equal(r.code,0,r.stdout);assert.equal(JSON.parse(f.requests.at(-1).body).idempotency_key,'same-payment');}
});
test('named core commands use exact methods/routes and retain complete readbacks',async t=>{
 const envelope={success:true,data:[],has_more:true,next:'next-page',found:21,page:2,per_page:10};const f=await fixture(t,()=>envelope);
 const cases=[
 [['payments','update','p','--data','{}','--yes'],'PUT','/payments/p'],[['payments','paid','p','--data','{"payment_form":"03"}','--yes'],'POST','/payments/p/paid'],[['payments','cancel','p','--yes'],'DELETE','/payments/p'],[['payments','refund','p','--data','{"reason":"duplicate","amount":10,"external_processor_refund":true}','--yes'],'POST','/payments/p/refund'],
 [['receipts','get','r'],'GET','/receipts/r'],[['receipts','create','--data','{}','--yes'],'POST','/receipts'],[['receipts','reopen','r','--data','{"reason":"corrected"}','--yes'],'POST','/receipts/r/reopen'],
 [['invoices','drafts','get','d'],'GET','/invoices/draft/d'],[['invoices','drafts','create','--data','{}','--yes'],'POST','/invoices/draft'],[['invoices','drafts','update','d','--data','{"description":null}','--yes'],'PUT','/invoices/draft/d'],[['invoices','drafts','delete','d','--yes'],'DELETE','/invoices/draft/d'],[['invoices','drafts','preview','d','--yes'],'POST','/invoices/draft/d/preview'],
 [['invoices','credit-note-create','--data','{}','--yes'],'POST','/invoices/egress'],[['invoices','credit-note-get','e'],'GET','/invoices/egress/e'],[['invoices','complement-create','--data','{}','--yes'],'POST','/invoices/payment'],[['invoices','transfer-create','--data','{}','--yes'],'POST','/invoices/transfer'],[['invoices','transfer-get','t'],'GET','/invoices/transfer/t'],[['invoices','transfers','--next','cursor'],'GET','/invoices/transfer'],[['clients','stamp-pending-receipts','c','--yes'],'POST','/clients/c/stamp-pending-receipts']];
 for(const[args,method,path]of cases){const r=await f.run(args);assert.equal(r.code,0,r.stdout);assert.deepEqual(JSON.parse(r.stdout),envelope);const req=f.requests.at(-1),url=new URL(req.url,f.base);assert.equal(req.method,method);assert.equal(url.pathname,'/v2'+path);assert.equal(url.searchParams.get('team'),'team_test');}
 const result=await f.run(['payments','search','hello world','--page','2','--limit','10','--status','pending','--client','c']);assert.equal(result.code,0,result.stdout);assert.deepEqual(JSON.parse(result.stdout),envelope);const query=new URL(f.requests.at(-1).url,f.base).searchParams;assert.equal(query.get('q'),'hello world');assert.equal(query.get('page'),'2');assert.equal(query.get('client_id'),'c');
 assert.equal((await f.run(['receipts','search','text','--page','3','--fields','name'])).code,0);assert.equal(new URL(f.requests.at(-1).url,f.base).searchParams.get('page'),'3');
});
test('invalid/conflicting input and missing consent never send a mutation; HTTP errors remain nonzero',async t=>{
 const f=await fixture(t,()=>({status:400,body:{success:false,error:{code:'validation_failed',message:'Invalid request'}}}));
 for(const args of [['payments','request','--data','{}','--client','c','--yes'],['clients','update','../other','--data','{}','--yes'],['receipts','create','--data','[]','--yes'],['payments','update','p','--data','{}'],['payments','refund','p']]){const r=await f.run(args);assert.equal(r.code,1,r.stdout);assert.ok(JSON.parse(r.stdout).error);}
 assert.equal(f.requests.length,0);
 const r=await f.run(['payments','update','p','--data','{"invalid":true}','--yes']);assert.equal(r.code,1);assert.equal(JSON.parse(r.stdout).error.code,'validation_failed');assert.equal(f.requests.length,1);
});
test('CSF upload is local bounded PDF and partial stamping preserves evidence with nonzero exit',async t=>{
 const f=await fixture(t,req=>req.url.includes('stamp-pending')?{success:true,data:{stamped:1,failed:1,remaining:4,results:[{id:'r',status:'failed'}]}}:{success:true,data:{id:'client_test'}});
 const dir=await mkdtemp(join(tmpdir(),'gigstack-core-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'csf.pdf');await writeFile(file,'%PDF-1.7\nsynthetic');
 const r=await f.run(['clients','upload-csf','--file',file,'--client','client_test','--yes']);assert.equal(r.code,0,r.stdout);const req=f.requests.at(-1);assert.match(req.headers['content-type'],/^multipart\/form-data; boundary=/);assert.match(req.body,/name="file"; filename="csf.pdf"/);assert.equal(new URL(req.url,f.base).searchParams.get('client_id'),'client_test');
 const partial=await f.run(['clients','stamp-pending-receipts','client_test','--yes']);assert.equal(partial.code,1);assert.equal(JSON.parse(partial.stdout).data.remaining,4);
 const count=f.requests.length;await writeFile(file,'not a PDF');assert.equal((await f.run(['clients','upload-csf','--file',file,'--yes'])).code,1);assert.equal(f.requests.length,count);
});

test('invoice batch preserves stable header/body keys, paged outcomes and XML partial failures', async t => {
 const f=await fixture(t,req=>req.url.includes('/import')?{success:false,data:{summary:{imported:0,not_imported:1},results:[{filename:'one.xml',success:false,error:'synthetic invalid XML'}]}}:req.url.includes('/items')?{success:true,data:{data:[{status:'needs_review'}],next:'cursor',has_more:true}}:{success:true,data:{id:'batch_test',result:null,rejected:[],counts:{failed:0}}});
 const body={invoices:[{idempotency_key:'item-stable-key',client:{id:'c'},items:[]}]};
 for(let i=0;i<2;i++) { const r=await f.run(['invoices','batch','create','--stdin','--idempotency-key','batch-stable-key','--yes'],JSON.stringify(body));assert.equal(r.code,0,r.stdout);assert.equal(f.requests.at(-1).headers['idempotency-key'],'batch-stable-key');assert.deepEqual(JSON.parse(f.requests.at(-1).body),body); }
 assert.equal((await f.run(['invoices','batch','get','batch_test'])).code,0);
 const items=await f.run(['invoices','batch','items','batch_test','--next','opaque','--limit','2','--status','needs_review']);assert.equal(items.code,1);assert.equal(JSON.parse(items.stdout).data.next,'cursor');assert.equal(new URL(f.requests.at(-1).url,f.base).searchParams.get('next'),'opaque');
 const imported=await f.run(['invoices','import-xml','--data','{"files":[{"filename":"one.xml","xml":"<invalid/>"}]}','--yes']);assert.equal(imported.code,1);assert.equal(JSON.parse(imported.stdout).data.results[0].filename,'one.xml');
 const read=await f.run(['invoices','errors','--q','receiver tax','--page','2','--type','receiver']);assert.equal(read.code,0);assert.equal(new URL(f.requests.at(-1).url,f.base).searchParams.get('q'),'receiver tax');
 const count=f.requests.length;const invalid=await f.run(['invoices','batch','create','--data','{}','--idempotency-key','bad key','--yes']);assert.equal(invalid.code,1);assert.equal(f.requests.length,count);
});

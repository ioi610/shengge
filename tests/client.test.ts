import test from 'node:test';import assert from 'node:assert/strict';
import {Client} from '../src/client';import {Request,Response} from '../src/storage';
const owner=(generation:number)=>({ownerId:'owner-'+generation,generation,expiresAt:Date.now()+15000});
test('concurrent expired writes share renewal and preserve their original requests',async()=>{
 let finish!:(r:Response)=>void;const sent:Request[]=[];
 const c=new Client(async m=>{sent.push(m);if(m.type==='RENEW_SESSION')return new Promise(r=>finish=r);return {ok:true,dataEpoch:1,data:true};});
 c.owner={...owner(1),expiresAt:Date.now()-1};const a=c.envelope('SAVE_CHECKPOINT'),b=c.envelope('COMMIT_COMPLETION');
 const pending=Promise.all([c.send(a),c.send(b)]);assert.equal(sent.length,1);
 finish({ok:true,dataEpoch:1,data:owner(1)});await pending;
 assert.deepEqual(sent.slice(1),[a,b]);assert.equal(sent.filter(m=>m.type==='RENEW_SESSION').length,1);
});
test('failed renewal cannot send a queued expired write',async()=>{
 const sent:Request[]=[];const c=new Client(async m=>{sent.push(m);return {ok:false,error:'STALE_BINDING'};});
 c.owner={...owner(1),expiresAt:Date.now()-1};await assert.rejects(c.call('COMMIT_COMPLETION'),{code:'STALE_BINDING'});
 assert.deepEqual(sent.map(m=>m.type),['RENEW_SESSION']);
});
test('late renewal response cannot restore an owner after release',async()=>{
 let finish!:(r:Response)=>void;const requests:Request[]=[];const c=new Client(async m=>{requests.push(m);if(m.type==='RENEW_SESSION')return new Promise(r=>finish=r);return {ok:true,dataEpoch:1,data:true};});c.owner=owner(1);const pending=c.renew();await c.release();finish({ok:true,dataEpoch:1,data:owner(1)});await pending;assert.equal(c.owner,undefined);assert.equal(requests[1].payload.ownerId,'owner-1');
});
test('release acknowledgement cannot erase a newer acquisition',async()=>{
 let release!:(r:Response)=>void;const c=new Client(async m=>m.type==='RELEASE_SESSION'?new Promise(r=>release=r):{ok:true,dataEpoch:1,data:owner(2)});c.owner=owner(1);const pending=c.release();assert.equal(c.owner,undefined);await c.acquire();release({ok:true,dataEpoch:1,data:true});await pending;assert.equal((c.owner as any).generation,2);
});
test('dispose waits for pending release and closes the repository exactly once',async()=>{
 let release!:(r:Response)=>void;let closed=0,requests=0;const c=new Client(async()=>{requests++;return new Promise(r=>release=r);},async()=>{closed++;});c.owner=owner(1);const pending=c.release();await Promise.resolve();const a=c.dispose(),b=c.dispose();assert.equal(closed,0);release({ok:true,dataEpoch:1,data:true});await Promise.all([pending,a,b]);assert.equal(closed,1);assert.equal(requests,1);
});
test('dispose during acquisition releases the eventual grant before closing storage',async()=>{
 let grant!:(r:Response)=>void;const order:string[]=[];const c=new Client(async m=>{order.push(m.type);if(m.type==='ACQUIRE_SESSION')return new Promise(r=>grant=r);return {ok:true,dataEpoch:1,data:true};},async()=>{order.push('close');});const acquiring=c.acquire();const disposed=c.dispose();grant({ok:true,dataEpoch:1,data:owner(1)});await Promise.all([acquiring,disposed]);assert.deepEqual(order,['ACQUIRE_SESSION','RELEASE_SESSION','close']);assert.equal(c.owner,undefined);await assert.rejects(c.acquire(),{code:'OPERATION_CANCELLED'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaEnd} from '../src/media-end';
function fixture(){
 const host=new EventTarget(),video={ownerDocument:{defaultView:host}} as HTMLVideoElement;
 let valid=true,owned=true,received=0,site=0;
 const guard=new MediaEnd(video,()=>valid,()=>owned);
 guard.addEventListener('ended',()=>received++);
 host.addEventListener('ended',()=>site++);
 const end=(target:unknown=video)=>{const event=new Event('ended');Object.defineProperty(event,'target',{value:target});host.dispatchEvent(event);};
 return {guard,end,invalid:()=>{valid=false;},unowned:()=>{owned=false;},counts:()=>({received,site})};
}
test('owned EOF notifies practice exactly once and blocks native auto-next',()=>{const f=fixture();f.end();assert.deepEqual(f.counts(),{received:1,site:0});f.guard.dispose();});
test('EOF from another media element passes through untouched',()=>{const f=fixture();f.end({});assert.deepEqual(f.counts(),{received:0,site:1});f.guard.dispose();});
test('source replacement and an obsolete owner do not intercept EOF',()=>{const f=fixture();f.invalid();f.end();assert.deepEqual(f.counts(),{received:0,site:1});f.guard.dispose();});
test('without practice playback native EOF remains available',()=>{const f=fixture();f.unowned();f.end();assert.deepEqual(f.counts(),{received:1,site:1});f.guard.dispose();});
test('closing practice restores native auto-next and removes its listener',()=>{const f=fixture();f.guard.dispose();f.guard.dispose();f.end();assert.deepEqual(f.counts(),{received:0,site:1});});

import test from 'node:test';
import assert from 'node:assert/strict';
import {UnconfirmedVisualTurns} from '../src/unconfirmed-visual-turns';
import {VisualTurns} from '../src/visual-turns';
const line=(startMs:number)=>({startMs,endMs:startMs+300,text:'わかった',confidence:.99});

test('only closed stable lines with contemporaneous voice are exported for later confirmation',()=>{
 const turns=new VisualTurns(0),read={text:'わかった',confidence:.99,min:.99};
 turns.observe(1000,read,true);turns.observe(1200,read,true);turns.observe(1800,undefined,true);
 for(const at of [2000,2032,2064])turns.hear(at,.8);
 turns.observe(2000,read,true);turns.observe(2200,read,true);turns.observe(2800,undefined,true);
 for(const at of [3000,3032,3064])turns.hear(at,.8);
 turns.observe(3000,read,true); // A one-frame line is not yet stable or closed.
 assert.deepEqual(turns.spokenLines().map(turn=>turn.startMs),[1850]);
});

test('retention is bounded, preserves the earliest lines, and never restores a submitted interval',()=>{
 const queue=new UnconfirmedVisualTurns(1100);
 queue.remember([line(500),line(1000),...Array.from({length:20},(_,i)=>line(2000+i*500))],13000);
 const first=queue.earliestBefore(20000,13000)!;assert.equal(first.startMs,1100);assert.equal(first.endMs,1300);
 assert.equal((queue as any).lines.length,12);assert.equal((queue as any).lines.at(-1).startMs,7000);
 assert.equal(queue.earliestBefore(1000,13000),undefined);
 assert.equal(queue.earliestBefore(Infinity,60000),undefined,'old metadata expires by media time even if no new lines arrive');
});

test('a seek invalidates both retained lines and the unfinished old window that could otherwise reinsert them',()=>{
 const queue=new UnconfirmedVisualTurns(0),epoch=queue.epoch;
 queue.remember([line(1000)],3000,epoch);queue.clear();
 queue.remember([line(1000),line(2000)],4000,epoch);
 assert.equal(queue.earliestBefore(Infinity,4000),undefined);
 queue.remember([line(4000)],5000,queue.epoch);
 assert.equal(queue.earliestBefore(Infinity,5000)?.startMs,4000);
});

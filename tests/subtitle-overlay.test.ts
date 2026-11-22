import test from 'node:test';import assert from 'node:assert/strict';
import {captionPoint} from '../src/subtitle-overlay';
test('dragged captions stay inside all four video edges',()=>{
 for(const x of [-2,0,.5,1,3])for(const y of [-2,0,.5,1,3]){const p=captionPoint({x,y},640,360,240,60);assert(p.x>=128&&p.x<=512);assert(p.y>=38&&p.y<=322);}
});
test('normalized placement survives fullscreen and narrow video sizes',()=>{
 assert.deepEqual(captionPoint({x:.5,y:.8},1920,1080,400,60),{x:960,y:864});
 assert.deepEqual(captionPoint({x:1,y:1},120,50,200,80),{x:60,y:25});
});

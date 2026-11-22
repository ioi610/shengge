import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';import {AnalysisCache} from '../src/analysis-cache';
const key='1:0:24000:'+'a'.repeat(64),checkpoint={version:1,durationMs:24000,originMs:0,windows:[],reviewed:[]};
test('analysis checkpoints survive reopening and stay scoped to the original video',async()=>{
 const name=crypto.randomUUID();let cache=new AnalysisCache(name);await cache.request('analysis-save',{key,checkpoint},'bilibili:one');await cache.close();cache=new AnalysisCache(name);
 assert.deepEqual(await cache.request('analysis-load',{key},'bilibili:one'),checkpoint);assert.equal(await cache.request('analysis-load',{key},'bilibili:two'),null);assert.equal(await cache.request('analysis-load',{key},'youtube:one'),null,'Bilibili checkpoints must never populate YouTube analysis');await cache.close();
});
test('malformed checkpoint and arbitrary cache keys are rejected',async()=>{
 const cache=new AnalysisCache(crypto.randomUUID());await assert.rejects(cache.request('analysis-save',{key,checkpoint:{}},'bilibili:one'));await assert.rejects(cache.request('analysis-load',{key:'other'},'bilibili:one'));await cache.close();
});

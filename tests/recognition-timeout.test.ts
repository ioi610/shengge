import test from 'node:test';import assert from 'node:assert/strict';
import {recognitionDeadlineMs} from '../src/recognition-timeout';
test('cold or slow short audio gets GPU grace, all jobs retain a finite deadline',()=>{
 assert.equal(recognitionDeadlineMs(2000),45000);assert.equal(recognitionDeadlineMs(30000),60000);assert.equal(recognitionDeadlineMs(60000),90000);
});

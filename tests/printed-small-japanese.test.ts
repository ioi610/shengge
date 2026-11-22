import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import {subtitleLines} from '../src/visual-caption-reader';

test('the real 00:19.5 frame retains the smaller Japanese row across its word space',async()=>{
 const bytes=inflateSync(await readFile(new URL('./fixtures/printed-small-japanese-19.5.rgba.deflate',import.meta.url)));
 const frame={width:1280,height:173,data:new Uint8ClampedArray(bytes)} as ImageData;
 const [japanese,chinese]=subtitleLines(frame);
 // Original screenshot: Japanese 当てよ すき焼きセット below the Chinese.
 // Its 19-pixel ink row has a 26-pixel inter-word gap. Previously both
 // resulting fragments failed centering, leaving only the Chinese row.
 assert.deepEqual(japanese,{left:521,top:115,width:237,height:27});
 assert.deepEqual(chinese,{left:499,top:76,width:284,height:38});
 assert.ok(chinese.top+chinese.height<japanese.top);
});

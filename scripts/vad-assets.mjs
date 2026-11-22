import {mkdir,cp} from 'node:fs/promises';
export async function copyVadAssets(root){
 const target=root+'/vad';await mkdir(target,{recursive:true});
 for(const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])await cp('node_modules/onnxruntime-web/dist/'+name,target+'/'+name);
 await cp('assets/speaker-turns/model.onnx',target+'/speaker-turns.onnx');
 await cp('assets/speaker-turns/LICENSE',target+'/SPEAKER-MODEL-LICENSE.txt');
 await cp('assets/speaker-turns/README.md',target+'/SPEAKER-MODEL-README.txt');
 await cp('node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',target+'/vad.worklet.bundle.min.js');
 await cp('node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',target+'/silero_vad_v5.onnx');
 await cp('node_modules/@ricky0123/vad-web/dist/bundle.min.js.LICENSE.txt',target+'/VAD-LICENSE.txt');
 await cp('node_modules/onnxruntime-web/README.md',target+'/ONNX-RUNTIME-README.txt');
}

import {resolveSource} from '../src/domain';
import {parseSubtitles} from '../desktop/subtitles';
import {demoCues} from '../tests/fixtures/demo';
Object.assign(globalThis,{mobileSource:(url:string)=>JSON.stringify(resolveSource(url)),mobileLines:(text:string)=>JSON.stringify(parseSubtitles(text)),mobileDemo:JSON.stringify(demoCues)});

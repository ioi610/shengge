#include "whisper.h"
#include "json.hpp"
#include <emscripten/bind.h>
#include <atomic>
#include <string>
#include <vector>
#include <stdexcept>
using json=nlohmann::ordered_json;
static whisper_context *ctx=nullptr;
static std::atomic<int> cancelled{0};
static int trailing(const std::string &s){
 if(s.empty())return 0;
 int i=(int)s.size()-1,count=0;while(i>=0&&((unsigned char)s[i]&0xC0)==0x80){count++;i--;}
 if(i<0)return 0;unsigned char c=s[i];int expected=c>=0xF0?3:c>=0xE0?2:c>=0xC0?1:0;return std::max(0,expected-count);
}
static bool init(const std::string &path){
 if(ctx)return true;auto p=whisper_context_default_params();p.use_gpu=true;p.flash_attn=false;p.dtw_token_timestamps=true;p.dtw_aheads_preset=WHISPER_AHEADS_SMALL;
 ctx=whisper_init_from_file_with_params(path.c_str(),p);return ctx!=nullptr;
}
static std::string transcribe(const emscripten::val &audio,const std::string &language,int threads){
 if(!ctx)throw std::runtime_error("Model not initialized");
 auto pcm=emscripten::convertJSArrayToNumberVector<float>(audio);
 auto p=whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
 // Match the pinned v1.9.5 server defaults and current request fields exactly.
 p.n_threads=threads;p.print_realtime=false;p.print_progress=false;p.print_timestamps=false;p.print_special=false;
 p.language=language.c_str();p.translate=false;p.detect_language=false;p.thold_pt=.01f;p.max_len=60;p.split_on_word=false;p.audio_ctx=0;
 p.greedy.best_of=2;p.beam_search.beam_size=-1;p.temperature=0;p.temperature_inc=.2f;p.entropy_thold=2.4f;p.logprob_thold=-1;p.no_speech_thold=.6f;
 p.no_timestamps=false;p.token_timestamps=true;p.no_context=true;p.suppress_nst=false;p.vad=false;
 p.abort_callback=[](void*){return cancelled.load()!=0;};
 if(whisper_full(ctx,p,pcm.data(),pcm.size())!=0)throw std::runtime_error(cancelled.load()?"Cancelled":"Recognition failed");
 json out={{"language",whisper_lang_str_full(whisper_full_lang_id(ctx))},{"segments",json::array()}};
 for(int i=0;i<whisper_full_n_segments(ctx);i++){
  json s={{"start",whisper_full_get_segment_t0(ctx,i)*.01},{"end",whisper_full_get_segment_t1(ctx,i)*.01},{"text",whisper_full_get_segment_text(ctx,i)},{"no_speech_prob",whisper_full_get_segment_no_speech_prob(ctx,i)},{"words",json::array()}};
  for(int j=0;j<whisper_full_n_tokens(ctx,i);j++){
   auto t=whisper_full_get_token_data(ctx,i,j);if(t.id>=whisper_token_eot(ctx))continue;
   std::string word=whisper_full_get_token_text(ctx,i,j);auto end=t.t1;
   while(j+1<whisper_full_n_tokens(ctx,i)&&trailing(word)>0){auto next=whisper_full_get_token_data(ctx,i,j+1);if(next.id>=whisper_token_eot(ctx))break;j++;word+=whisper_full_get_token_text(ctx,i,j);if(next.t1>-1)end=next.t1;}
   s["words"].push_back({{"word",word},{"start",t.t0*.01},{"end",end*.01},{"t_dtw",t.t_dtw},{"probability",t.p}});
  }
  out["segments"].push_back(s);
 }
 return out.dump(-1,' ',false,json::error_handler_t::replace);
}
EMSCRIPTEN_BINDINGS(shengge){emscripten::function("init",&init,emscripten::async());emscripten::function("transcribe",&transcribe,emscripten::async());emscripten::function("cancelPointer",+[](){return (uintptr_t)&cancelled;});}

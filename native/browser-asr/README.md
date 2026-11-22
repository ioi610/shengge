# 扩展内 Whisper 构建

发行包已含运行时，使用者不需要以下工具。这些工具只在维护 C++ 桥接时使用。

- whisper.cpp v1.9.5，提交 `d1be6fde11ac6e0407606b4e42fe72d34add8037`
- Emscripten 7.0.0，SDK release `6afbd83493d647051772d491124187d4e9a0cda9`
- CMake 4.1.3
- 模型、下载地址与 SHA-256：`src/recognition-model.ts`

在项目外的临时目录安装上述工具，设置 `WHISPER_SOURCE` 指向固定提交的源码。执行：

```sh
source "$EMSDK/emsdk_env.sh"
python3 native/browser-asr/prepare-source.py "$WHISPER_SOURCE"
emcmake cmake -S native/browser-asr -B "$BUILD_DIR" \
  -DWHISPER_SOURCE="$WHISPER_SOURCE" -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD_DIR" -j4
cp "$BUILD_DIR/shengge-asr.mjs" "$BUILD_DIR/shengge-asr.wasm" assets/recognition/
```

与原生服务器使用同一套 small q5_1 权重、采样参数、SMALL DTW 对齐头。`bridge.cpp` 输出原服务器的分段/词/置信度格式，继续经过共用 `transcript-segments.ts` 与原分句/人声句首逻辑。浮点运算后端从 Metal 改为 WebGPU，结果不应声称在全部设备和素材上逐位相同。

短音频的重复循环保护由 `prepare-source.py` 应用到固定源码，重复执行不会重复打补丁；未知源码会拒绝修改。对不超过 8 秒的输入，若某个尚未完成的候选连续 64 个文本 token 精确重复长度 1–4 的模式，就提前判定该候选失败，继续原有温度回退。特殊符号和时间 token 会打断重复判定，最后一轮回退保持原逻辑。它没有设置句子长度上限，也不改变播放器、字幕置信度门槛或无对白画面的播放顺序。较长输入及普通对白不触发此分支。

保护函数的独立验证：`clang++ -std=c++17 native/browser-asr/repetition-guard.test.cpp -o /tmp/shengge-repeat-test && /tmp/shengge-repeat-test`。发行前仍需同音轨对照完整文本、词时间和自然完成耗时，不能把超时或空结果当成准确率通过。

运行时通过 JSPI 等待 WebGPU，采用 WASM SIMD 与 pthread；所需代码全随扩展打包，无远程脚本或 eval。Chrome 137 起支持 JSPI：https://developer.chrome.com/release-notes/137 。扩展 offscreen 页面启用 COOP/COEP，以在 worker 中共享取消标记和运行线程。页面本身不使用麦克风。

先运行 `node scripts/browser-recognition-qa.mjs` 和 `node scripts/serve-recognition-qa.mjs`，浏览器访问显示的本地测试页。默认从固定官方地址下载模型；可通过 `SHENGGE_QA_MODEL_FILE` 指向已经下载且校验一致的模型，供离线开发测试。验收用真实音频，比较原文、逐词边界和耗时；最后必须在 YouTube 验证完整流程。

Emscripten 4.0.10 自带的 Dawn API 太旧，无法编译此版本的 WebGPU 后端。CPU-only WASM 推理过慢，不作为静默降级方案。验收完成后可删除整个工具临时目录；它不应进入发行包或用户安装目录。

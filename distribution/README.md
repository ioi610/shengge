# 声格

粘贴哔哩哔哩或 YouTube 视频链接，在同一播放器里听原声、逐句复读、留白跟读，再看提示片段接下一句。学习记录保存在当前设备。

[下载安装包和中文视频教程](https://github.com/ioi610/shengge/releases/latest)

| 系统 | 下载文件 | 安装与打开 |
| --- | --- | --- |
| macOS 13+，Apple 芯片 | Shengge-macOS-arm64.zip | 解压，将「声格.app」拖入「应用程序」并打开。当前包使用本地签名。 |
| Windows x64 | Shengge-Windows-x64-Setup.exe | 双击按当前用户安装，从开始菜单打开「声格」。便携版 Shengge-Windows-x64.zip 可完整解压后双击 Shengge.exe。 |
| Debian / Ubuntu，x86-64 | shengge_0.3.5_amd64.deb | 在下载目录执行 `sudo apt install ./shengge_0.3.5_amd64.deb`，从应用菜单打开「声格」。 |
| iPhone / iPad，iOS 16+ | Shengge-iOS-Xcode.zip | 在 Mac 解压，用 Xcode 打开 Shengge.xcodeproj。在 Signing & Capabilities 选择自己的 Team，选择已连接的设备并运行。真机签名使用自己的 Bundle Identifier。 |
| Chrome 桌面扩展，137+ | Shengge-Chrome.zip | 解压后打开「安装说明.html」。在 chrome://extensions 打开开发者模式，选择「加载已解压的扩展程序」，选中 extension。 |

[观看中文操作视频](https://github.com/ioi610/shengge/releases/download/v0.3.5-r2/Shengge-Guide-zh-CN.mp4)

iOS 发布文件还包括供开发者签名的 iPhone 设备归档。真机安装可通过上表的 Xcode 工程完成。TestFlight 和 App Store 分发需要使用 Apple 开发者账号签名。

## 第一次练习

1. 在桌面首页或 iPhone 首页粘贴视频链接，也可以打开自带的咖啡馆示例。
2. 选「复读」听同一句原声，选「跟读」在留白时开口。桌面可在播放器下方调节遍数，iPhone 在右上角设置中调节。
3. 选「接话」，看提示片段，停下时说出下一句，再听原声并自评。已经回答的对白会显示在列表里。
4. 回首页或学习记录，按视频继续。各设备独立保存，首次桌面版安装已内置识别模型。

桌面播放器与 Chrome 扩展使用 WebGPU 做本机识别，清晰度和覆盖率受原片音轨影响。iOS 使用 WebKit 播放视频，优先读取网站提供的字幕，也支持 SRT/VTT、手动标记和可用语言的设备端语音识别。点击自动识别后，iOS 会请求语音识别和应用内采集授权。受保护的音轨可能无法读取。首次可用内置示例体验跟读和接话。

## 从源码构建

安装 Node.js 22+ 后运行 `npm ci`。下列命令从仓库根目录执行。

- 扩展：`npm run build && node scripts/package.mjs && python3 distribution/package-extension.py`
- Apple 芯片 Mac：`node desktop/build.mjs`
- Windows / Linux：安装 Go、Python 3.9+ 和 curl。先以环境变量 `SHENGGE_OUTPUT=dist/desktop-training` 运行 `node scripts/build.mjs`，再运行 `python3 desktop/portable/package.py win64` 或 `python3 desktop/portable/package.py linux64`。Windows 安装向导可用 Inno Setup 6 编译 desktop/portable/windows.iss。
- iOS：`node ios/build.mjs`，用 Xcode 打开 ios/Shengge.xcodeproj，选择 iPhone 模拟器或带签名的真机目标。
- 运行检查：`npm run check && npm test`。标签触发原生平台构建，结果见仓库 Actions。

[Chrome 扩展加载说明](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) · [Apple 设备开发与运行](https://developer.apple.com/documentation/xcode/running-your-app-in-simulator-or-on-a-device)

# 声格

粘贴哔哩哔哩或 YouTube 视频链接，在同一播放器里听原声、逐句复读、留白跟读，再看提示片段接下一句。学习记录保存在当前设备。

## 下载安装

[46 秒中文使用教程（MP4）](https://github.com/ioi610/shengge/releases/latest/download/Shengge-Guide-zh-CN.mp4) · [全部发布文件](https://github.com/ioi610/shengge/releases/latest)

| 平台 | 下载 | 安装方式 |
| --- | --- | --- |
| macOS 13+ · Apple 芯片 | [下载本机编译安装包（ZIP）](https://github.com/ioi610/shengge/releases/latest/download/Shengge-macOS-arm64-source.zip) | 需要 Apple 命令行工具。解压后按下方步骤安装。 |
| Windows x64 | [下载安装程序（EXE）](https://github.com/ioi610/shengge/releases/latest/download/Shengge-Windows-x64-Setup.exe) · [下载便携版（ZIP）](https://github.com/ioi610/shengge/releases/latest/download/Shengge-Windows-x64.zip) | 双击安装程序，从开始菜单打开。使用便携版时，完整解压后运行 `Shengge.exe`。 |
| Linux · Debian / Ubuntu x86-64 | [下载 DEB 安装包](https://github.com/ioi610/shengge/releases/latest/download/shengge_0.3.6_amd64.deb) | 在下载目录运行 `sudo apt install ./shengge_0.3.6_amd64.deb`。 |
| iPhone / iPad · iOS 16+ | [下载 Xcode 工程](https://github.com/ioi610/shengge/releases/latest/download/Shengge-iOS-Xcode.zip) · [下载模拟器版](https://github.com/ioi610/shengge/releases/latest/download/Shengge-iOS-Simulator.zip) | 真机安装需要签名。在 Mac 上用 Xcode 打开工程，选择自己的 Team、Bundle Identifier 和已连接的设备，然后运行。 |
| Chrome 桌面扩展 · 137+ | [下载 Chrome 扩展（ZIP）](https://github.com/ioi610/shengge/releases/latest/download/Shengge-Chrome.zip) | 解压，在 `chrome://extensions` 开启「开发者模式」，点「加载已解压的扩展程序」，选中 `extension` 文件夹。 |

iOS 开发者也可[下载待签名的 iPhone 设备归档](https://github.com/ioi610/shengge/releases/latest/download/Shengge-iPhone-unsigned.xcarchive.zip)。

## 在 Apple 芯片 Mac 上安装

1. 将 Mac 安装包解压到「下载」，确认里面有 `Shengge-Mac/install.py`。退出旧版声格。
2. 在「终端」运行 `xcode-select -p`。如果提示找不到开发工具，运行 `xcode-select --install` 并等待系统完成安装。已安装 Xcode 或命令行工具的用户可以直接继续。
3. 复制下面两行到终端运行。第一行在本机编译并校验声格，第二行打开个人「应用程序」文件夹里的新版本。

```sh
/usr/bin/python3 "$HOME/Downloads/Shengge-Mac/install.py" &&
open "$HOME/Applications/声格.app"
```

此方式适用于 macOS 13 及以上的 Apple 芯片 Mac，包内含 Brave Software 原厂签名并经 Apple 公证的播放器运行时，以及离线语音模型。新版会继续使用当前用户的学习记录。当前公开版采用本机编译安装，尚未提供 Apple 公证的拖放安装包。

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

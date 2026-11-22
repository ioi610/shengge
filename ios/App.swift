import SwiftUI
import WebKit
import UniformTypeIdentifiers

@main struct ShenggeApp: App {
    @StateObject private var player=Player()
    @Environment(\.scenePhase) var scene
    var body: some Scene { WindowGroup { MainView(p:player).preferredColorScheme(.dark)
        .onChange(of:scene){phase in if phase != .active {player.save()};if phase == .background {player.stopSpeech()} }
    }}
}
struct VideoSurface:UIViewRepresentable {
    let web:WKWebView
    func makeUIView(context:Context)->WKWebView {web}
    func updateUIView(_ uiView:WKWebView,context:Context){}
}
struct MainView:View {
    @ObservedObject var p:Player
    @State private var link=""
    @State private var file=false
    @State private var settings=false
    var body: some View {
        VStack(spacing:12){
            HStack {
                if p.record != nil {Button{p.close() }label:{Image(systemName:"chevron.left")}.accessibilityLabel("返回视频列表")}
                Text(p.record?.title ?? "声格").font(.headline).lineLimit(1)
                Spacer()
                if p.record != nil {Button{settings=true}label:{Image(systemName:"slider.horizontal.3")}.accessibilityLabel("练习设置")}
            }.padding(.horizontal)
            if let video=p.record {
                VideoSurface(web:p.web).aspectRatio(16/9,contentMode:.fit).background(.black)
                    .overlay(alignment:.bottom){if p.showCaptions && !p.caption.isEmpty {Text(p.caption).fontWeight(.semibold).shadow(color:.black,radius:2).padding(8).allowsHitTesting(false)}}
                HStack{
                    Button{p.action{try await p.toggle()}}label:{Image(systemName:p.phase == .waiting ? "ear" : p.paused ? "play.fill":"pause.fill")}
                        .accessibilityLabel(p.phase == .waiting ? "听原声":"播放或暂停")
                    ForEach([Mode.listen,.shadow,.cue],id:\.self){m in Button(m.rawValue){p.action{try await p.setMode(m)}}.buttonStyle(.bordered).tint(m==p.mode ? .orange:.gray)}
                    if p.mode != .watch {Button{p.action{try await p.setMode(.watch)}}label:{Image(systemName:"xmark")}.accessibilityLabel("退出练习")}
                }.disabled(!p.ready)
                if p.phase == .waiting {Button("接下一句 · 听原声核对"){p.action{try await p.toggle()}}}
                if p.phase == .gap {Text("轮到你跟读").foregroundStyle(.secondary)}
                if p.phase == .rating {HStack{ForEach(["能接出","卡住了"],id:\.self){r in Button(r){p.action{try await p.rate(r)}}}}}
                if video.lines.isEmpty && p.ready {
                    HStack{Button(p.recognizing ? "结束识别":"自动识别"){p.action{try await p.autoCaption()}};Button("导入字幕"){file=true}}
                }
                List(Array(video.lines.enumerated()),id:\.element.id){i,line in
                    let rating=video.ratings[String(line.startMs)]
                    let concealed=p.mode == .cue && i>=video.current && rating==nil && !(i==video.current && (p.phase == .answering || p.phase == .rating))
                    Button{p.action{try await p.select(i)}}label:{
                        HStack{Text(clock(line.startMs)).monospacedDigit().foregroundStyle(.secondary)
                            Text(concealed ? "•••":line.text ?? "已标记对白");Spacer()
                            if let rating=rating {Text(rating).font(.caption)}
                            else if i==video.current && p.mode != .watch {Image(systemName:"waveform").foregroundStyle(.orange)}
                        }
                    }.accessibilityIdentifier("line-\(i)")
                }.listStyle(.plain)
            }else{
                HStack{Image(systemName:"link");TextField("粘贴视频链接",text:$link).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).onSubmit{p.open(link)}
                    Button{p.open(link)}label:{Image(systemName:"arrow.right.circle.fill").font(.title)}.accessibilityLabel("打开视频")
                }.padding().background(.thinMaterial,in:RoundedRectangle(cornerRadius:14)).padding(.horizontal)
                List{
                    if !p.history.isEmpty {Section("继续学习"){ForEach(p.history){v in Button{p.open(v.url)}label:{VStack(alignment:.leading){Text(v.title);Text(clock(v.position)).font(.caption).foregroundStyle(.secondary)}}}}}
                    if !p.history.contains(where:{$0.id=="demo:cafe"}) {Button("播放咖啡馆示例"){p.open("demo:cafe")}}
                }
            }
            if !p.note.isEmpty {Text(p.note).font(.footnote).foregroundStyle(.secondary).padding(.horizontal)}
        }.tint(.orange).sheet(isPresented:$settings){
            NavigationStack{Form{
                Toggle("显示字幕",isOn:$p.showCaptions)
                Stepper("每句 \(p.record?.target ?? 3) 遍",value:Binding(get:{p.record?.target ?? 3},set:{p.record?.target=$0;p.save()}),in:1...100)
                Picker("识别语言",selection:$p.language){Text("日语").tag("ja-JP");Text("英语").tag("en-US");Text("中文").tag("zh-CN")}
                Button(p.recognizing ? "结束识别":"识别播放中的对白"){settings=false;p.action{try await p.autoCaption()}}.disabled(!p.ready || p.mode != .watch)
                Button("导入 SRT / VTT"){settings=false;DispatchQueue.main.asyncAfter(deadline:.now()+0.4){file=true}}.disabled(p.mode != .watch)
                Button(p.marking==nil ? "标记句首":"标记句尾"){settings=false;p.action{try await p.mark()}}.disabled(!p.ready || p.mode != .watch)
                Button("切换原站控件"){settings=false;p.action{try await p.site()}}
            }.navigationTitle("练习设置").toolbar{Button("完成"){settings=false}}}
        }.fileImporter(isPresented:$file,allowedContentTypes:[.plainText,UTType(filenameExtension:"srt") ?? .data,UTType(filenameExtension:"vtt") ?? .data]){result in
            do{try p.importFile(result.get())}catch{p.note=error.localizedDescription}
        }
    }
    private func clock(_ ms:Double)->String {let n=Int(max(0,ms)/1000);return String(format:"%02d:%02d",n/60,n%60)}
}

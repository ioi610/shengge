import SwiftUI
import WebKit
import JavaScriptCore
import UniformTypeIdentifiers

struct Line: Codable, Identifiable {
    var startMs: Double
    var endMs: Double
    var text: String?
    var id: Double { startMs }
}
struct VideoRecord: Codable, Identifiable {
    var videoKey: String
    var url: String
    var title: String
    var lines: [Line] = []
    var position = 0.0
    var current = 0
    var target = 3
    var counts: [String:Int] = [:]
    var ratings: [String:String] = [:]
    var id: String { videoKey }
}
private struct Source: Decodable { let url: String; let videoKey: String }
enum Mode: String { case watch = "播放", listen = "复读", shadow = "跟读", cue = "接话" }
enum Phase { case idle, playing, gap, waiting, answering, rating }
private func resource(_ name: String, _ ext: String) -> URL { Bundle.main.url(forResource:name, withExtension:ext,subdirectory:"PlayerAssets")! }
@MainActor final class Player: NSObject, ObservableObject, WKNavigationDelegate {
    @Published var history: [VideoRecord] = []
    @Published var record: VideoRecord?
    @Published var mode = Mode.watch
    @Published var phase = Phase.idle
    @Published var ready = false
    @Published var paused = true
    @Published var time = 0.0
    @Published var caption = ""
    @Published var note = ""
    @Published var showCaptions = true
    @Published var marking: Double?
    @Published var recognizing = false
    @Published var language = "ja-JP"
    let web: WKWebView
    private let js = JSContext()!
    private let world = WKContentWorld.defaultClient
    private var generation = UUID(), run = "", nextAt: Date?, timer: Timer?
    private var polling = false, restore = false, lastSave = 0.0, duration = 0.0
    private let speech = Captions()
    private let store = "shengge.videos.v1"
    override init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let source = try! String(contentsOf: resource("media","js"),encoding:.utf8)
        config.userContentController.addUserScript(WKUserScript(source:source,injectionTime:.atDocumentEnd,forMainFrameOnly:true,in: .defaultClient))
        web = WKWebView(frame:.zero,configuration:config)
        super.init()
        web.navigationDelegate = self
        js.evaluateScript(try! String(contentsOf:resource("shared","js"),encoding:.utf8))
        if let data=UserDefaults.standard.data(forKey:store),let saved=try? JSONDecoder().decode([VideoRecord].self,from:data) { history=saved }
        timer=Timer.scheduledTimer(withTimeInterval:0.22,repeats:true){ [weak self] _ in Task { @MainActor in await self?.poll() } }
    }
    private func decode<T:Decodable>(_ type:T.Type,_ value:String?) throws -> T {
        try JSONDecoder().decode(type,from:Data((value ?? "").utf8))
    }
    func open(_ input:String) {
        do {
            if input=="demo:cafe" {
                var item=history.first{$0.videoKey==input} ?? VideoRecord(videoKey:input,url:input,title:"駅前のカフェ")
                if item.lines.isEmpty { item.lines=try decode([Line].self,js.objectForKeyedSubscript("mobileDemo")?.toString()) }
                enter(item)
            } else {
                js.exception=nil
                let result=js.objectForKeyedSubscript("mobileSource")?.call(withArguments:[input])
                guard js.exception==nil else { throw Failure("请粘贴 YouTube 或哔哩哔哩的完整视频链接") }
                let src=try decode(Source.self,result?.toString())
                enter(history.first{$0.videoKey==src.videoKey} ?? VideoRecord(videoKey:src.videoKey,url:src.url,title:src.url))
            }
        } catch {note=error.localizedDescription}
    }
    private func enter(_ item:VideoRecord) {
        stopSpeech();save();generation=UUID();web.stopLoading();record=item;ready=false;restore=true
        mode = .watch;phase = .idle;run="";nextAt=nil;marking=nil;note="";caption="";paused=true;time=item.position;lastSave=time
        if item.videoKey=="demo:cafe" { let u=resource("demo","html");web.loadFileURL(u,allowingReadAccessTo:u.deletingLastPathComponent()) }
        else if let u=URL(string:item.url) {web.load(URLRequest(url:u))}
        save()
    }
    func close(){stopSpeech();save();generation=UUID();record=nil;web.stopLoading();web.loadHTMLString("",baseURL:nil);ready=false;phase = .idle;mode = .watch}
    func save(){
        guard let item=record else{return}
        history.removeAll{$0.id==item.id};history.insert(item,at:0)
        if let data=try? JSONEncoder().encode(history){UserDefaults.standard.set(data,forKey:store)}
    }
    private func command(_ op:String,_ extra:[String:Any]=[:]) async throws -> [String:Any] {
        guard let key=record?.videoKey else{throw CancellationError()}
        let g=generation
        var args=extra;args["key"]=key;args["op"]=op
        let raw=try await web.callAsyncJavaScript("return await globalThis.shenggeMedia(command)",arguments:["command":args],in:nil,contentWorld:world)
        guard generation==g else{throw CancellationError()};return raw as? [String:Any] ?? [:]
    }
    func action(_ body:@escaping () async throws -> Void){let g=generation;Task {do{try await body()}catch{if g==generation{note=error.localizedDescription}}}}
    private func poll() async {
        guard record != nil,!polling else{return};polling=true;defer{polling=false}
        do{
            let state=try await command("status",["tracks":record?.lines.isEmpty==true])
            ready=state["ready"] as? Bool ?? false;guard ready else{return}
            time=state["position"] as? Double ?? 0;duration=state["duration"] as? Double ?? 0;paused=state["paused"] as? Bool ?? true
            if restore {restore=false;if let pos=record?.position,pos>0,pos<duration { _=try await command("seek",["from":pos]);return }}
            if record?.title==record?.url,let title=state["title"] as? String,!title.isEmpty {record?.title=title;save()}
            if record?.lines.isEmpty==true,let cues=state["cues"] as? [[String:Any]],!cues.isEmpty {
                let data=try JSONSerialization.data(withJSONObject:cues);record?.lines=try JSONDecoder().decode([Line].self,from:data);save()
            }
            if mode == .watch {
                caption=record?.lines.first{$0.startMs<=time && time<$0.endMs}?.text ?? ""
                record?.position=time;if abs(time-lastSave)>4000 {lastSave=time;save()}
                if recognizing,paused {stopSpeech()}
            }
            if let result=state["result"] as? [String:String],result["run"]==run,!run.isEmpty {
                if result["state"]=="finished" {run="";try await finished()}
                else if result["state"]=="interrupted" {run="";phase = .idle;note="播放中断，请点播放继续"}
            }
            if phase == .gap,let deadline=nextAt,Date()>=deadline {nextAt=nil;try await playLine()}
        }catch{if !web.isLoading && ready {note=error.localizedDescription}}
    }
    func setMode(_ value:Mode) async throws {
        stopSpeech();_ = try await command("stop");run="";nextAt=nil;phase = .idle;mode=value;caption="";note=""
        guard value != .watch else{return}
        guard let item=record,!item.lines.isEmpty else{mode = .watch;throw Failure("请先识别字幕、导入 SRT/VTT，或标记一句对白")}
        if value == .cue {
            guard item.lines.count>1 else{mode = .watch;throw Failure("接话需要两句对白")}
            let i=(1..<item.lines.count).first{item.ratings[String(item.lines[$0].startMs)]==nil} ?? 1
            record?.current=i
        }
        try await playLine()
    }
    private func playLine(answer:Bool=false) async throws {
        guard let item=record,item.lines.indices.contains(item.current) else{return}
        let i=mode == .cue && !answer ? max(0,item.current-1):item.current
        let line=item.lines[i];let to=mode == .cue && !answer ? min(line.endMs,item.lines[item.current].startMs-80):line.endMs
        guard to>line.startMs else{throw Failure("这两句对白重叠，请另选一组")}
        let id=UUID().uuidString;run=id;caption=mode == .cue && !answer ? "":line.text ?? ""
        phase=answer ? .answering:.playing
        do {let state=try await command("range",["run":id,"from":line.startMs,"to":to]);guard state["ready"] as? Bool==true else{throw Failure("请先在原站播放正片")}}
        catch{if run==id {run="";phase = .idle};throw error}
        record?.position=item.lines[item.current].startMs;save()
    }
    private func finished() async throws {
        guard let item=record,item.lines.indices.contains(item.current) else{return}
        if mode == .cue {phase=phase == .answering ? .rating:.waiting;return}
        guard mode != .watch else{return}
        let line=item.lines[item.current],key=String(line.startMs)
        let count=(item.counts[key] ?? 0)+1;record?.counts[key]=count;save()
        if count>=item.target {
            if item.current+1>=item.lines.count {phase = .idle;note="本轮练习完成";return}
            record?.current=item.current+1;save()
        }
        phase = .gap;nextAt=Date().addingTimeInterval(mode == .shadow ? max(0.8,(line.endMs-line.startMs)/1000):0.35)
    }
    func toggle() async throws {
        if mode == .watch {_=try await command("toggle");return}
        if phase == .playing || phase == .answering || phase == .gap {_=try await command("stop");run="";nextAt=nil;phase = .idle;return}
        try await playLine(answer:phase == .waiting || phase == .rating)
    }
    func rate(_ value:String) async throws {
        guard phase == .rating,let item=record else{return}
        record?.ratings[String(item.lines[item.current].startMs)]=value;save()
        if item.current+1<item.lines.count {record?.current=item.current+1;try await playLine()}
        else {phase = .idle;note="接话完成";mode = .watch;caption=""}
    }
    func select(_ i:Int) async throws {
        guard let item=record,item.lines.indices.contains(i) else{return}
        run="";nextAt=nil;phase = .idle;record?.current=i;save()
        if mode == .watch {_=try await command("seek",["from":item.lines[i].startMs])}
        else {if mode == .cue && i==0 {record?.current=1};try await playLine()}
    }
    func importFile(_ url:URL) throws {
        let access=url.startAccessingSecurityScopedResource();defer{if access{url.stopAccessingSecurityScopedResource()}}
        guard try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0 < 2_000_000 else{throw Failure("字幕文件超过 2 MB")}
        let text=try String(contentsOf:url,encoding:.utf8);js.exception=nil
        let result=js.objectForKeyedSubscript("mobileLines")?.call(withArguments:[text])
        guard js.exception==nil else{throw Failure("请选用有效的 SRT 或 VTT 文件")}
        let rows=try decode([Line].self,result?.toString());guard !rows.isEmpty else{throw Failure("没有读到字幕")}
        stopSpeech();record?.lines=rows;record?.current=0;record?.ratings=[:];record?.counts=[:];save()
    }
    func mark() async throws {
        guard let start=marking else{marking=time;if paused {_=try await command("toggle")};return}
        guard time>start+350 else{throw Failure("在句尾再点一次")}
        if record?.lines.contains(where:{$0.startMs<time && $0.endMs>start})==true {marking=nil;throw Failure("这段已有对白")}
        record?.lines.append(Line(startMs:start,endMs:time));record?.lines.sort{$0.startMs<$1.startMs};marking=nil;save()
    }
    func autoCaption() async throws {
        if recognizing {stopSpeech();return}
        if paused {_=try await command("toggle")}
        let g=generation
        recognizing=true
        do {try await speech.start(locale:language,position:{[weak self] in self?.time ?? 0},onLine:{[weak self] line in
            guard let self,self.generation==g,self.recognizing,let item=self.record,line.endMs>line.startMs else{return}
            if !item.lines.contains(where:{$0.startMs<line.endMs && $0.endMs>line.startMs}) {
                self.record?.lines.append(line);self.record?.lines.sort{$0.startMs<$1.startMs};self.caption=line.text ?? "";self.save()
            }
        },onError:{[weak self] message in guard let self,self.generation==g else{return};self.stopSpeech();self.note=message})}
        catch{stopSpeech();throw error}
    }
    func stopSpeech(){speech.stop();recognizing=false}
    func site() async throws { _=try await command("site") }
}
struct Failure: LocalizedError {let value:String;init(_ v:String){value=v};var errorDescription:String?{value}}

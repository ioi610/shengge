import ReplayKit
import Speech

// Capture only this app's playback audio. No microphone input is requested.
@MainActor final class Captions {
    private var request:SFSpeechAudioBufferRecognitionRequest?
    private var task:SFSpeechRecognitionTask?
    private var session=UUID()
    private var rotate:Timer?
    private var pending:Line?
    private var deliver:((Line)->Void)?
    private let recorder=RPScreenRecorder.shared()
    func start(locale:String,position:@escaping ()->Double,onLine:@escaping(Line)->Void,onError:@escaping(String)->Void) async throws {
        stop();let id=session
        let permission=await withCheckedContinuation{ continuation in
            SFSpeechRecognizer.requestAuthorization{ continuation.resume(returning:$0) }
        }
        guard session==id else{throw CancellationError()}
        guard permission == .authorized,let recognizer=SFSpeechRecognizer(locale:Locale(identifier:locale)),
              recognizer.supportsOnDeviceRecognition,recognizer.isAvailable else{throw Failure("此设备或语言暂不可用本机识别，可导入 SRT/VTT")}
        guard recorder.isAvailable else{throw Failure("当前设备无法采集播放音轨，可导入字幕")}
        recorder.isMicrophoneEnabled=false
        deliver=onLine
        func listen(){
            if let line=pending {onLine(line);pending=nil}
            task?.cancel();request?.endAudio()
            let audio=SFSpeechAudioBufferRecognitionRequest();audio.requiresOnDeviceRecognition=true;audio.shouldReportPartialResults=true
            request=audio;let origin=position();var emitted=0
            task=recognizer.recognitionTask(with:audio){[weak self] result,error in
                Task { @MainActor in
                    guard let self,self.session==id,self.request===audio else{return}
                    if let result=result {
                        let parts=result.bestTranscription.segments;var first=emitted
                        for i in emitted..<max(emitted,parts.count) {
                            let part=parts[i],next=i+1
                            let end=part.timestamp+part.duration
                            let boundary=next<parts.count && (parts[next].timestamp-end>0.32 || end-parts[first].timestamp>=4)
                            let snippet=(result.bestTranscription.formattedString as NSString)
                            let begin=parts[first].substringRange.location,last=NSMaxRange(part.substringRange)
                            guard begin<=last,last<=snippet.length else{continue}
                            let text=snippet.substring(with:NSRange(location:begin,length:last-begin))
                            let line=Line(startMs:origin+parts[first].timestamp*1000,endMs:origin+end*1000,text:text)
                            self.pending=line
                            if boundary || result.isFinal && next==parts.count {onLine(line);emitted=next;first=next;self.pending=nil}
                        }
                    }
                    if let error=error {onError(error.localizedDescription)}
                }
            }
        }
        listen()
        do {
            try await withCheckedThrowingContinuation{ (continuation:CheckedContinuation<Void,Error>) in
                recorder.startCapture(handler:{[weak self] sample,type,error in
                    if let error=error {Task{@MainActor in if self?.session==id{onError(error.localizedDescription)}};return}
                    guard type == .audioApp,CMSampleBufferDataIsReady(sample) else{return}
                    Task{@MainActor in if self?.session==id{self?.request?.appendAudioSampleBuffer(sample)}}
                },completionHandler:{error in
                    if let error=error {continuation.resume(throwing:error)}else{continuation.resume()}
                })
            }
        }catch{stop();throw error}
        guard id==session else{if recorder.isRecording{recorder.stopCapture{_ in}};throw CancellationError()}
        rotate=Timer.scheduledTimer(withTimeInterval:48,repeats:true){_ in Task{@MainActor in if id==self.session{listen()}}}
    }
    func stop(){
        if let line=pending {deliver?(line)};pending=nil;deliver=nil
        session=UUID();rotate?.invalidate();rotate=nil;task?.cancel();task=nil;request?.endAudio();request=nil
        if recorder.isRecording{recorder.stopCapture{_ in}}
    }
}

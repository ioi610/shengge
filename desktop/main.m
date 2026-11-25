#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSURL *resource(NSString *name) {
    return [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:name];
}

// Chromium locates GPU libraries relative to its outermost .app bundle.
// Launch its signed distribution as a standalone bundle, keeping the same
// dedicated browser profile and packaged extension across upgrades.
static NSURL *runtimeBundle(NSURL *support, NSError **error) {
    NSFileManager *files=NSFileManager.defaultManager;
    NSURL *source=[NSBundle.mainBundle.bundleURL URLByAppendingPathComponent:@"Contents/Helpers/Brave Browser.app"];
    NSString *version=[[NSBundle bundleWithURL:source] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
    if(!version.length){
        if(error)*error=[NSError errorWithDomain:NSCocoaErrorDomain code:NSFileReadCorruptFileError userInfo:@{NSURLErrorKey:source}];
        return nil;
    }
    // Chromium GPU initialization also fails when its bundle lives below
    // a non-ASCII directory on this distribution. Keep user data separate.
    NSURL *root=[support.URLByDeletingLastPathComponent URLByAppendingPathComponent:@"Shengge/Runtime"];
    NSString *build=[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"];
    NSURL *directory=[root URLByAppendingPathComponent:[NSString stringWithFormat:@"%@-sg%@",version,build]];
    NSURL *target=[directory URLByAppendingPathComponent:source.lastPathComponent];
    if([files fileExistsAtPath:target.path])return target;
    if(![files createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:error])return nil;
    NSURL *staging=[directory URLByAppendingPathComponent:NSUUID.UUID.UUIDString];
    if(![files copyItemAtURL:source toURL:staging error:error]){
        [files removeItemAtURL:staging error:NULL];return nil;
    }
    if(![files moveItemAtURL:staging toURL:target error:error]){
        [files removeItemAtURL:staging error:NULL];
        if(![files fileExistsAtPath:target.path])return nil;
    }
    return target;
}

// The bundled engine owns the application's only visible window. A non-visible
// WebKit view reads the original file origin's recent list on upgrade.
@interface Desktop : NSObject <NSApplicationDelegate,WKNavigationDelegate>
@property(nonatomic,strong) WKWebView *legacy;
@property(nonatomic,strong) NSTask *engine;
@property(nonatomic,strong) NSURL *migration;
@property(nonatomic) BOOL launched;
@end

@implementation Desktop
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    self.legacy=[[WKWebView alloc] initWithFrame:NSZeroRect];
    self.legacy.navigationDelegate=self;
    NSURL *page=resource(@"ui/index.html");
    [self.legacy loadFileURL:page allowingReadAccessToURL:page.URLByDeletingLastPathComponent];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,2*NSEC_PER_SEC),dispatch_get_main_queue(),^{[self start:nil];});
}
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)nav {
    [view evaluateJavaScript:@"localStorage.getItem('recent')" completionHandler:^(id value,NSError *error){
        [self start:[value isKindOfClass:NSString.class]?value:nil];
    }];
}
- (void)start:(NSString *)legacy {
    if(self.launched)return;
    self.launched=YES;self.legacy=nil;
    NSFileManager *fm=NSFileManager.defaultManager;
    NSURL *support=[[fm URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"声格"];
    NSURL *profile=[support URLByAppendingPathComponent:@"练习"];
    NSError *error=nil;
    if(![fm createDirectoryAtURL:profile withIntermediateDirectories:YES attributes:nil error:&error]){[NSApp presentError:error];[NSApp terminate:nil];return;}
    NSURLComponents *url=[NSURLComponents componentsWithURL:resource(@"ui/training-launch.html") resolvingAgainstBaseURL:YES];NSString *requestedURL=[NSProcessInfo.processInfo.arguments containsObject:@"-videoURL"]?[NSUserDefaults.standardUserDefaults stringForKey:@"videoURL"]:nil;
    url.fragment=requestedURL.length?requestedURL:@"home";
    NSURL *target=url.URL;
    if(!requestedURL.length && legacy.length>2){
        NSURL *folder=[support URLByAppendingPathComponent:@"迁移"];
        if([fm createDirectoryAtURL:folder withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL]){
            self.migration=[folder URLByAppendingPathComponent:@"desktop-start.html"];
            NSString *payload=[[legacy dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0];
            NSString *html=[NSString stringWithFormat:@"<!doctype html><meta charset=utf-8><title>声格</title><style>body{background:#0f1012;color:#ddd;font:16px system-ui;padding:5vw}</style>正在打开声格…<script>const raw='%@',chunks=raw.match(/.{1,48000}/g),id=crypto.randomUUID();let i=0,seq=0;function send(){location.replace('#sg:'+id+':'+i+':'+chunks.length+':'+chunks[i]+':'+(++seq));i=(i+1)%%chunks.length;}send();setInterval(send,220);</script>",payload];
            if([html writeToURL:self.migration atomically:YES encoding:NSUTF8StringEncoding error:NULL])target=self.migration;
        }
    }
    self.engine=[NSTask new];
    NSURL *runtime=runtimeBundle(support,&error);
    if(!runtime){[NSApp presentError:error];[NSApp terminate:nil];return;}
    self.engine.executableURL=[runtime URLByAppendingPathComponent:@"Contents/MacOS/Brave Browser"];
    self.engine.arguments=@[[@"--user-data-dir=" stringByAppendingString:profile.path], [@"--load-extension=" stringByAppendingString:resource(@"training").path],@"--no-first-run",@"--no-default-browser-check",@"--window-size=1160,760", [@"--app=" stringByAppendingString:target.absoluteString]];
    self.engine.terminationHandler=^(NSTask *task){dispatch_async(dispatch_get_main_queue(),^{[NSApp terminate:nil];});};
    if(![self.engine launchAndReturnError:&error]){[NSApp presentError:error];[NSApp terminate:nil];}
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)app hasVisibleWindows:(BOOL)visible {
    if(self.engine.running)[[NSRunningApplication runningApplicationWithProcessIdentifier:self.engine.processIdentifier] activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    return YES;
}
- (void)applicationWillTerminate:(NSNotification *)note {
    if(self.engine.running)[self.engine terminate];
}
@end
int main(void) {
    @autoreleasepool {
        NSApplication *app=NSApplication.sharedApplication;
        Desktop *desktop=[Desktop new];app.delegate=desktop;
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];[app run];
        (void)desktop.engine;
    }
    return 0;
}

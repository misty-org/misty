// macOS integration regression: exercises real trusted WKWebView events.
// clang -fobjc-arc -framework AppKit -framework WebKit -framework Carbon \
//   src-tauri/native/macos/MistyBrowserInput.m src-tauri/tests/browser_native_input.m \
//   -o /tmp/misty-browser-input-test && /tmp/misty-browser-input-test
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
extern char *misty_browser_native_action(void *,const char *);
extern void misty_browser_native_set_locked(void *,bool);
static WKWebView *view;
static id evaluate(NSString *script) {
 __block BOOL done=NO; __block id result=nil; __block NSError *failure=nil;
 [view evaluateJavaScript:script completionHandler:^(id value,NSError *error){result=value;failure=error;done=YES;}];
 NSDate *limit=[NSDate dateWithTimeIntervalSinceNow:4];
 while(!done && limit.timeIntervalSinceNow>0) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.01]];
 if (!done || failure) { fprintf(stderr,"evaluate failed: %s\n",failure.description.UTF8String); exit(2); }
 return result;
}
static void action(NSDictionary *action) {
 NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"viewport":@{@"width":@800,@"height":@600},@"editable":evaluate(@"document.activeElement.matches('input,textarea') || document.activeElement.isContentEditable"),@"action":action} options:0 error:nil];
 char *raw=misty_browser_native_action((__bridge void *)view,[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
 NSDictionary *result=[NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:raw] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];free(raw);
 if (result[@"error"]) {fprintf(stderr,"action failed: %s\n",[result[@"error"] UTF8String]);exit(3);}
 [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.1]];
}
int main(){ @autoreleasepool {
 [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
 NSWindow *window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,800,600) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
 view=[[WKWebView alloc]initWithFrame:NSMakeRect(0,0,800,600)];window.contentView=view;[window orderBack:nil];
 [view loadHTMLString:@"<html><body style='margin:0'><input id='text' style='position:absolute;left:20px;top:20px;width:200px;height:40px'><canvas style='position:absolute;top:100px;left:0' width='800' height='450'></canvas><script>window.events=[];for(const name of ['mousedown','mousemove','mouseup','keydown','keyup','input'])document.addEventListener(name,e=>events.push({type:e.type,x:e.clientX,y:e.clientY,key:e.key,code:e.code,trusted:e.isTrusted}));</script></body></html>" baseURL:nil];
 [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1]];
 misty_browser_native_set_locked((__bridge void *)view,true);
 action(@{@"kind":@"click",@"x":@0.1,@"y":@0.065});
 action(@{@"kind":@"type",@"text":@"house"});
 action(@{@"kind":@"key",@"key":@"r"});
 action(@{@"kind":@"key",@"key":@"a",@"modifiers":@[@"Meta"]});
 action(@{@"kind":@"type",@"text":@"roof"});
 action(@{@"kind":@"drag",@"fromX":@0.2,@"fromY":@0.3,@"toX":@0.7,@"toY":@0.8});
 NSDictionary *result=evaluate(@"({value:document.querySelector('input').value,events:window.events})");
 NSData *json=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];puts([[NSString alloc]initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
 BOOL typed=[result[@"value"] isEqual:@"roof"]; BOOL dragged=NO,keyed=NO;
 for (NSDictionary *event in result[@"events"]) {if ([event[@"type"] isEqual:@"mouseup"] && [event[@"x"] intValue]==560 && [event[@"y"] intValue]==480) dragged=YES;if([event[@"code"] isEqual:@"KeyR"])keyed=YES;}
 if(!typed||!dragged||!keyed)return 4;
 [window orderOut:nil];puts("PASS scoped WKWebView click/type/key/drag");
}return 0;}

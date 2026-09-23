#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Carbon/Carbon.h>

bool misty_autopilot_supported(void) { if (@available(macOS 14.4,*)) return true; return false; }

static char *AutopilotJSON(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
char *misty_autopilot_focus_reason(void) {
  NSString *name=NSWorkspace.sharedWorkspace.frontmostApplication.localizedName ?: @"another window";
  return AutopilotJSON(@{@"error":[NSString stringWithFormat:@"Misty lost focus to %@. Bring Misty to the front, then resume.",name]});
}
@interface MistyAutopilotCursor : NSView
@end
@implementation MistyAutopilotCursor
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)rect {
  NSBezierPath *path = [NSBezierPath bezierPath];
  [path moveToPoint:NSMakePoint(2,2)]; [path lineToPoint:NSMakePoint(2,24)];
  [path lineToPoint:NSMakePoint(8,18)]; [path lineToPoint:NSMakePoint(13,28)];
  [path lineToPoint:NSMakePoint(18,25)]; [path lineToPoint:NSMakePoint(13,16)];
  [path lineToPoint:NSMakePoint(23,16)]; [path closePath];
  [[NSColor colorWithRed:0.35 green:0.65 blue:1 alpha:1] setFill]; [path fill];
  [NSColor.blackColor setStroke]; path.lineWidth=1.5; [path stroke];
}
@end
static MistyAutopilotCursor *cursor;
void misty_autopilot_hide_cursor(void) {
  dispatch_async(dispatch_get_main_queue(), ^{ [cursor removeFromSuperview]; cursor=nil; });
}
// Called on the main queue, after the Rust task/grant checks. No global input is posted.
char *misty_autopilot_action(const char *json) {
  @autoreleasepool {
    NSDictionary *input=[NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSWindow *window=NSApp.keyWindow;
    NSArray *frame=input[@"frame"];
    if (!NSApp.active || !window || !window.visible || window.miniaturized || window.windowNumber != [input[@"windowNumber"] integerValue] || frame.count!=4)
      return AutopilotJSON(@{@"error":@"Misty must be the active window. Resume when you are ready."});
    NSRect expected=NSMakeRect([frame[0] doubleValue],[frame[1] doubleValue],[frame[2] doubleValue],[frame[3] doubleValue]);
    if (!NSEqualRects(expected,window.frame)) return AutopilotJSON(@{@"error":@"browser_snapshot_stale: the window moved or resized; inspect again"});
    NSDictionary *action=input[@"action"];
    NSString *kind=action[@"kind"];
    NSTimeInterval time=NSProcessInfo.processInfo.systemUptime;
    if ([kind isEqual:@"point"] || [kind isEqual:@"scroll"]) {
      double x=[action[@"x"] doubleValue],y=[action[@"y"] doubleValue];
      if (!isfinite(x)||!isfinite(y)||x<0||x>1||y<0||y>1) return AutopilotJSON(@{@"error":@"Invalid screenshot coordinates"});
      NSPoint point=NSMakePoint(x*window.frame.size.width,(1-y)*window.frame.size.height);
      NSRect content=[window.contentView convertRect:window.contentView.bounds toView:nil];
      if (!NSPointInRect(point,content)) return AutopilotJSON(@{@"error":@"Only the Misty workspace can be controlled"});
      if (!cursor) { cursor=[[MistyAutopilotCursor alloc] initWithFrame:NSMakeRect(0,0,30,32)]; cursor.wantsLayer=YES; }
      [window.contentView addSubview:cursor positioned:NSWindowAbove relativeTo:nil];
      NSPoint local=[window.contentView convertPoint:point fromView:nil];
      cursor.frame=NSMakeRect(local.x,local.y-30,30,32);
      if ([kind isEqual:@"point"]) {
        for (NSNumber *type in @[@(NSEventTypeLeftMouseDown),@(NSEventTypeLeftMouseUp)]) {
          NSEvent *event=[NSEvent mouseEventWithType:type.unsignedIntegerValue location:point modifierFlags:0 timestamp:time windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
          [NSApp sendEvent:event];
        }
      } else {
        int dy=[action[@"deltaY"] intValue],dx=[action[@"deltaX"] intValue];
        CGEventRef cg=CGEventCreateScrollWheelEvent(NULL,kCGScrollEventUnitPixel,2,-dy,-dx);
        NSPoint screen=[window convertPointToScreen:point];
        CGFloat top=NSScreen.screens.firstObject.frame.size.height;
        CGEventSetLocation(cg,CGPointMake(screen.x,top-screen.y));
        NSEvent *event=[NSEvent eventWithCGEvent:cg];
        NSView *hit=[window.contentView hitTest:local];
        [hit scrollWheel:event]; CFRelease(cg);
      }
    } else if ([kind isEqual:@"type"]) {
      NSString *text=action[@"text"];
      id responder=window.firstResponder;
      if (![text isKindOfClass:NSString.class] || text.length>16000 || ![responder respondsToSelector:@selector(insertText:replacementRange:)])
        return AutopilotJSON(@{@"error":@"Click an editable field before typing"});
      [(id<NSTextInputClient>)responder insertText:text replacementRange:NSMakeRange(NSNotFound,0)];
    } else if ([kind isEqual:@"key"]) {
      NSString *key=action[@"key"];
      NSDictionary *keys=@{@"Enter":@[@(kVK_Return),@"\r"],@"Escape":@[@(kVK_Escape),@"\033"],@"Tab":@[@(kVK_Tab),@"\t"],@"Backspace":@[@(kVK_Delete),@"\177"],@"ArrowLeft":@[@(kVK_LeftArrow),@"\uF702"],@"ArrowRight":@[@(kVK_RightArrow),@"\uF703"],@"ArrowUp":@[@(kVK_UpArrow),@"\uF700"],@"ArrowDown":@[@(kVK_DownArrow),@"\uF701"],@"SelectAll":@[@(kVK_ANSI_A),@"a"],@"Undo":@[@(kVK_ANSI_Z),@"z"]};
      NSArray *spec=keys[key]; if (!spec) return AutopilotJSON(@{@"error":@"Unsupported workspace key"});
      NSEventModifierFlags flags=([key isEqual:@"SelectAll"]||[key isEqual:@"Undo"])?NSEventModifierFlagCommand:0;
      for (NSNumber *type in @[@(NSEventTypeKeyDown),@(NSEventTypeKeyUp)]) {
        NSEvent *event=[NSEvent keyEventWithType:type.unsignedIntegerValue location:NSZeroPoint modifierFlags:flags timestamp:time windowNumber:window.windowNumber context:nil characters:spec[1] charactersIgnoringModifiers:spec[1] isARepeat:NO keyCode:[spec[0] unsignedShortValue]];
        [NSApp sendEvent:event];
      }
    } else return AutopilotJSON(@{@"error":@"Unsupported workspace action"});
    return AutopilotJSON(@{@"attempted":@YES,@"verified":@NO});
  }
}
// Worker entry point. Capture the active Misty window including every child webview.
char *misty_autopilot_capture(void) {
  @autoreleasepool {
    if (@available(macOS 14.4,*)) {
      dispatch_semaphore_t done=dispatch_semaphore_create(0);
      __block NSDictionary *result;
      dispatch_async(dispatch_get_main_queue(), ^{
        NSWindow *window=NSApp.keyWindow;
        if (!NSApp.active || !window || !window.visible || window.miniaturized) { result=@{@"error":@"Bring Misty to the front before starting control."}; dispatch_semaphore_signal(done); return; }
        NSInteger number=window.windowNumber; NSRect frame=window.frame;
        [SCShareableContent getCurrentProcessShareableContentWithCompletionHandler:^(SCShareableContent *content,NSError *error) {
          SCWindow *target=nil;
          for (SCWindow *candidate in content.windows) if (candidate.windowID==number) { target=candidate; break; }
          if (!target) { result=@{@"error":error.localizedDescription ?: @"Misty window is unavailable"}; dispatch_semaphore_signal(done); return; }
          SCContentFilter *filter=[[SCContentFilter alloc] initWithDesktopIndependentWindow:target];
          SCStreamConfiguration *config=[SCStreamConfiguration new];
          double scale=MIN(2.0,2000.0/MAX(target.frame.size.width,target.frame.size.height));
          config.width=MAX(1,target.frame.size.width*scale); config.height=MAX(1,target.frame.size.height*scale);
          config.showsCursor=NO; config.ignoreShadowsSingleWindow=YES;
          [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image,NSError *err) {
            if (!image) result=@{@"error":err.localizedDescription ?: @"Window capture failed"};
            else {
              NSBitmapImageRep *rep=[[NSBitmapImageRep alloc] initWithCGImage:image];
              NSData *jpeg=[rep representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor:@0.85}];
              result=@{@"image":@{@"dataUrl":[@"data:image/jpeg;base64," stringByAppendingString:[jpeg base64EncodedStringWithOptions:0]],@"width":@(CGImageGetWidth(image)),@"height":@(CGImageGetHeight(image))},@"windowNumber":@(number),@"frame":@[@(frame.origin.x),@(frame.origin.y),@(frame.size.width),@(frame.size.height)]};
            }
            dispatch_semaphore_signal(done);
          }];
        }];
      });
      if (dispatch_semaphore_wait(done,dispatch_time(DISPATCH_TIME_NOW,8*NSEC_PER_SEC))) return AutopilotJSON(@{@"error":@"Window capture timed out"});
      return AutopilotJSON(result);
    }
    return AutopilotJSON(@{@"error":@"Misty window control requires macOS 14.4 or later"});
  }
}

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <Carbon/Carbon.h>

static char *BrowserInputJSON(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
static NSHashTable<NSView *> *lockedBrowserViews;
static id browserInputMonitor;

// Physical events pass through the local app monitor; our explicit scoped
// view dispatch does not. Thus trusted WebKit events can work without briefly
// opening the agent-owned view to unrelated human input.
void misty_browser_native_set_locked(void *pointer, bool locked) {
  NSView *view = (__bridge NSView *)pointer;
  if (!lockedBrowserViews) lockedBrowserViews = [NSHashTable weakObjectsHashTable];
  if (locked) [lockedBrowserViews addObject:view]; else [lockedBrowserViews removeObject:view];
  if (!browserInputMonitor) {
    NSEventMask mask = NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskRightMouseDown | NSEventMaskRightMouseUp | NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDragged | NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskScrollWheel;
    browserInputMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event) {
      NSWindow *window = event.window;
      if (!window) return event;
      BOOL keyboard = event.type == NSEventTypeKeyDown || event.type == NSEventTypeKeyUp;
      for (NSView *browser in lockedBrowserViews) {
        if (browser.window != window || browser.hiddenOrHasHiddenAncestor) continue;
        NSView *target = keyboard ? ([window.firstResponder isKindOfClass:NSView.class] ? (NSView *)window.firstResponder : nil)
            : [window.contentView hitTest:[window.contentView convertPoint:event.locationInWindow fromView:nil]];
        if (target && (target == browser || [target isDescendantOf:browser])) return nil;
      }
      return event;
    }];
  }
}

static NSPoint BrowserInputPoint(NSView *view, double x, double y) {
  NSRect bounds = view.bounds;
  return NSMakePoint(bounds.origin.x + MIN(bounds.size.width - 1, x * bounds.size.width), bounds.origin.y + (view.flipped ? MIN(bounds.size.height - 1, y * bounds.size.height) : MAX(1, (1-y) * bounds.size.height)));
}
static NSEvent *BrowserMouseEvent(NSView *view, NSEventType type, NSPoint point, NSInteger count, NSTimeInterval time) {
  return [NSEvent mouseEventWithType:type location:[view convertPoint:point toView:nil] modifierFlags:0 timestamp:time windowNumber:view.window.windowNumber context:nil eventNumber:0 clickCount:count pressure:type == NSEventTypeLeftMouseUp || type == NSEventTypeRightMouseUp ? 0 : 1];
}
static NSArray *BrowserKey(NSString *key) {
  NSDictionary *special = @{@"Enter":@[@(kVK_Return),@"\r"],@"Escape":@[@(kVK_Escape),@"\033"],@"Tab":@[@(kVK_Tab),@"\t"],@"Backspace":@[@(kVK_Delete),@"\177"],@"Delete":@[@(kVK_ForwardDelete),@"\uF728"],@"ArrowLeft":@[@(kVK_LeftArrow),@"\uF702"],@"ArrowRight":@[@(kVK_RightArrow),@"\uF703"],@"ArrowUp":@[@(kVK_UpArrow),@"\uF700"],@"ArrowDown":@[@(kVK_DownArrow),@"\uF701"],@"Home":@[@(kVK_Home),@"\uF729"],@"End":@[@(kVK_End),@"\uF72B"],@"PageUp":@[@(kVK_PageUp),@"\uF72C"],@"PageDown":@[@(kVK_PageDown),@"\uF72D"],@"Space":@[@(kVK_Space),@" "]};
  if (special[key]) return special[key];
  NSString *chars = @"asdfhgzxcv§bqweryt123465=97-80]ou[ip\rlj'k;\\,/nm.\t `";
  // Carbon virtual key codes are layout-independent physical ANSI positions.
  NSString *base = key.lowercaseString;
  NSDictionary *shifted = @{@"!":@"1",@"@":@"2",@"#":@"3",@"$":@"4",@"%":@"5",@"^":@"6",@"&":@"7",@"*":@"8",@"(":@"9",@")":@"0",@"_":@"-",@"+":@"=",@"{":@"[",@"}":@"]",@"|":@"\\",@"\"":@"'",@":":@";",@"<":@",",@">":@".",@"?":@"/",@"~":@"`"};
  if (shifted[key]) base=shifted[key];
  NSRange index = [chars rangeOfString:base];
  if (key.length == 1 && index.location != NSNotFound) return @[@(index.location), key, base, @(![base isEqual:key])];
  return nil;
}

// Called only on the main thread following task, grant and snapshot checks.
// Never use NSApp.sendEvent or CGEventPost: those could reach browser chrome,
// a different app, or a window that became active while the model was thinking.
char *misty_browser_native_action(void *pointer, const char *json) {
  @autoreleasepool {
    WKWebView *view = (__bridge WKWebView *)pointer;
    NSDictionary *input = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSWindow *window = view.window;
    if (!window || !window.visible || window.miniaturized || view.hiddenOrHasHiddenAncestor) return BrowserInputJSON(@{@"error":@"The granted browser must be visible before native input."});
    NSDictionary *viewport = input[@"viewport"];
    if (fabs(view.bounds.size.width / view.pageZoom - [viewport[@"width"] doubleValue]) > 2 || fabs(view.bounds.size.height / view.pageZoom - [viewport[@"height"] doubleValue]) > 2)
      return BrowserInputJSON(@{@"error":@"browser_snapshot_stale: browser viewport resized before native input"});
    NSDictionary *action = input[@"action"];
    NSString *kind = action[@"kind"];
    NSTimeInterval time = NSProcessInfo.processInfo.systemUptime;
    if ([kind isEqual:@"click"] || [kind isEqual:@"drag"] || [kind isEqual:@"scroll"]) {
      BOOL drag = [kind isEqual:@"drag"];
      NSPoint point = BrowserInputPoint(view,[action[drag ? @"fromX" : @"x"] doubleValue],[action[drag ? @"fromY" : @"y"] doubleValue]);
      NSView *target = [view hitTest:[view convertPoint:point toView:view.superview]];
      if (!target || !(target == view || [target isDescendantOf:view])) return BrowserInputJSON(@{@"error":@"The inspected browser target is unavailable"});
      if ([kind isEqual:@"scroll"]) {
        CGEventRef cg = CGEventCreateScrollWheelEvent(NULL,kCGScrollEventUnitPixel,2,-[action[@"deltaY"] intValue],-[action[@"deltaX"] intValue]);
        NSPoint screen = [window convertPointToScreen:[view convertPoint:point toView:nil]];
        CGEventSetLocation(cg,CGPointMake(screen.x,NSScreen.screens.firstObject.frame.size.height-screen.y));
        [target scrollWheel:[NSEvent eventWithCGEvent:cg]]; CFRelease(cg);
      } else {
        [window makeFirstResponder:target];
        BOOL right = [action[@"button"] isEqual:@"right"];
        NSInteger count = action[@"clickCount"] ? [action[@"clickCount"] integerValue] : 1;
        if (drag) count=1;
        for (NSInteger click=1; click<=count; click++) {
          NSEvent *down = BrowserMouseEvent(view,right ? NSEventTypeRightMouseDown : NSEventTypeLeftMouseDown,point,click,time);
          if (right) [target rightMouseDown:down]; else [target mouseDown:down];
          NSPoint end=point;
          if (drag) {
            end=BrowserInputPoint(view,[action[@"toX"] doubleValue],[action[@"toY"] doubleValue]);
            for (NSInteger step=1; step<=24; step++) {
              double fraction=(double)step/24;
              NSPoint next=NSMakePoint(point.x+(end.x-point.x)*fraction,point.y+(end.y-point.y)*fraction);
              [target mouseDragged:BrowserMouseEvent(view,NSEventTypeLeftMouseDragged,next,1,time+fraction*0.3)];
            }
          }
          NSEvent *up=BrowserMouseEvent(view,right ? NSEventTypeRightMouseUp : NSEventTypeLeftMouseUp,end,click,time+(drag ? 0.31 : 0.01));
          if (right) [target rightMouseUp:up]; else [target mouseUp:up];
          time+=0.08;
        }
      }
    } else {
      NSResponder *responder=window.firstResponder;
      if (![responder isKindOfClass:NSView.class] || ![(NSView *)responder isDescendantOf:view]) {
        if ([kind isEqual:@"type"]) return BrowserInputJSON(@{@"error":@"Focus an editable field in the granted browser before typing"});
        NSPoint center=NSMakePoint(NSMidX(view.bounds),NSMidY(view.bounds));
        responder=[view hitTest:[view convertPoint:center toView:view.superview]];
        if (!responder || ![(NSView *)responder isDescendantOf:view]) return BrowserInputJSON(@{@"error":@"Focus a field in the granted browser first"});
      }
      if ([kind isEqual:@"type"]) {
        if (![responder respondsToSelector:@selector(insertText:replacementRange:)]) return BrowserInputJSON(@{@"error":@"The focused browser control cannot accept text"});
        [(id<NSTextInputClient>)responder insertText:action[@"text"] replacementRange:NSMakeRange(NSNotFound,0)];
      } else if ([kind isEqual:@"key"]) {
        if ([action[@"modifiers"] containsObject:@"Meta"] && (![@[@"a",@"z"] containsObject:[action[@"key"] lowercaseString]] || [action[@"modifiers"] containsObject:@"Control"] || [action[@"modifiers"] containsObject:@"Alt"]))
          return BrowserInputJSON(@{@"error":@"Only select-all and undo/redo Command shortcuts are supported"});
        NSArray *spec=BrowserKey(action[@"key"]);
        if (!spec) return BrowserInputJSON(@{@"error":@"Unsupported native browser key"});
        NSEventModifierFlags flags=spec.count > 3 && [spec[3] boolValue] ? NSEventModifierFlagShift : 0;
        for (NSString *modifier in action[@"modifiers"]) {
          if ([modifier isEqual:@"Meta"]) flags|=NSEventModifierFlagCommand;
          if ([modifier isEqual:@"Shift"]) flags|=NSEventModifierFlagShift;
          if ([modifier isEqual:@"Alt"]) flags|=NSEventModifierFlagOption;
          if ([modifier isEqual:@"Control"]) flags|=NSEventModifierFlagControl;
        }
        for (NSNumber *type in @[@(NSEventTypeKeyDown),@(NSEventTypeKeyUp)]) {
          NSEvent *event=[NSEvent keyEventWithType:type.unsignedIntegerValue location:NSZeroPoint modifierFlags:flags timestamp:time windowNumber:window.windowNumber context:nil characters:spec[1] charactersIgnoringModifiers:spec.count > 2 ? spec[2] : [spec[1] lowercaseString] isARepeat:NO keyCode:[spec[0] unsignedShortValue]];
          if (event.type==NSEventTypeKeyDown) {
            // WebKit editor defaults require an explicit editing command when
            // this agent-owned window is not key. Canvas applications instead
            // receive their ordinary shortcut events. Never send through NSApp.
            if (flags & NSEventModifierFlagCommand && [input[@"editable"] boolValue]) {
              NSDictionary *commands=@{@"a":@"selectAll:",@"z":flags & NSEventModifierFlagShift ? @"redo:" : @"undo:"};
              [responder doCommandBySelector:NSSelectorFromString(commands[[action[@"key"] lowercaseString]])];
            } else [responder keyDown:event];
          } else [responder keyUp:event];
        }
      } else return BrowserInputJSON(@{@"error":@"Unsupported native browser action"});
    }
    return BrowserInputJSON(@{@"attempted":@YES,@"verified":@NO,@"driver":@"native-wkwebview"});
  }
}

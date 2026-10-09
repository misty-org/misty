#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <QuartzCore/QuartzCore.h>
#import "MistyAgentPointer.h"
#import "MistyAgentRing.h"

// Misty's own pointer for desktop tasks. It is a drawing above every app that
// never takes input; actions reach apps through Accessibility and app-targeted
// key events, so the person's pointer and keyboard focus stay theirs.

@interface MistyAgentPointerView : NSView
@end
@implementation MistyAgentPointerView
- (NSView *)hitTest:(NSPoint)point { (void)point; return nil; }
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)rect {
  (void)rect;
  // The same arrow as the in-page agent cursor (browser_agent_cursor.js), with
  // its tip at this view's corner.
  NSBezierPath *path = [NSBezierPath bezierPath];
  [path moveToPoint:NSMakePoint(1, 1)]; [path lineToPoint:NSMakePoint(21, 16)];
  [path lineToPoint:NSMakePoint(12, 17)]; [path lineToPoint:NSMakePoint(8, 25)]; [path closePath];
  path.lineJoinStyle = NSLineJoinStyleRound; path.lineWidth = 2;
  [[NSColor colorWithSRGBRed:0xa0 / 255.0 green:0xc4 / 255.0 blue:0xd4 / 255.0 alpha:1] setFill]; [path fill];
  [[NSColor colorWithSRGBRed:0x13 / 255.0 green:0x13 / 255.0 blue:0x13 / 255.0 alpha:1] setStroke]; [path stroke];
}
@end

static NSPanel *pointerPanel;
static AXUIElementRef focusedTarget;
static pid_t targetPID;

// Global display coordinates (top-left origin) to the Cocoa frame whose corner,
// where the arrow's tip is, sits one point past the target: Accessibility
// hit-testing at the target never lands on the pointer itself.
static NSRect pointerFrame(CGPoint point) {
  CGFloat top = CGDisplayBounds(CGMainDisplayID()).size.height;
  return NSMakeRect(point.x + 1, top - point.y - 1 - 30, 26, 30);
}

void misty_agent_pointer_move(double x, double y) {
  CGPoint point = CGPointMake(x, y);
  void (^work)(void) = ^{
    if (!pointerPanel) {
      pointerPanel = [[NSPanel alloc] initWithContentRect:pointerFrame(point)
        styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
      // Titled so desktop capture keeps it: every screenshot shows where Misty points.
      pointerPanel.title = @"Misty agent cursor";
      pointerPanel.level = NSStatusWindowLevel + 1;
      pointerPanel.opaque = NO;
      pointerPanel.backgroundColor = NSColor.clearColor;
      pointerPanel.hasShadow = NO;
      pointerPanel.ignoresMouseEvents = YES;
      pointerPanel.hidesOnDeactivate = NO;
      pointerPanel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
        NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorStationary |
        NSWindowCollectionBehaviorIgnoresCycle;
      pointerPanel.contentView = [[MistyAgentPointerView alloc] initWithFrame:NSMakeRect(0, 0, 26, 30)];
      [pointerPanel orderFrontRegardless];
      return;
    }
    BOOL reduced = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
    [pointerPanel orderFrontRegardless];
    if (reduced) { [pointerPanel setFrame:pointerFrame(point) display:YES]; return; }
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
      context.duration = 0.16;
      context.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.16 :1 :0.3 :1];
      [pointerPanel.animator setFrame:pointerFrame(point) display:YES];
    }];
  };
  if (NSThread.isMainThread) work(); else dispatch_sync(dispatch_get_main_queue(), work);
}

void misty_agent_pointer_hide(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [pointerPanel orderOut:nil]; pointerPanel = nil;
    if (focusedTarget) { CFRelease(focusedTarget); focusedTarget = NULL; }
    targetPID = 0;
  });
}

static NSString *stringAttribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess || !value) return @"";
  NSString *text = CFGetTypeID(value) == CFStringGetTypeID() ? [(__bridge NSString *)value copy] : @"";
  CFRelease(value);
  return text;
}

static BOOL hasAction(AXUIElementRef element, CFStringRef action) {
  CFArrayRef names = NULL;
  if (AXUIElementCopyActionNames(element, &names) != kAXErrorSuccess || !names) return NO;
  BOOL found = CFArrayContainsValue(names, CFRangeMake(0, CFArrayGetCount(names)), action);
  CFRelease(names);
  return found;
}

static BOOL settable(AXUIElementRef element, CFStringRef attribute) {
  Boolean value = false;
  return AXUIElementIsAttributeSettable(element, attribute, &value) == kAXErrorSuccess && value;
}

static BOOL editable(NSString *role) {
  return [@[@"AXTextField", @"AXTextArea", @"AXComboBox", @"AXSearchField"] containsObject:role];
}

// Presses or focuses the control under a point without moving the real pointer.
static NSDictionary *pointAt(CGPoint point) {
  AXUIElementRef system = AXUIElementCreateSystemWide();
  AXUIElementRef element = NULL;
  AXError error = AXUIElementCopyElementAtPosition(system, point.x, point.y, &element);
  CFRelease(system);
  if (error != kAXErrorSuccess || !element) return @{@"error": @"Nothing Misty can use is at that point. Choose a visible control."};
  pid_t owner = 0;
  AXUIElementGetPid(element, &owner);
  if (owner == NSProcessInfo.processInfo.processIdentifier) {
    CFRelease(element);
    return @{@"error": @"That is Misty's own control. Never operate the control strip or Stop."};
  }
  AXUIElementRef current = element;
  CFRetain(current);
  NSDictionary *result = nil;
  for (int depth = 0; depth < 6 && current && !result; depth++) {
    NSString *role = stringAttribute(current, kAXRoleAttribute);
    if ([role isEqualToString:@"AXWindow"] || [role isEqualToString:@"AXApplication"]) break;
    if (editable(role) && settable(current, kAXFocusedAttribute)) {
      AXUIElementSetAttributeValue(current, kAXFocusedAttribute, kCFBooleanTrue);
      if (focusedTarget) CFRelease(focusedTarget);
      focusedTarget = (AXUIElementRef)CFRetain(current);
      result = @{@"role": role, @"title": stringAttribute(current, kAXTitleAttribute), @"effect": @"focused"};
    } else if (hasAction(current, kAXPressAction)) {
      error = AXUIElementPerformAction(current, kAXPressAction);
      result = error == kAXErrorSuccess
        ? @{@"role": role, @"title": stringAttribute(current, kAXTitleAttribute), @"effect": @"pressed"}
        : @{@"error": @"That control did not accept a press."};
    } else {
      AXUIElementRef parent = NULL;
      AXUIElementCopyAttributeValue(current, kAXParentAttribute, (CFTypeRef *)&parent);
      CFRelease(current);
      current = parent;
      continue;
    }
  }
  if (result && !result[@"error"]) AXUIElementGetPid(element, &targetPID);
  if (current) CFRelease(current);
  CFRelease(element);
  return result ?: @{@"error": @"That spot has no button or field Misty can use without the real pointer. Try a nearby labeled control."};
}

// Inserts at the field Misty focused, replacing any selection, like typing.
static NSDictionary *insertAgentText(NSString *text) {
  if (!focusedTarget) return @{@"error": @"Click a text field before typing."};
  if (settable(focusedTarget, kAXSelectedTextAttribute) &&
      AXUIElementSetAttributeValue(focusedTarget, kAXSelectedTextAttribute, (__bridge CFStringRef)text) == kAXErrorSuccess)
    return @{@"effect": @"inserted"};
  if (settable(focusedTarget, kAXValueAttribute)) {
    NSString *value = stringAttribute(focusedTarget, kAXValueAttribute);
    if (AXUIElementSetAttributeValue(focusedTarget, kAXValueAttribute, (__bridge CFStringRef)[value stringByAppendingString:text]) == kAXErrorSuccess)
      return @{@"effect": @"appended"};
  }
  return @{@"error": @"That field does not accept text from Misty."};
}

static void postToTarget(CGKeyCode code, CGEventFlags flags) {
  for (NSNumber *down in @[@YES, @NO]) {
    CGEventRef event = CGEventCreateKeyboardEvent(NULL, code, down.boolValue);
    CGEventSetFlags(event, flags);
    CGEventSetIntegerValueField(event, kCGEventSourceUserData, MistyAgentEventTag);
    CGEventPostToPid(targetPID, event);
    CFRelease(event);
  }
}

static NSDictionary *pressKey(NSString *key) {
  if (!targetPID) return @{@"error": @"Click into an app before pressing keys."};
  if ([key isEqualToString:@"SelectAll"] && focusedTarget && settable(focusedTarget, kAXSelectedTextRangeAttribute)) {
    CFRange range = CFRangeMake(0, (CFIndex)stringAttribute(focusedTarget, kAXValueAttribute).length);
    AXValueRef value = AXValueCreate(kAXValueTypeCFRange, &range);
    AXError error = AXUIElementSetAttributeValue(focusedTarget, kAXSelectedTextRangeAttribute, value);
    CFRelease(value);
    if (error == kAXErrorSuccess) return @{@"effect": @"selected"};
  }
  if ([key isEqualToString:@"Enter"] && focusedTarget && hasAction(focusedTarget, kAXConfirmAction) &&
      AXUIElementPerformAction(focusedTarget, kAXConfirmAction) == kAXErrorSuccess)
    return @{@"effect": @"confirmed"};
  NSDictionary *keys = @{@"Enter": @(kVK_Return), @"Escape": @(kVK_Escape), @"Tab": @(kVK_Tab), @"Backspace": @(kVK_Delete),
    @"ArrowLeft": @(kVK_LeftArrow), @"ArrowRight": @(kVK_RightArrow), @"ArrowUp": @(kVK_UpArrow), @"ArrowDown": @(kVK_DownArrow),
    @"SelectAll": @(kVK_ANSI_A), @"Undo": @(kVK_ANSI_Z), @"AddressBar": @(kVK_ANSI_L), @"NewTab": @(kVK_ANSI_T), @"Find": @(kVK_ANSI_F)};
  NSNumber *code = keys[key];
  if (!code) return @{@"error": @"Unsupported desktop key."};
  BOOL command = [@[@"SelectAll", @"Undo", @"AddressBar", @"NewTab", @"Find"] containsObject:key];
  postToTarget(code.unsignedShortValue, command ? kCGEventFlagMaskCommand : 0);
  return @{@"effect": @"key"};
}

static NSDictionary *scrollAt(CGPoint point, int deltaX, int deltaY) {
  AXUIElementRef system = AXUIElementCreateSystemWide();
  AXUIElementRef element = NULL;
  AXUIElementCopyElementAtPosition(system, point.x, point.y, &element);
  CFRelease(system);
  if (!element) return @{@"error": @"Nothing to scroll at that point."};
  pid_t pid = 0;
  AXUIElementGetPid(element, &pid);
  CFRelease(element);
  CGEventRef event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2, -deltaY, -deltaX);
  CGEventSetLocation(event, point);
  CGEventSetIntegerValueField(event, kCGEventSourceUserData, MistyAgentEventTag);
  CGEventPostToPid(pid, event);
  CFRelease(event);
  return @{@"effect": @"scrolled"};
}

// Called on the main queue after Rust checks the task, grant and snapshot.
// `point` is in global display coordinates.
NSDictionary *MistyAgentDesktopAction(NSDictionary *action, CGPoint point) {
  NSString *kind = action[@"kind"];
  if ([kind isEqual:@"point"]) {
    misty_agent_pointer_move(point.x, point.y);
    misty_agent_ring_pulse(point);
    return pointAt(point);
  }
  if ([kind isEqual:@"scroll"]) {
    misty_agent_pointer_move(point.x, point.y);
    misty_agent_ring_pulse(point);
    return scrollAt(point, [action[@"deltaX"] intValue], [action[@"deltaY"] intValue]);
  }
  if ([kind isEqual:@"type"]) {
    NSString *text = action[@"text"];
    return [text isKindOfClass:NSString.class] && text.length <= 16000 ? insertAgentText(text) : @{@"error": @"Invalid text."};
  }
  if ([kind isEqual:@"key"]) return pressKey(action[@"key"]);
  return @{@"error": @"Unsupported desktop action."};
}

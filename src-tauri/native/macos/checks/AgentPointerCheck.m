#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import "../MistyAgentPointer.h"

// Live check of Misty's desktop pointer: opens a text file in TextEdit, then
// clicks into it, types and selects through Accessibility while the person's
// pointer stays where it is. Run with `npm run check:desktop-agent`.

static AXUIElementRef textArea(pid_t pid) {
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  CFArrayRef windows = NULL;
  AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, (CFTypeRef *)&windows);
  CFRelease(app);
  if (!windows || !CFArrayGetCount(windows)) return NULL;
  NSMutableArray *queue = [NSMutableArray arrayWithObject:(__bridge id)CFArrayGetValueAtIndex(windows, 0)];
  AXUIElementRef found = NULL;
  while (queue.count && !found) {
    AXUIElementRef element = (__bridge AXUIElementRef)queue.firstObject;
    [queue removeObjectAtIndex:0];
    CFTypeRef role = NULL;
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute, &role);
    if (role && CFEqual(role, kAXTextAreaRole)) found = (AXUIElementRef)CFRetain(element);
    if (role) CFRelease(role);
    CFArrayRef children = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, (CFTypeRef *)&children) == kAXErrorSuccess && children) {
      [queue addObjectsFromArray:(__bridge NSArray *)children];
      CFRelease(children);
    }
  }
  CFRelease(windows);
  return found;
}

static CGPoint centerOf(AXUIElementRef element) {
  CFTypeRef position = NULL, size = NULL;
  CGPoint origin = CGPointZero; CGSize extent = CGSizeZero;
  AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &position);
  AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &size);
  if (position) { AXValueGetValue(position, kAXValueTypeCGPoint, &origin); CFRelease(position); }
  if (size) { AXValueGetValue(size, kAXValueTypeCGSize, &extent); CFRelease(size); }
  return CGPointMake(origin.x + extent.width / 2, origin.y + extent.height / 2);
}

static void spin(NSTimeInterval seconds) {
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}

static int fail(NSString *message) {
  fprintf(stderr, "FAIL %s\n", message.UTF8String);
  return 1;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    if (!AXIsProcessTrusted())
      return fail(@"Allow this terminal in System Settings → Privacy & Security → Accessibility, then run again.");
    if (argc < 2) return fail(@"usage: AgentPointerCheck <text file>");
    NSURL *file = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    NSWorkspaceOpenConfiguration *config = [NSWorkspaceOpenConfiguration configuration];
    config.activates = NO;
    __block NSRunningApplication *editor;
    [NSWorkspace.sharedWorkspace openURLs:@[file]
                     withApplicationAtURL:[NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:@"com.apple.TextEdit"]
                            configuration:config
                        completionHandler:^(NSRunningApplication *app, NSError *error) { (void)error; editor = app; }];
    AXUIElementRef area = NULL;
    for (int attempt = 0; attempt < 40 && !area; attempt++) {
      spin(0.25);
      if (editor) area = textArea(editor.processIdentifier);
    }
    if (!area) return fail(@"TextEdit's text area did not appear.");
    CGEventRef before = CGEventCreate(NULL);
    CGPoint human = CGEventGetLocation(before); CFRelease(before);

    CGPoint target = centerOf(area);
    NSDictionary *point = MistyAgentDesktopAction(@{@"kind": @"point", @"x": @0, @"y": @0}, target);
    if (point[@"error"]) return fail(point[@"error"]);
    spin(0.4);
    NSDictionary *typed = MistyAgentDesktopAction(@{@"kind": @"type", @"text": @" Misty was here."}, target);
    if (typed[@"error"]) return fail(typed[@"error"]);
    spin(0.4);
    CFTypeRef value = NULL;
    AXUIElementCopyAttributeValue(area, kAXValueAttribute, &value);
    NSString *text = value ? (__bridge_transfer NSString *)value : @"";
    if (![text containsString:@"Misty was here."]) return fail([@"Typed text missing: " stringByAppendingString:text]);
    NSDictionary *selected = MistyAgentDesktopAction(@{@"kind": @"key", @"key": @"SelectAll"}, target);
    if (selected[@"error"]) return fail(selected[@"error"]);

    CGEventRef after = CGEventCreate(NULL);
    CGPoint now = CGEventGetLocation(after); CFRelease(after);
    if (fabs(now.x - human.x) > 0.5 || fabs(now.y - human.y) > 0.5) return fail(@"The person's pointer moved.");
    printf("PASS clicked %s, typed and selected in TextEdit; your pointer stayed at (%.0f, %.0f).\n",
           [point[@"effect"] UTF8String], human.x, human.y);
    spin(1.5);
    misty_agent_pointer_hide();
    spin(0.2);
    CFRelease(area);
    return 0;
  }
}

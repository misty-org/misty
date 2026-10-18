// Dictation insertion: borrow the pasteboard, send Cmd+V, and put the saved
// pasteboard back. Pasting into another app needs Accessibility.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#include <stdlib.h>
#include <string.h>

// Every item and every type, so files, images and rich text survive.
void *misty_pasteboard_snapshot(void) {
  @autoreleasepool {
    NSMutableArray<NSPasteboardItem *> *copies = [NSMutableArray array];
    for (NSPasteboardItem *item in NSPasteboard.generalPasteboard.pasteboardItems ?: @[]) {
      NSPasteboardItem *copy = [[NSPasteboardItem alloc] init];
      for (NSPasteboardType type in item.types) {
        NSData *data = [item dataForType:type];
        if (data) [copy setData:data forType:type];
      }
      [copies addObject:copy];
    }
    return (__bridge_retained void *)copies;
  }
}

void misty_pasteboard_restore(void *snapshot) {
  if (!snapshot) return;
  @autoreleasepool {
    NSArray<NSPasteboardItem *> *items = (__bridge_transfer NSArray *)snapshot;
    NSPasteboard *board = NSPasteboard.generalPasteboard;
    [board clearContents];
    if (items.count) [board writeObjects:items];
  }
}

void misty_pasteboard_discard(void *snapshot) {
  if (snapshot) CFRelease(snapshot);
}

long misty_pasteboard_write_text(const char *text) {
  @autoreleasepool {
    NSPasteboard *board = NSPasteboard.generalPasteboard;
    [board clearContents];
    [board setString:[NSString stringWithUTF8String:text ?: ""] forType:NSPasteboardTypeString];
    return (long)board.changeCount;
  }
}

long misty_pasteboard_change_count(void) { return (long)NSPasteboard.generalPasteboard.changeCount; }

bool misty_accessibility_trusted(bool prompt) {
  NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @(prompt)};
  return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}

// Caller frees with free().
char *misty_frontmost_bundle_id(void) {
  @autoreleasepool {
    NSString *bundle = NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier;
    return bundle ? strdup(bundle.UTF8String) : NULL;
  }
}

bool misty_frontmost_is_self(void) {
  return NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == NSProcessInfo.processInfo.processIdentifier;
}

bool misty_post_command_v(void) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  CGEventRef down = CGEventCreateKeyboardEvent(source, kVK_ANSI_V, true);
  CGEventRef up = CGEventCreateKeyboardEvent(source, kVK_ANSI_V, false);
  bool ok = down && up;
  if (ok) {
    // Only Command: the person's own modifiers were released before this.
    CGEventSetFlags(down, kCGEventFlagMaskCommand);
    CGEventSetFlags(up, kCGEventFlagMaskCommand);
    CGEventPost(kCGHIDEventTap, down);
    CGEventPost(kCGHIDEventTap, up);
  }
  if (down) CFRelease(down);
  if (up) CFRelease(up);
  if (source) CFRelease(source);
  return ok;
}

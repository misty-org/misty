#import <AppKit/AppKit.h>
#import "MistyDesktopControlInternal.h"

// The control island: the in-app island's view outside Misty during desktop
// control. Misty's island owns its state and actions; this panel shows them
// and sends the person's presses back (docs/agents/cursor-companion.md).
static void (*notifyIsland)(const char *);
static NSTextField *islandStatus, *islandMeta, *islandField;
static NSButton *islandSend, *islandQueue, *islandTake, *islandDone;
static NSString *islandStatusText, *islandMetaText, *islandWaitingText;
void islandReset(void (*island)(const char *)) {
  notifyIsland = island;
  islandStatusText = islandMetaText = islandWaitingText = nil;
}
void islandSetText(NSString *status, NSString *meta, NSString *waiting) {
  islandStatusText = status;
  islandMetaText = meta;
  islandWaitingText = waiting;
}
static void islandSendAction(NSString *action, NSString *text) {
  if (!notifyIsland || !MistyDesktopTask().length) return;
  char *value = DesktopJSON(@{@"taskId": MistyDesktopTask(), @"action": action, @"text": text ?: @""});
  notifyIsland(value); free(value);
}
@interface MistyDesktopPanel : NSPanel
- (void)stopPressed:(id)sender;
@end
@implementation MistyDesktopPanel
// Key only when the person clicks into the field, never by being shown; the
// app they work in stays active. Agent input never reaches it: Accessibility
// refuses Misty's own process and agent keys go to the other app's process.
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
- (void)stopPressed:(id)sender { stopControl(@"Desktop control stopped. You have control."); }
- (void)submit:(NSString *)action {
  NSString *text = [islandField.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (!text.length) return;
  islandField.stringValue = @"";
  [self makeFirstResponder:nil];
  islandSendAction(action, text);
}
- (void)sendPressed:(id)sender { [self submit:@"send"]; }
- (void)queuePressed:(id)sender { [self submit:@"queue"]; }
- (void)takeOverPressed:(id)sender { islandSendAction(@"takeover", nil); }
- (void)donePressed:(id)sender { islandSendAction(@"done", nil); }
@end

static NSTextField *islandLabel(NSRect frame, CGFloat size, NSColor *color) {
  NSTextField *label = [NSTextField labelWithString:@""];
  label.frame = frame;
  label.textColor = color;
  label.font = [NSFont systemFontOfSize:size weight:NSFontWeightMedium];
  label.lineBreakMode = NSLineBreakByTruncatingTail;
  return label;
}
static NSButton *islandButton(NSString *title, SEL action, NSRect frame, NSPanel *panel) {
  NSButton *button = [NSButton buttonWithTitle:title target:panel action:action];
  button.frame = frame;
  button.bezelStyle = NSBezelStyleRounded;
  button.controlSize = NSControlSizeRegular;
  [panel.contentView addSubview:button];
  return button;
}
// Status, a field to steer or queue, Take over, Stop and Escape; Done while
// the task waits for the person.
NSPanel *islandPanel(CGRect display) {
  CGFloat top = CGDisplayBounds(CGMainDisplayID()).size.height, width = 560, height = 116;
  NSRect frame = NSMakeRect(display.origin.x + (display.size.width - width) / 2,
    top - CGRectGetMaxY(display) + 24, width, height);
  MistyDesktopPanel *panel = [[MistyDesktopPanel alloc] initWithContentRect:frame
    styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
  panel.title = @"Misty desktop control";
  panel.level = NSStatusWindowLevel;
  panel.hidesOnDeactivate = NO;
  panel.becomesKeyOnlyIfNeeded = YES;
  panel.sharingType = NSWindowSharingNone;
  panel.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  panel.backgroundColor = NSColor.clearColor;
  panel.opaque = NO;
  panel.hasShadow = YES;
  NSView *content = panel.contentView;
  content.wantsLayer = YES;
  content.layer.backgroundColor = [NSColor colorWithWhite:0.08 alpha:0.96].CGColor;
  content.layer.cornerRadius = 16;
  content.layer.borderWidth = 1;
  content.layer.borderColor = [NSColor colorWithWhite:1 alpha:0.12].CGColor;
  islandStatus = islandLabel(NSMakeRect(16, 84, 392, 18), 12.5, NSColor.whiteColor);
  islandMeta = islandLabel(NSMakeRect(412, 84, 132, 18), 12, [NSColor colorWithWhite:1 alpha:0.6]);
  islandMeta.alignment = NSTextAlignmentRight;
  [content addSubview:islandStatus];
  [content addSubview:islandMeta];
  islandField = [NSTextField textFieldWithString:@""];
  islandField.frame = NSMakeRect(12, 47, 356, 28);
  islandField.placeholderString = @"Tell Misty what to change, or ask for something new";
  islandField.target = panel;
  islandField.action = @selector(sendPressed:);
  [content addSubview:islandField];
  islandSend = islandButton(@"Send", @selector(sendPressed:), NSMakeRect(372, 44, 80, 34), panel);
  islandQueue = islandButton(@"New task", @selector(queuePressed:), NSMakeRect(454, 44, 94, 34), panel);
  islandTake = islandButton(@"Take over", @selector(takeOverPressed:), NSMakeRect(8, 6, 100, 34), panel);
  NSTextField *escape = islandLabel(NSMakeRect(318, 15, 140, 16), 11.5, [NSColor colorWithWhite:1 alpha:0.55]);
  escape.stringValue = @"Esc stops";
  escape.alignment = NSTextAlignmentRight;
  [content addSubview:escape];
  islandDone = islandButton(@"Done", @selector(donePressed:), NSMakeRect(380, 6, 80, 34), panel);
  NSButton *stop = islandButton(@"Stop", @selector(stopPressed:), NSMakeRect(462, 6, 86, 34), panel);
  stop.keyEquivalent = @"";
  return panel;
}
void islandMode(BOOL waiting) {
  islandStatus.stringValue = waiting
    ? (islandWaitingText.length ? islandWaitingText : @"Misty is waiting for you. Press Done when you're finished.")
    : (islandStatusText.length ? islandStatusText : @"Misty is working with its own cursor");
  islandMeta.stringValue = waiting ? @"" : (islandMetaText ?: @"");
  for (NSView *view in @[islandField, islandSend, islandQueue, islandTake]) view.hidden = waiting;
  islandDone.hidden = !waiting;
  if (waiting) islandDone.keyEquivalent = @"\r";
}

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <WebKit/WebKit.h>
#import "MistyAgentRing.h"

// Docked agent windows (docs/design/agents-at-cursor/BRIEF.md, "Taking over the
// app"). A docked window is the agent's real window, a child of Misty's window
// that sits in its corner and moves with it; it never floats over other apps.
// Its content view keeps bounds at the full size the content was laid out for
// while the window frame shrinks, so pages never relayout and snapshots stay
// full resolution. WebKit keeps every docked page running: pages ignore their
// window being covered, and when Misty hides or minimizes, docked windows stay
// on screen, transparent and click-through, instead of leaving it.

typedef void (*MistyDockCallback)(const char *json);
static MistyDockCallback dockCallback;

static const CGFloat DockWidth = 288, CornerMargin = 24, EdgeMargin = 8, CarouselStep = 170;
static const CGFloat CaptionWidth = 440, CaptionHeight = 58, AnimationSeconds = 0.42;
// The status pill: its height and how far it floats in from the window edges.
static const CGFloat PillHeight = 26, PillInset = 8;

@class MistyDockOverlay;

@interface MistyDockEntry : NSObject
@property(nonatomic, weak) NSWindow *window;
@property(nonatomic, copy) NSString *identifier;
@property(nonatomic, copy) NSString *name;
@property(nonatomic, copy) NSString *status;
@property(nonatomic) BOOL waiting;
@property(nonatomic) BOOL docked;
@property(nonatomic, strong) NSView *container;
// Misty's control mist, at the content's full size, so it shrinks with the page.
@property(nonatomic, strong) NSView *mist;
@property(nonatomic, strong) MistyDockOverlay *overlay;
@property(nonatomic) NSSize full;
@property(nonatomic) NSRect savedFrame;
@property(nonatomic) NSWindowStyleMask savedMask;
@property(nonatomic) NSWindowLevel savedLevel;
@property(nonatomic) NSWindowCollectionBehavior savedBehavior;
@property(nonatomic) NSSize savedMinSize;
@property(nonatomic) BOOL savedCanHide, savedTransparentTitlebar, savedExcluded;
@property(nonatomic) NSWindowTitleVisibility savedTitleVisibility;
@property(nonatomic) NSRect from, to;
@property(nonatomic) CGFloat fromDim, toDim;
@end
@implementation MistyDockEntry
@end

typedef NS_ENUM(NSInteger, MistyDockAnchor) {
  AnchorBottomRight, AnchorTopRight, AnchorTopLeft, AnchorBottomLeft, AnchorRightEdge, AnchorLeftEdge
};

static NSMutableArray<MistyDockEntry *> *allEntries;  // every window the dock has prepared
static NSMutableArray<MistyDockEntry *> *docked;      // docked windows, front first
static MistyDockAnchor anchor = AnchorBottomRight;
static CGFloat edgeCenterY;
static NSScreen *anchorScreen;
static BOOL carousel;
static NSInteger selected;
static NSTimer *animation, *adoption;
static CFTimeInterval animationStart;
static id outsideMonitor, localOutsideMonitor;
@class MistyDockCaption;
static MistyDockCaption *caption;
// Misty's window: docked windows are its children and lay out inside its frame.
static __weak NSWindow *parentWindow;

/// Every WKWebView in a view tree.
static void EachWebView(NSView *root, void (^visit)(WKWebView *)) {
  if ([root isKindOfClass:WKWebView.class]) visit((WKWebView *)root);
  for (NSView *child in root.subviews) EachWebView(child, visit);
}
/// WebKit's own switch for throttling a page whose window is covered (private;
/// docked pages turn it off so they keep painting behind other windows).
static NSInteger SetOcclusionDetection(NSView *root, BOOL enabled) {
  __block NSInteger count = 0;
  SEL setter = NSSelectorFromString(@"_setWindowOcclusionDetectionEnabled:");
  EachWebView(root, ^(WKWebView *view) {
    if (![view respondsToSelector:setter]) return;
    ((void (*)(id, SEL, BOOL))[view methodForSelector:setter])(view, setter, enabled);
    count++;
  });
  return count;
}

static void Animate(void);
static void OpenEntry(MistyDockEntry *entry);
static void ShowCarousel(BOOL show);
static void Select(NSInteger index);

static void Emit(NSString *action, MistyDockEntry *entry) {
  if (!dockCallback) return;
  NSDictionary *payload = entry ? @{@"action": action, @"id": entry.identifier} : @{@"action": action};
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  dockCallback([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
static MistyDockEntry *EntryFor(NSString *identifier) {
  for (MistyDockEntry *entry in allEntries)
    if ([entry.identifier isEqualToString:identifier]) return entry;
  return nil;
}
static BOOL ReduceMotion(void) { return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion; }
static NSRect VisibleFrame(void) {
  if (parentWindow) return parentWindow.frame;
  NSScreen *screen = anchorScreen && [NSScreen.screens containsObject:anchorScreen] ? anchorScreen : (NSScreen.mainScreen ?: NSScreen.screens.firstObject);
  return screen.visibleFrame;
}
static BOOL AnchorRight(void) { return anchor == AnchorBottomRight || anchor == AnchorTopRight || anchor == AnchorRightEdge; }
static BOOL AnchorTop(void) { return anchor == AnchorTopRight || anchor == AnchorTopLeft; }
static BOOL AnchorEdge(void) { return anchor == AnchorRightEdge || anchor == AnchorLeftEdge; }
static NSSize DockSize(MistyDockEntry *entry, CGFloat scale) {
  CGFloat width = round(DockWidth * scale);
  CGFloat aspect = entry.full.width > 0 ? entry.full.height / entry.full.width : 0.625;
  return NSMakeSize(width, round(width * MIN(MAX(aspect, 0.4), 1.2)));
}
/// Carousel position relative to the chosen window, wrapped so it fans both ways.
static NSInteger Offset(NSInteger index) {
  NSInteger count = (NSInteger)docked.count, offset = index - selected;
  if (offset > count / 2) offset -= count;
  if (offset < -(count - 1) / 2) offset += count;
  return offset;
}

#pragma mark - Controls

@interface MistyDockButton : NSView
@property(nonatomic, copy) void (^action)(void);
@property(nonatomic, strong) NSImageView *icon;
@end
@implementation MistyDockButton
- (instancetype)initWithSymbol:(NSString *)symbol label:(NSString *)label {
  if ((self = [super initWithFrame:NSMakeRect(0, 0, 30, 30)])) {
    self.wantsLayer = YES;
    self.layer.cornerRadius = 15;
    self.layer.backgroundColor = [NSColor colorWithSRGBRed:0.07 green:0.08 blue:0.09 alpha:0.92].CGColor;
    self.layer.borderColor = [NSColor colorWithSRGBRed:0.23 green:0.25 blue:0.29 alpha:1].CGColor;
    self.layer.borderWidth = 1;
    NSImage *image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:label];
    self.icon = [NSImageView imageViewWithImage:image ?: [NSImage new]];
    self.icon.contentTintColor = NSColor.whiteColor;
    self.icon.frame = NSMakeRect(8, 8, 14, 14);
    self.icon.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:11 weight:NSFontWeightSemibold];
    [self addSubview:self.icon];
    self.toolTip = label;
    [self setAccessibilityRole:NSAccessibilityButtonRole];
    [self setAccessibilityLabel:label];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
// Round and centered at any size: 30 points at a corner, 20 inside the status pill.
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  self.layer.cornerRadius = MIN(size.width, size.height) / 2;
  self.icon.frame = NSMakeRect((size.width - 14) / 2, (size.height - 14) / 2, 14, 14);
}
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)shouldDelayWindowOrderingForEvent:(NSEvent *)event { return YES; }
- (void)mouseDown:(NSEvent *)event { [NSApp preventWindowOrdering]; }
- (void)mouseUp:(NSEvent *)event {
  if (NSPointInRect([self convertPoint:event.locationInWindow fromView:nil], self.bounds) && self.action) self.action();
}
- (BOOL)accessibilityPerformPress { if (self.action) self.action(); return YES; }
@end

#pragma mark - Overlay

// Sits above the window's content, takes every pointer event while docked (the
// page never sees them), and draws the dock's chrome. Its bounds are set to the
// window's on-screen size, so the chrome is drawn at normal size even though
// the content view underneath is scaled down.
@interface MistyDockOverlay : NSView
@property(nonatomic, weak) MistyDockEntry *entry;
@property(nonatomic) CGFloat dim;
@property(nonatomic, strong) CALayer *dimLayer, *labelLayer, *gripLayer;
@property(nonatomic, strong) NSTextField *label, *badge;
@property(nonatomic, strong) NSProgressIndicator *spinner;
@property(nonatomic, strong) NSImageView *waitIcon;
@property(nonatomic, strong) MistyDockButton *openButton, *stopButton;
@property(nonatomic) BOOL hovering, dragged;
@property(nonatomic) NSPoint downMouse;
@property(nonatomic, strong) NSArray<NSValue *> *downFrames;
@property(nonatomic) CGFloat scrollAccumulator;
@end


@implementation MistyDockOverlay
- (instancetype)initWithEntry:(MistyDockEntry *)entry {
  if ((self = [super initWithFrame:NSZeroRect])) {
    self.entry = entry;
    self.wantsLayer = YES;
    self.autoresizingMask = NSViewNotSizable;
    self.dimLayer = [CALayer layer];
    self.dimLayer.backgroundColor = NSColor.blackColor.CGColor;
    self.dimLayer.opacity = 0;
    // A small pill floating inset from the window's edges, not a strip along its bottom.
    self.labelLayer = [CALayer layer];
    self.labelLayer.backgroundColor = [NSColor colorWithSRGBRed:0.05 green:0.06 blue:0.07 alpha:0.9].CGColor;
    self.labelLayer.borderColor = [NSColor colorWithWhite:1 alpha:0.14].CGColor;
    self.labelLayer.borderWidth = 1;
    self.labelLayer.cornerRadius = PillHeight / 2;
    self.gripLayer = [CALayer layer];
    self.gripLayer.backgroundColor = [NSColor colorWithWhite:0.9 alpha:0.55].CGColor;
    self.gripLayer.cornerRadius = 2;
    self.gripLayer.hidden = YES;
    [self.layer addSublayer:self.labelLayer];
    [self.layer addSublayer:self.dimLayer];
    [self.layer addSublayer:self.gripLayer];

    self.spinner = [NSProgressIndicator new];
    self.spinner.style = NSProgressIndicatorStyleSpinning;
    self.spinner.controlSize = NSControlSizeSmall;
    self.spinner.displayedWhenStopped = NO;
    self.spinner.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    [self.spinner startAnimation:nil];
    self.waitIcon = [NSImageView imageViewWithImage:[NSImage imageWithSystemSymbolName:@"exclamationmark.circle" accessibilityDescription:@"Needs you"] ?: [NSImage new]];
    self.waitIcon.contentTintColor = NSColor.whiteColor;
    self.label = [NSTextField labelWithString:@""];
    self.label.font = [NSFont systemFontOfSize:11.5 weight:NSFontWeightMedium];
    self.label.textColor = [NSColor colorWithWhite:0.93 alpha:1];
    self.label.lineBreakMode = NSLineBreakByTruncatingTail;
    self.badge = [NSTextField labelWithString:@""];
    self.badge.font = [NSFont systemFontOfSize:11 weight:NSFontWeightSemibold];
    self.badge.alignment = NSTextAlignmentCenter;
    self.badge.textColor = [NSColor colorWithSRGBRed:0.04 green:0.05 blue:0.06 alpha:1];
    self.badge.wantsLayer = YES;
    self.badge.layer.backgroundColor = [NSColor colorWithSRGBRed:0.9 green:0.93 blue:0.95 alpha:1].CGColor;
    self.badge.layer.cornerRadius = 9;
    __weak MistyDockOverlay *weakSelf = self;
    self.openButton = [[MistyDockButton alloc] initWithSymbol:@"arrow.up.left.and.arrow.down.right" label:@"Open"];
    self.openButton.action = ^{ if (weakSelf.entry) OpenEntry(weakSelf.entry); };
    self.stopButton = [[MistyDockButton alloc] initWithSymbol:@"stop.fill" label:@"Stop"];
    self.stopButton.action = ^{ if (weakSelf.entry) Emit(@"stop", weakSelf.entry); };
    for (NSView *view in @[self.spinner, self.waitIcon, self.label, self.badge, self.openButton, self.stopButton]) [self addSubview:view];
    [self setAccessibilityElement:YES];
    [self setAccessibilityRole:NSAccessibilityButtonRole];
    [self updateTrackingAreas];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)shouldDelayWindowOrderingForEvent:(NSEvent *)event { return YES; }
- (BOOL)accessibilityPerformPress { if (self.entry) OpenEntry(self.entry); return YES; }

/// Match the window's on-screen size; called after every frame change.
- (void)sync:(CGFloat)dim {
  MistyDockEntry *entry = self.entry;
  NSWindow *window = entry.window;
  if (!window) return;
  NSSize size = window.contentView.frame.size;
  self.frame = NSMakeRect(0, 0, entry.full.width, entry.full.height);
  [self setBoundsOrigin:NSZeroPoint];
  [self setBoundsSize:size];
  self.dim = dim;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  CGFloat w = size.width, h = size.height;
  if (entry.mist) MistyAgentMistSetWaiting(entry.mist, entry.waiting);
  self.dimLayer.frame = CGRectMake(0, 0, w, h);
  self.dimLayer.opacity = (float)MAX(dim, self.hovering && dim == 0 ? 0.32 : 0);
  CGFloat pillX = PillInset, pillW = MAX(0, w - 2 * PillInset), pillY = h - PillInset - PillHeight;
  self.labelLayer.frame = CGRectMake(pillX, pillY, pillW, PillHeight);
  self.gripLayer.frame = CGRectMake(w / 2 - 18, 7, 36, 4);
  [CATransaction commit];
  BOOL chosen = dim == 0;
  BOOL showLabel = !carousel;
  self.labelLayer.hidden = !showLabel;
  self.label.hidden = !showLabel;
  NSUInteger count = docked.count;
  BOOL front = !carousel && count > 1 && docked.firstObject == entry;
  self.badge.stringValue = [NSString stringWithFormat:@"%lu", (unsigned long)count];
  CGFloat badgeWidth = MAX(20, 12 + 7 * self.badge.stringValue.length);
  BOOL controls = self.hovering && chosen && (carousel || count == 1 || docked.firstObject == entry);
  // Left to right inside the pill: icon, the label, Open and Stop on hover, the count.
  // In the carousel there is no pill, so Open and Stop sit at the window's top corners.
  CGFloat trailing = pillX + pillW - 6;
  self.badge.hidden = !front || !showLabel;
  self.badge.frame = NSMakeRect(trailing - badgeWidth, pillY + 4, badgeWidth, 18);
  if (front && showLabel) trailing -= badgeWidth + 6;
  BOOL inPill = controls && showLabel;
  if (inPill) {
    self.stopButton.frame = NSMakeRect(trailing - 20, pillY + 3, 20, 20);
    trailing -= 24;
    self.openButton.frame = NSMakeRect(trailing - 20, pillY + 3, 20, 20);
    trailing -= 24;
  } else {
    self.openButton.frame = NSMakeRect(10, 16, 30, 30);
    self.stopButton.frame = NSMakeRect(w - 40, 16, 30, 30);
  }
  self.label.frame = NSMakeRect(pillX + 28, pillY + 5, MAX(0, trailing - (pillX + 28) - 2), 16);
  self.spinner.frame = NSMakeRect(pillX + 9, pillY + 6, 14, 14);
  self.waitIcon.frame = NSMakeRect(pillX + 9, pillY + 6, 14, 14);
  self.spinner.hidden = !showLabel || entry.waiting;
  self.waitIcon.hidden = !showLabel || !entry.waiting;
  self.label.stringValue = entry.status.length ? entry.status : (entry.name.length ? [entry.name stringByAppendingString:@" is working"] : @"Working");
  self.gripLayer.hidden = !controls || carousel;
  self.openButton.hidden = !controls;
  self.stopButton.hidden = !controls;
  [self setAccessibilityLabel:[NSString stringWithFormat:@"%@: %@", entry.name.length ? entry.name : @"Agent", self.label.stringValue]];
}
- (void)updateTrackingAreas {
  for (NSTrackingArea *area in self.trackingAreas) [self removeTrackingArea:area];
  [self addTrackingArea:[[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect owner:self userInfo:nil]];
  [super updateTrackingAreas];
}
- (void)mouseEntered:(NSEvent *)event { self.hovering = YES; [self sync:self.dim]; }
- (void)mouseExited:(NSEvent *)event { self.hovering = NO; [self sync:self.dim]; }
- (void)mouseDown:(NSEvent *)event {
  [NSApp preventWindowOrdering];
  self.dragged = NO;
  self.downMouse = NSEvent.mouseLocation;
  NSMutableArray *frames = [NSMutableArray array];
  for (MistyDockEntry *entry in docked) [frames addObject:[NSValue valueWithRect:entry.window.frame]];
  self.downFrames = frames;
}
- (void)mouseDragged:(NSEvent *)event {
  if (carousel) return;
  NSPoint now = NSEvent.mouseLocation;
  CGFloat dx = now.x - self.downMouse.x, dy = now.y - self.downMouse.y;
  if (!self.dragged && hypot(dx, dy) < 4) return;
  if (!self.dragged) {
    [animation invalidate];
    animation = nil;
  }
  self.dragged = YES;
  // The stack moves together.
  [docked enumerateObjectsUsingBlock:^(MistyDockEntry *entry, NSUInteger index, BOOL *__unused stop) {
    if (index >= self.downFrames.count) return;
    NSRect frame = self.downFrames[index].rectValue;
    [entry.window setFrameOrigin:NSMakePoint(frame.origin.x + dx, frame.origin.y + dy)];
  }];
}
- (void)mouseUp:(NSEvent *)event {
  MistyDockEntry *entry = self.entry;
  if (!entry) return;
  if (self.dragged) {
    // Let go: snap to the nearest corner, or float by a side edge.
    NSWindow *front = docked.firstObject.window ?: entry.window;
    NSPoint center = NSMakePoint(NSMidX(front.frame), NSMidY(front.frame));
    for (NSScreen *screen in NSScreen.screens)
      if (NSPointInRect(center, screen.frame)) anchorScreen = screen;
    NSRect visible = VisibleFrame();
    BOOL right = center.x > NSMidX(visible), top = center.y > NSMidY(visible);
    CGFloat sideGap = right ? NSMaxX(visible) - NSMaxX(front.frame) : NSMinX(front.frame) - NSMinX(visible);
    CGFloat verticalGap = MIN(NSMaxY(visible) - NSMaxY(front.frame), NSMinY(front.frame) - NSMinY(visible));
    if (sideGap < 72 && verticalGap > front.frame.size.height * 0.6) {
      anchor = right ? AnchorRightEdge : AnchorLeftEdge;
      edgeCenterY = center.y;
    } else {
      anchor = right ? (top ? AnchorTopRight : AnchorBottomRight) : (top ? AnchorTopLeft : AnchorBottomLeft);
    }
    self.dragged = NO;
    Animate();
    return;
  }
  if (carousel) {
    NSUInteger index = [docked indexOfObject:entry];
    if (index == NSNotFound) return;
    if ((NSInteger)index == selected) OpenEntry(entry);
    else Select((NSInteger)index);
  } else if (docked.count > 1) {
    selected = 0;
    ShowCarousel(YES);
  } else {
    OpenEntry(entry);
  }
}
- (void)scrollWheel:(NSEvent *)event {
  if (!carousel) return;
  self.scrollAccumulator += fabs(event.scrollingDeltaX) > fabs(event.scrollingDeltaY) ? -event.scrollingDeltaX : -event.scrollingDeltaY;
  if (fabs(self.scrollAccumulator) < 40) return;
  NSInteger step = self.scrollAccumulator > 0 ? 1 : -1;
  self.scrollAccumulator = 0;
  NSInteger count = (NSInteger)docked.count;
  Select(((selected + step) % count + count) % count);
}
@end

#pragma mark - Carousel caption

@interface MistyDockCaptionPanel : NSPanel
@end
@implementation MistyDockCaptionPanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (void)keyDown:(NSEvent *)event {
  NSInteger count = (NSInteger)docked.count;
  if (!count) return;
  switch (event.keyCode) {
    case 123: Select(((selected - 1) % count + count) % count); return;  // left
    case 124: Select((selected + 1) % count); return;                    // right
    case 53: ShowCarousel(NO); return;                                    // escape
    case 36: case 76: OpenEntry(docked[(NSUInteger)selected]); return;    // return
    default: [super keyDown:event];
  }
}
- (void)cancelOperation:(id)sender { ShowCarousel(NO); }
@end

@interface MistyDockCaption : NSObject
@property(nonatomic, strong) MistyDockCaptionPanel *panel;
@property(nonatomic, strong) NSView *pill;
@property(nonatomic, strong) NSTextField *text;
@property(nonatomic, strong) NSProgressIndicator *spinner;
@property(nonatomic, strong) NSImageView *waitIcon;
@property(nonatomic, strong) NSView *dots;
@property(nonatomic, strong) MistyDockButton *previous, *next;
@end
@implementation MistyDockCaption
- (instancetype)init {
  if ((self = [super init])) {
    self.panel = [[MistyDockCaptionPanel alloc] initWithContentRect:NSMakeRect(0, 0, CaptionWidth, CaptionHeight) styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    self.panel.opaque = NO;
    self.panel.backgroundColor = NSColor.clearColor;
    self.panel.hasShadow = NO;
    self.panel.collectionBehavior = NSWindowCollectionBehaviorIgnoresCycle;
    self.panel.hidesOnDeactivate = NO;
    self.panel.becomesKeyOnlyIfNeeded = NO;
    NSView *root = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, CaptionWidth, CaptionHeight)];
    self.panel.contentView = root;
    self.pill = [[NSView alloc] initWithFrame:NSZeroRect];
    self.pill.wantsLayer = YES;
    self.pill.layer.cornerRadius = 10;
    self.pill.layer.backgroundColor = [NSColor colorWithSRGBRed:0.07 green:0.08 blue:0.09 alpha:0.94].CGColor;
    self.pill.layer.borderColor = [NSColor colorWithSRGBRed:0.2 green:0.23 blue:0.27 alpha:1].CGColor;
    self.pill.layer.borderWidth = 1;
    [root addSubview:self.pill];
    self.spinner = [NSProgressIndicator new];
    self.spinner.style = NSProgressIndicatorStyleSpinning;
    self.spinner.controlSize = NSControlSizeSmall;
    self.spinner.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    [self.spinner startAnimation:nil];
    self.waitIcon = [NSImageView imageViewWithImage:[NSImage imageWithSystemSymbolName:@"exclamationmark.circle" accessibilityDescription:@"Needs you"] ?: [NSImage new]];
    self.waitIcon.contentTintColor = NSColor.whiteColor;
    self.text = [NSTextField labelWithString:@""];
    self.text.font = [NSFont systemFontOfSize:12.5 weight:NSFontWeightMedium];
    self.text.textColor = [NSColor colorWithWhite:0.93 alpha:1];
    self.text.lineBreakMode = NSLineBreakByTruncatingTail;
    for (NSView *view in @[self.spinner, self.waitIcon, self.text]) [self.pill addSubview:view];
    self.previous = [[MistyDockButton alloc] initWithSymbol:@"chevron.left" label:@"Previous agent"];
    self.previous.action = ^{ NSInteger count = (NSInteger)docked.count; if (count) Select(((selected - 1) % count + count) % count); };
    self.next = [[MistyDockButton alloc] initWithSymbol:@"chevron.right" label:@"Next agent"];
    self.next.action = ^{ NSInteger count = (NSInteger)docked.count; if (count) Select((selected + 1) % count); };
    self.dots = [[NSView alloc] initWithFrame:NSZeroRect];
    for (NSView *view in @[self.previous, self.next, self.dots]) [root addSubview:view];
  }
  return self;
}
- (void)updateFor:(MistyDockEntry *)entry {
  NSString *status = entry.status.length ? entry.status : @"Working";
  self.text.stringValue = entry.name.length ? [NSString stringWithFormat:@"%@ · %@", status, entry.name] : status;
  self.spinner.hidden = entry.waiting;
  self.waitIcon.hidden = !entry.waiting;
  CGFloat textWidth = MIN(CaptionWidth - 120, ceil(self.text.intrinsicContentSize.width));
  CGFloat pillWidth = textWidth + 44;
  self.pill.frame = NSMakeRect(round((CaptionWidth - pillWidth) / 2), 22, pillWidth, 32);
  self.spinner.frame = NSMakeRect(12, 9, 14, 14);
  self.waitIcon.frame = NSMakeRect(12, 9, 14, 14);
  self.text.frame = NSMakeRect(32, 8, textWidth, 16);
  self.previous.frame = NSMakeRect(NSMinX(self.pill.frame) - 40, 23, 30, 30);
  self.next.frame = NSMakeRect(NSMaxX(self.pill.frame) + 10, 23, 30, 30);
  // One dot per agent; the chosen one is a wider bar.
  [self.dots.subviews makeObjectsPerformSelector:@selector(removeFromSuperview)];
  CGFloat x = 0;
  for (NSInteger index = 0; index < (NSInteger)docked.count; index++) {
    BOOL on = index == selected;
    NSView *dot = [[NSView alloc] initWithFrame:NSMakeRect(x, 0, on ? 18 : 6, 6)];
    dot.wantsLayer = YES;
    dot.layer.cornerRadius = 3;
    dot.layer.backgroundColor = on ? [NSColor colorWithWhite:0.93 alpha:1].CGColor : [NSColor colorWithWhite:0.32 alpha:1].CGColor;
    [self.dots addSubview:dot];
    x += (on ? 18 : 6) + 6;
  }
  self.dots.frame = NSMakeRect(round((CaptionWidth - (x - 6)) / 2), 6, MAX(0, x - 6), 6);
  [self.panel setAccessibilityLabel:self.text.stringValue];
}
@end

#pragma mark - Layout

// The front window sits at the anchor; the others fan in behind it toward the
// middle of the screen, each still showing a strip.
static void LayoutStack(void) {
  NSRect visible = VisibleFrame();
  NSUInteger count = docked.count;
  if (!count) return;
  CGFloat step = count > 1 ? MIN(30, 120.0 / (count - 1)) : 0;
  CGFloat dx = AnchorRight() ? -1 : 1, dy = AnchorTop() ? -1 : 1;
  CGFloat margin = AnchorEdge() ? EdgeMargin : CornerMargin;
  NSSize frontSize = DockSize(docked[0], 1);
  CGFloat cornerX = AnchorRight() ? NSMaxX(visible) - margin : NSMinX(visible) + margin;
  CGFloat cornerY = AnchorEdge()
      ? MIN(MAX(edgeCenterY - frontSize.height / 2, NSMinY(visible) + EdgeMargin), NSMaxY(visible) - EdgeMargin - frontSize.height)
      : (AnchorTop() ? NSMaxY(visible) - margin : NSMinY(visible) + margin);
  for (NSUInteger index = 0; index < count; index++) {
    MistyDockEntry *entry = docked[index];
    NSSize size = DockSize(entry, MAX(0.8, 1 - 0.05 * MIN(index, 4)));
    CGFloat x = cornerX + dx * step * index, y = cornerY + dy * step * 0.47 * index;
    entry.to = NSMakeRect(round(AnchorRight() ? x - size.width : x), round(AnchorTop() ? y - size.height : y), size.width, size.height);
    entry.toDim = index == 0 ? 0 : 0.38;
  }
}

// The chosen window in the middle, the others smaller to either side; more
// than two a side tuck behind the outermost with a strip each.
static void LayoutCarousel(void) {
  NSRect visible = VisibleFrame();
  NSSize middle = DockSize(docked[(NSUInteger)selected], 1);
  CGFloat half = 2 * CarouselStep + DockWidth / 2;
  CGFloat cx = AnchorRight() ? NSMaxX(visible) - CornerMargin - half : NSMinX(visible) + CornerMargin + half;
  cx = MIN(MAX(cx, NSMinX(visible) + half), NSMaxX(visible) - half);
  CGFloat cy = AnchorTop() ? NSMaxY(visible) - CornerMargin - middle.height / 2
                           : NSMinY(visible) + CornerMargin + CaptionHeight + 8 + middle.height / 2;
  for (NSUInteger index = 0; index < docked.count; index++) {
    MistyDockEntry *entry = docked[index];
    NSInteger offset = Offset((NSInteger)index);
    NSInteger distance = labs(offset), near = MIN(distance, 2), extra = distance - near;
    CGFloat sign = offset < 0 ? -1 : 1;
    NSSize size = DockSize(entry, 1 - 0.12 * near);
    CGFloat x = cx + sign * (near * CarouselStep + extra * 12) - size.width / 2;
    entry.to = NSMakeRect(round(x), round(cy - size.height / 2), size.width, size.height);
    entry.toDim = near == 0 ? 0 : near == 1 ? 0.3 : 0.5;
  }
}

static void PlaceCaption(void) {
  if (!carousel || !docked.count) {
    if (caption.panel.parentWindow) [caption.panel.parentWindow removeChildWindow:caption.panel];
    [caption.panel orderOut:nil];
    return;
  }
  if (!caption) caption = [MistyDockCaption new];
  MistyDockEntry *chosen = docked[(NSUInteger)selected];
  [caption updateFor:chosen];
  NSRect frame = chosen.to;
  // Below the chosen window; the carousel leaves room for it.
  CGFloat y = NSMinY(frame) - CaptionHeight - 4;
  [caption.panel setFrame:NSMakeRect(round(NSMidX(frame) - CaptionWidth / 2), round(y), CaptionWidth, CaptionHeight) display:YES];
  if (parentWindow && caption.panel.parentWindow != parentWindow) [parentWindow addChildWindow:caption.panel ordered:NSWindowAbove];
  [caption.panel orderWindow:NSWindowAbove relativeTo:chosen.window.windowNumber];
  [caption.panel makeKeyWindow];
}

static void ApplyFrame(MistyDockEntry *entry, NSRect frame, CGFloat dim) {
  NSWindow *window = entry.window;
  if (!window) return;
  [window setFrame:frame display:YES animate:NO];
  NSView *content = window.contentView;
  [content setBoundsOrigin:NSZeroPoint];
  [content setBoundsSize:entry.full];
  entry.container.frame = NSMakeRect(0, 0, entry.full.width, entry.full.height);
  [entry.overlay sync:dim];
}

// Farthest first, so the front or chosen window ends on top. Each is ordered
// just above the one before it, starting at Misty's window, so restacking
// never raises Misty over other apps, activates it or takes focus.
static void Restack(void) {
  NSArray<MistyDockEntry *> *order = [docked sortedArrayUsingComparator:^NSComparisonResult(MistyDockEntry *a, MistyDockEntry *b) {
    NSInteger ra = carousel ? labs(Offset((NSInteger)[docked indexOfObject:a])) : (NSInteger)[docked indexOfObject:a];
    NSInteger rb = carousel ? labs(Offset((NSInteger)[docked indexOfObject:b])) : (NSInteger)[docked indexOfObject:b];
    return ra > rb ? NSOrderedAscending : ra < rb ? NSOrderedDescending : NSOrderedSame;
  }];
  NSInteger below = parentWindow.windowNumber;
  for (MistyDockEntry *entry in order) {
    [entry.window orderWindow:NSWindowAbove relativeTo:below];
    below = entry.window.windowNumber;
  }
}

static void Animate(void) {
  [animation invalidate];
  animation = nil;
  if (!docked.count) {
    carousel = NO;
    PlaceCaption();
    return;
  }
  if (carousel && docked.count < 2) carousel = NO;
  selected = MIN(MAX(selected, 0), (NSInteger)docked.count - 1);
  for (MistyDockEntry *entry in docked) {
    entry.from = entry.window.frame;
    entry.fromDim = entry.overlay.dim;
  }
  if (carousel) LayoutCarousel(); else LayoutStack();
  Restack();
  PlaceCaption();
  if (ReduceMotion()) {
    for (MistyDockEntry *entry in docked) ApplyFrame(entry, entry.to, entry.toDim);
    return;
  }
  animationStart = CACurrentMediaTime();
  animation = [NSTimer timerWithTimeInterval:1.0 / 60 repeats:YES block:^(NSTimer *timer) {
    CGFloat progress = MIN(1, (CACurrentMediaTime() - animationStart) / AnimationSeconds);
    CGFloat k = 1 - pow(1 - progress, 3);
    for (MistyDockEntry *entry in [docked copy]) {
      NSRect a = entry.from, b = entry.to;
      NSRect frame = NSMakeRect(a.origin.x + (b.origin.x - a.origin.x) * k, a.origin.y + (b.origin.y - a.origin.y) * k,
                                a.size.width + (b.size.width - a.size.width) * k, a.size.height + (b.size.height - a.size.height) * k);
      ApplyFrame(entry, NSIntegralRect(frame), entry.fromDim + (entry.toDim - entry.fromDim) * k);
    }
    if (progress >= 1) {
      [timer invalidate];
      if (animation == timer) animation = nil;
    }
  }];
  [NSRunLoop.mainRunLoop addTimer:animation forMode:NSRunLoopCommonModes];
}

static void Select(NSInteger index) {
  if (index < 0 || index >= (NSInteger)docked.count) return;
  selected = index;
  Animate();
}

static void ShowCarousel(BOOL show) {
  carousel = show && docked.count > 1;
  if (carousel) {
    // A click elsewhere, in Misty or another app, folds the carousel.
    if (!outsideMonitor)
      outsideMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown handler:^(NSEvent *__unused event) {
        ShowCarousel(NO);
      }];
    if (!localOutsideMonitor)
      localOutsideMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown handler:^NSEvent *(NSEvent *event) {
        BOOL dock = event.window == caption.panel;
        for (MistyDockEntry *entry in docked) dock = dock || event.window == entry.window;
        if (!dock) ShowCarousel(NO);
        return event;
      }];
  } else {
    if (outsideMonitor) [NSEvent removeMonitor:outsideMonitor];
    if (localOutsideMonitor) [NSEvent removeMonitor:localOutsideMonitor];
    outsideMonitor = localOutsideMonitor = nil;
    // The chosen window comes to the front of the stack.
    if (selected > 0 && selected < (NSInteger)docked.count) {
      MistyDockEntry *chosen = docked[(NSUInteger)selected];
      [docked removeObjectAtIndex:(NSUInteger)selected];
      [docked insertObject:chosen atIndex:0];
    }
    selected = 0;
  }
  Animate();
}

#pragma mark - Docking

// Pages are moved into one full-size container, so the content view's bounds
// can be scaled without the webviews resizing. wry positions child webviews
// from their superview's frame height, which is the container's full height.
static void Adopt(MistyDockEntry *entry) {
  NSWindow *window = entry.window;
  NSView *content = window.contentView;
  if (!content) return;
  if (!entry.container || entry.container.superview != content) {
    entry.container = [[NSView alloc] initWithFrame:content.bounds];
    entry.container.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [content addSubview:entry.container positioned:NSWindowBelow relativeTo:nil];
  }
  NSResponder *responder = window.firstResponder;
  CGFloat frameHeight = content.frame.size.height, fullHeight = entry.container.frame.size.height;
  for (NSView *view in [content.subviews copy]) {
    if (view == entry.container || view == entry.overlay || view == entry.mist) continue;
    NSRect frame = view.frame;
    // Added while docked: wry placed it against the small frame height.
    if (entry.docked) {
      CGFloat top = frameHeight - NSMaxY(frame);
      frame.origin.y = fullHeight - top - frame.size.height;
    }
    [view removeFromSuperview];
    [entry.container addSubview:view positioned:NSWindowAbove relativeTo:nil];
    view.frame = frame;
  }
  if (entry.mist) [content addSubview:entry.mist positioned:NSWindowAbove relativeTo:nil];
  if (entry.overlay) [content addSubview:entry.overlay positioned:NSWindowAbove relativeTo:nil];
  if (responder && responder != window.firstResponder) [window makeFirstResponder:responder];
}

static void AdoptLater(void) {
  if (adoption) return;
  adoption = [NSTimer timerWithTimeInterval:0.2 repeats:YES block:^(NSTimer *timer) {
    if (!docked.count) {
      [timer invalidate];
      adoption = nil;
      return;
    }
    for (MistyDockEntry *entry in docked)
      for (NSView *view in entry.window.contentView.subviews)
        if (view != entry.container && view != entry.overlay && view != entry.mist) {
          Adopt(entry);
          SetOcclusionDetection(entry.container, NO);
          break;
        }
  }];
  [NSRunLoop.mainRunLoop addTimer:adoption forMode:NSRunLoopCommonModes];
}

// While Misty is hidden or its window minimized, docked windows stay on screen
// but transparent and click-through: out of sight, still painting.
static void Vanish(BOOL gone) {
  for (MistyDockEntry *entry in docked) {
    NSWindow *window = entry.window;
    if (gone && window.parentWindow) [window.parentWindow removeChildWindow:window];
    if (!gone && parentWindow && !window.parentWindow) [parentWindow addChildWindow:window ordered:NSWindowAbove];
    window.alphaValue = gone ? 0 : 1;
    window.ignoresMouseEvents = gone;
  }
  if (gone && carousel) ShowCarousel(NO);
  if (!gone) Animate();
}

static void WatchApp(void) {
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center addObserverForName:NSApplicationWillHideNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *__unused note) {
    Vanish(YES);
  }];
  [center addObserverForName:NSApplicationDidUnhideNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *__unused note) {
    Vanish(NO);
  }];
  [center addObserverForName:NSWindowWillMiniaturizeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    if (note.object == parentWindow) Vanish(YES);
  }];
  [center addObserverForName:NSWindowDidDeminiaturizeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    if (note.object == parentWindow) Vanish(NO);
  }];
  // The stack keeps its corner as Misty's window resizes.
  [center addObserverForName:NSWindowDidResizeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    if (note.object == parentWindow && docked.count) Animate();
  }];
}

static void Setup(void) {
  if (allEntries) return;
  WatchApp();
  allEntries = [NSMutableArray array];
  docked = [NSMutableArray array];
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidChangeScreenParametersNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *__unused note) {
    Animate();
  }];
}

static void Dock(MistyDockEntry *entry) {
  NSWindow *window = entry.window;
  if (window.isMiniaturized) [window deminiaturize:nil];
  entry.savedFrame = window.frame;
  entry.savedMask = window.styleMask;
  entry.savedLevel = window.level;
  entry.savedBehavior = window.collectionBehavior;
  entry.savedMinSize = window.contentMinSize;
  entry.savedCanHide = window.canHide;
  entry.savedExcluded = window.excludedFromWindowsMenu;
  entry.savedTransparentTitlebar = window.titlebarAppearsTransparent;
  entry.savedTitleVisibility = window.titleVisibility;
  // Content fills the window, no title bar or buttons; it rides on Misty's
  // window and stays on screen through Hide Misty (Vanish hides it instead).
  window.styleMask = entry.savedMask | NSWindowStyleMaskFullSizeContentView;
  window.titlebarAppearsTransparent = YES;
  window.titleVisibility = NSWindowTitleHidden;
  for (NSNumber *button in @[@(NSWindowCloseButton), @(NSWindowMiniaturizeButton), @(NSWindowZoomButton)])
    [window standardWindowButton:button.unsignedIntegerValue].hidden = YES;
  window.contentMinSize = NSMakeSize(1, 1);
  window.collectionBehavior = NSWindowCollectionBehaviorIgnoresCycle;
  window.canHide = NO;
  if (parentWindow) [parentWindow addChildWindow:window ordered:NSWindowAbove];
  window.excludedFromWindowsMenu = YES;
  Adopt(entry);
  entry.full = window.contentView.bounds.size;
  entry.container.autoresizingMask = NSViewNotSizable;
  if (!entry.mist) entry.mist = MistyAgentMistMake(NSMakeRect(0, 0, entry.full.width, entry.full.height), 10);
  entry.mist.frame = NSMakeRect(0, 0, entry.full.width, entry.full.height);
  [window.contentView addSubview:entry.mist positioned:NSWindowAbove relativeTo:nil];
  if (!entry.overlay) entry.overlay = [[MistyDockOverlay alloc] initWithEntry:entry];
  [window.contentView addSubview:entry.overlay positioned:NSWindowAbove relativeTo:nil];
  entry.docked = YES;
  SetOcclusionDetection(entry.container, NO);
  entry.overlay.dim = 0;
  [entry.overlay sync:0];
  [docked insertObject:entry atIndex:0];
  if (!window.isVisible) [window orderWindow:NSWindowAbove relativeTo:parentWindow.windowNumber];
  AdoptLater();
}

static void Release(MistyDockEntry *entry) {
  [docked removeObject:entry];
  entry.docked = NO;
  // Opened at full size, the agent may still be working: the page keeps
  // ignoring cover until it returns to the person's window.
  [entry.overlay removeFromSuperview];
  [entry.mist removeFromSuperview];
}

static void Restore(MistyDockEntry *entry) {
  NSWindow *window = entry.window;
  if (!window) return;
  if (window.parentWindow) [window.parentWindow removeChildWindow:window];
  window.level = entry.savedLevel;
  window.collectionBehavior = entry.savedBehavior;
  window.canHide = entry.savedCanHide;
  window.excludedFromWindowsMenu = entry.savedExcluded;
  window.styleMask = entry.savedMask;
  window.titlebarAppearsTransparent = entry.savedTransparentTitlebar;
  window.titleVisibility = entry.savedTitleVisibility;
  for (NSNumber *button in @[@(NSWindowCloseButton), @(NSWindowMiniaturizeButton), @(NSWindowZoomButton)])
    [window standardWindowButton:button.unsignedIntegerValue].hidden = NO;
  NSRect target = entry.savedFrame;
  BOOL onScreen = NO;
  for (NSScreen *screen in NSScreen.screens) onScreen = onScreen || NSIntersectsRect(target, screen.visibleFrame);
  if (!onScreen) {
    NSRect visible = (NSScreen.mainScreen ?: NSScreen.screens.firstObject).visibleFrame;
    target.origin = NSMakePoint(NSMidX(visible) - target.size.width / 2, NSMidY(visible) - target.size.height / 2);
  }
  [window setFrame:target display:YES animate:NO];
  NSView *content = window.contentView;
  [content setBoundsOrigin:NSZeroPoint];
  [content setBoundsSize:content.frame.size];
  entry.container.frame = content.bounds;
  entry.container.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  window.contentMinSize = entry.savedMinSize;
}

static void OpenEntry(MistyDockEntry *entry) {
  if (!entry.docked) return;
  BOOL wasCarousel = carousel;
  Release(entry);
  if (wasCarousel) {
    carousel = NO;
    if (outsideMonitor) [NSEvent removeMonitor:outsideMonitor];
    if (localOutsideMonitor) [NSEvent removeMonitor:localOutsideMonitor];
    outsideMonitor = localOutsideMonitor = nil;
    selected = 0;
  }
  Restore(entry);
  [NSApp activateIgnoringOtherApps:YES];
  [entry.window makeKeyAndOrderFront:nil];
  Emit(@"opened", entry);
  Animate();
}

#pragma mark - Exports

void misty_agent_dock_init(MistyDockCallback callback) { dockCallback = callback; }

/// Docks a window into Misty's window (`parent`), or brings an already docked
/// one to the front of the stack.
bool misty_agent_dock_add(void *pointer, const char *identifier, const char *name, void *parent) {
  @autoreleasepool {
    NSWindow *window = (__bridge NSWindow *)pointer;
    if (!window || !identifier) return false;
    Setup();
    if (parent) parentWindow = (__bridge NSWindow *)parent;
    NSString *key = @(identifier);
    MistyDockEntry *entry = EntryFor(key);
    if (!entry) {
      entry = [MistyDockEntry new];
      entry.identifier = key;
      [allEntries addObject:entry];
    }
    entry.window = window;
    if (name) entry.name = @(name);
    if (entry.docked) {
      [docked removeObject:entry];
      [docked insertObject:entry atIndex:0];
    } else {
      Dock(entry);
    }
    if (carousel) {
      selected = 0;
      ShowCarousel(NO);
    } else {
      Animate();
    }
    Emit(@"docked", entry);
    return true;
  }
}

void misty_agent_dock_open(const char *identifier) {
  MistyDockEntry *entry = identifier ? EntryFor(@(identifier)) : nil;
  if (entry) OpenEntry(entry);
}

bool misty_agent_dock_is_docked(const char *identifier) {
  MistyDockEntry *entry = identifier ? EntryFor(@(identifier)) : nil;
  return entry.docked;
}

/// The window is closing: drop it without restoring anything.
void misty_agent_dock_forget(const char *identifier) {
  MistyDockEntry *entry = identifier ? EntryFor(@(identifier)) : nil;
  if (!entry) return;
  BOOL wasDocked = entry.docked;
  Release(entry);
  [allEntries removeObject:entry];
  if (wasDocked) Animate();
}

void misty_agent_dock_status(const char *identifier, const char *status, bool waiting) {
  MistyDockEntry *entry = identifier ? EntryFor(@(identifier)) : nil;
  if (!entry) return;
  BOOL started = waiting && !entry.waiting;
  entry.status = status ? @(status) : @"";
  entry.waiting = waiting;
  // An agent that needs the person moves to the front of the stack.
  if (started && entry.docked && !carousel && docked.firstObject != entry) {
    [docked removeObject:entry];
    [docked insertObject:entry atIndex:0];
    Animate();
    return;
  }
  [entry.overlay sync:entry.overlay.dim];
  if (carousel && selected < (NSInteger)docked.count && docked[(NSUInteger)selected] == entry) [caption updateFor:entry];
}

/// A page moved into a dock host fills the host below its bar and follows its size.
void misty_agent_dock_fill(void *pointer, double top) {
  NSView *view = (__bridge NSView *)pointer;
  NSView *parent = view.superview;
  if (!parent) return;
  NSRect bounds = parent.bounds;
  view.frame = NSMakeRect(0, 0, bounds.size.width, MAX(0, bounds.size.height - top));
  view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  view.hidden = NO;
}

/// Whether macOS reports each docked window as visible (WebKit keeps painting it).
char *misty_agent_dock_visibility(void) {
  NSMutableArray *rows = [NSMutableArray array];
  for (MistyDockEntry *entry in allEntries)
    [rows addObject:@{@"id": entry.identifier, @"docked": @(entry.docked),
                      @"visible": @((entry.window.occlusionState & NSWindowOcclusionStateVisible) != 0),
                      @"contentWidth": @(entry.full.width), @"contentHeight": @(entry.full.height),
                      @"screenWidth": @(entry.window.frame.size.width)}];
  NSData *data = [NSJSONSerialization dataWithJSONObject:rows options:0 error:nil];
  return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}

/// Fans the stack out into the carousel, or folds it.
void misty_agent_dock_carousel(bool show) {
  if (!docked) return;
  selected = 0;
  ShowCarousel(show);
}

/// For the dock check: hide or minimize Misty from inside the app.
void misty_agent_dock_test_app(const char *action) {
  NSString *name = action ? @(action) : @"";
  if ([name isEqualToString:@"hide"]) [NSApp hide:nil];
  else if ([name isEqualToString:@"unhide"]) [NSApp unhideWithoutActivation];
  else if ([name isEqualToString:@"minimize"]) [parentWindow ?: NSApp.mainWindow miniaturize:nil];
  else if ([name isEqualToString:@"unminimize"]) [parentWindow deminiaturize:nil];
}

/// A detached tab came back to the person's window: WebKit may throttle it
/// again when that window is covered, like any other tab.
void misty_agent_dock_page_returned(void *pointer) {
  NSView *view = (__bridge NSView *)pointer;
  if (view) SetOcclusionDetection(view, YES);
}

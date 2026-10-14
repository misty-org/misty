#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import "MistyAgentRing.h"

// One mist view for the display, a page and a window. Two inner fogs: a bright
// one close to the edge and a wide pale-gray one that still reads on white
// pages. Each is the shadow of a shape that lies entirely outside the bounds,
// so only the shadow falls inward; the view clips to its own rounded corners.
@interface MistyAgentMistView : NSView
@property(nonatomic, strong) CAShapeLayer *near;
@property(nonatomic, strong) CAShapeLayer *wide;
// Set for a window or the display; a page mist follows its page's own corners.
@property(nonatomic, strong) NSNumber *radius;
- (void)build;
- (void)fit;
@end

static NSHashTable<MistyAgentMistView *> *mists;
static BOOL mistWaiting;
static const CGFloat mistActingAlpha = 1, mistWaitingAlpha = 0.4;

static CAShapeLayer *fogLayer(CGFloat white, float opacity, CGFloat blur) {
  CAShapeLayer *fog = [CAShapeLayer layer];
  fog.fillRule = kCAFillRuleEvenOdd;
  fog.fillColor = [NSColor colorWithWhite:white alpha:1].CGColor;
  fog.shadowColor = fog.fillColor;
  fog.shadowOpacity = opacity;
  fog.shadowRadius = blur;
  fog.shadowOffset = CGSizeZero;
  return fog;
}

static void breathe(CALayer *layer, NSString *key, id from, id to, CFTimeInterval duration) {
  CABasicAnimation *animation = [CABasicAnimation animationWithKeyPath:key];
  animation.fromValue = from;
  animation.toValue = to;
  animation.duration = duration;
  animation.autoreverses = YES;
  animation.repeatCount = HUGE_VALF;
  animation.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
  [layer addAnimation:animation forKey:key];
}

@implementation MistyAgentMistView
- (NSView *)hitTest:(NSPoint)point { (void)point; return nil; }
- (BOOL)isFlipped { return YES; }
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  [self fit];
}
- (void)build {
  self.wantsLayer = YES;
  self.layer.masksToBounds = YES;
  self.near = fogLayer(1, 0.55, 18);
  self.wide = fogLayer(0.62, 0.22, 46);
  [self.layer addSublayer:self.wide];
  [self.layer addSublayer:self.near];
  if (!mists) mists = [NSHashTable weakObjectsHashTable];
  [mists addObject:self];
  self.alphaValue = mistWaiting ? mistWaitingAlpha : mistActingAlpha;
  // Breathes and drifts while an agent acts; still under Reduce motion.
  if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) return;
  breathe(self.near, @"shadowOpacity", @0.45, @0.65, 3.5);
  breathe(self.near, @"shadowRadius", @16, @22, 3.5);
  breathe(self.wide, @"shadowOffset", [NSValue valueWithSize:NSMakeSize(5, -3)], [NSValue valueWithSize:NSMakeSize(-5, 3)], 14);
}
- (void)fit {
  if (!self.near) return;
  CGFloat radius = self.radius ? self.radius.doubleValue : self.superview.layer.cornerRadius;
  CACornerMask corners = self.radius ? (kCALayerMinXMinYCorner | kCALayerMaxXMinYCorner |
    kCALayerMinXMaxYCorner | kCALayerMaxXMaxYCorner) : self.superview.layer.maskedCorners;
  CGRect bounds = CGRectMake(0, 0, self.bounds.size.width, self.bounds.size.height);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.layer.cornerRadius = radius;
  self.layer.maskedCorners = corners;
  for (CAShapeLayer *fog in @[self.near, self.wide]) {
    // The frame around the bounds, wide enough that its blur never shows a seam.
    CGMutablePathRef path = CGPathCreateMutable();
    CGPathAddRect(path, NULL, CGRectInset(bounds, -fog.shadowRadius * 4, -fog.shadowRadius * 4));
    CGFloat corner = MIN(radius, MIN(bounds.size.width, bounds.size.height) / 2);
    CGPathAddRoundedRect(path, NULL, bounds, corner, corner);
    fog.frame = bounds;
    fog.path = path;
    fog.shadowPath = path;
    CGPathRelease(path);
  }
  [CATransaction commit];
}
@end

static MistyAgentMistView *mistIn(NSView *host, NSNumber *radius) {
  MistyAgentMistView *mist = [[MistyAgentMistView alloc] initWithFrame:host.bounds];
  mist.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  mist.radius = radius;
  [mist build];
  [host addSubview:mist positioned:NSWindowAbove relativeTo:nil];
  [mist fit];
  return mist;
}

NSView *MistyAgentMistMake(NSRect frame, CGFloat radius) {
  MistyAgentMistView *mist = [[MistyAgentMistView alloc] initWithFrame:frame];
  mist.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  mist.radius = @(radius);
  [mist build];
  [mist fit];
  return mist;
}

void MistyAgentMistSetWaiting(NSView *mist, BOOL waiting) {
  mist.alphaValue = waiting ? mistWaitingAlpha : mistActingAlpha;
}

// Fades a mist's container in; the mist view itself keeps its waiting alpha.
static void fadeIn(id target, CGFloat alpha) {
  [target setAlphaValue:0];
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    context.duration = 0.2;
    [[target animator] setAlphaValue:alpha];
  }];
}

static NSPanel *ringPanel(NSRect frame) {
  NSPanel *panel = [[NSPanel alloc] initWithContentRect:frame
    styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
  panel.title = MistyAgentRingTitle;
  panel.level = NSStatusWindowLevel;
  panel.opaque = NO;
  panel.backgroundColor = NSColor.clearColor;
  panel.hasShadow = NO;
  panel.ignoresMouseEvents = YES;
  panel.hidesOnDeactivate = NO;
  panel.sharingType = NSWindowSharingNone;
  panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorStationary |
    NSWindowCollectionBehaviorIgnoresCycle;
  NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
  view.wantsLayer = YES;
  panel.contentView = view;
  return panel;
}

// Global top-left display coordinates to a Cocoa frame.
static NSRect cocoaRect(CGRect rect) {
  CGFloat top = CGDisplayBounds(CGMainDisplayID()).size.height;
  return NSMakeRect(rect.origin.x, top - CGRectGetMaxY(rect), rect.size.width, rect.size.height);
}

static void onMain(void (^work)(void)) {
  if (NSThread.isMainThread) work(); else dispatch_async(dispatch_get_main_queue(), work);
}

static NSPanel *framePanel, *pulsePanel;
static const CGFloat pulseSize = 44;

static NSRect pulseFrame(CGPoint point) {
  return cocoaRect(CGRectMake(point.x - pulseSize / 2, point.y - pulseSize / 2, pulseSize, pulseSize));
}

// Made with the frame, before capture starts, so the stream can leave it out.
static void makePulsePanel(CGPoint point) {
  pulsePanel = ringPanel(pulseFrame(point));
  CALayer *ring = [CALayer layer];
  ring.frame = CGRectInset(pulsePanel.contentView.layer.bounds, 4, 4);
  ring.cornerRadius = ring.frame.size.width / 2;
  ring.borderWidth = 2;
  ring.borderColor = [NSColor colorWithWhite:1 alpha:0.95].CGColor;
  ring.shadowColor = [NSColor colorWithWhite:0.07 alpha:1].CGColor;
  ring.shadowOpacity = 0.6;
  ring.shadowRadius = 1.5;
  ring.shadowOffset = CGSizeZero;
  ring.opacity = 0;
  [pulsePanel.contentView.layer addSublayer:ring];
  [pulsePanel orderFrontRegardless];
}

void misty_agent_ring_show(CGRect display) {
  onMain(^{
    NSRect frame = cocoaRect(display);
    BOOL fresh = !framePanel;
    if (fresh) {
      framePanel = ringPanel(frame);
      mistIn(framePanel.contentView, @0);
    }
    [framePanel setFrame:frame display:YES];
    [framePanel orderFrontRegardless];
    if (!pulsePanel) makePulsePanel(CGPointMake(CGRectGetMidX(display), CGRectGetMidY(display)));
    if (fresh) fadeIn(framePanel, 1);
  });
}

void misty_agent_ring_pulse(CGPoint point) {
  onMain(^{
    if (!pulsePanel) makePulsePanel(point);
    [pulsePanel setFrame:pulseFrame(point) display:YES];
    [pulsePanel orderFrontRegardless];
    CALayer *ring = pulsePanel.contentView.layer.sublayers.firstObject;
    [ring removeAllAnimations];
    if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
      ring.opacity = 0;
      return;
    }
    CABasicAnimation *scale = [CABasicAnimation animationWithKeyPath:@"transform.scale"];
    scale.fromValue = @0.55; scale.toValue = @1.2;
    CABasicAnimation *fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
    fade.fromValue = @1; fade.toValue = @0;
    CAAnimationGroup *pulse = [CAAnimationGroup animation];
    pulse.animations = @[scale, fade];
    pulse.duration = 0.7;
    pulse.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.16 :1 :0.3 :1];
    ring.opacity = 0;
    [ring addAnimation:pulse forKey:@"pulse"];
  });
}

void misty_agent_ring_hide(void) {
  onMain(^{
    [framePanel orderOut:nil]; framePanel = nil;
    [pulsePanel orderOut:nil]; pulsePanel = nil;
  });
}

void misty_agent_page_ring(void *view, bool active) {
  NSView *page = (__bridge NSView *)view;
  onMain(^{
    MistyAgentMistView *mist = nil;
    for (NSView *subview in page.subviews)
      if ([subview isKindOfClass:MistyAgentMistView.class]) mist = (MistyAgentMistView *)subview;
    if (!active) {
      [mist removeFromSuperview];
      return;
    }
    if (!mist) fadeIn(mistIn(page, nil), mistWaiting ? mistWaitingAlpha : mistActingAlpha);
    else [mist fit];
  });
}

static NSPanel *windowRingPanel;
static MistyAgentMistView *windowMist;
static id windowRingObserver;

// The window's own corner radius, which varies by macOS version and style.
static CGFloat windowCornerRadius(NSWindow *window) {
  if (window.styleMask & NSWindowStyleMaskFullScreen) return 0;
  SEL selector = NSSelectorFromString(@"_cornerRadius");
  if (![window respondsToSelector:selector]) return 10;
  return ((CGFloat (*)(id, SEL))objc_msgSend)(window, selector);
}

static void fitWindowRing(NSWindow *window) {
  [windowRingPanel setFrame:window.frame display:YES];
  windowMist.radius = @(windowCornerRadius(window));
  [windowMist fit];
}

void misty_agent_window_ring(void *view, bool active) {
  NSView *anchor = (__bridge NSView *)view;
  onMain(^{
    NSWindow *window = anchor.window;
    if (!active || !window) {
      if (windowRingObserver) [NSNotificationCenter.defaultCenter removeObserver:windowRingObserver];
      windowRingObserver = nil;
      [windowRingPanel.parentWindow removeChildWindow:windowRingPanel];
      [windowRingPanel orderOut:nil];
      windowRingPanel = nil;
      windowMist = nil;
      return;
    }
    if (windowRingPanel.parentWindow == window) {
      fitWindowRing(window);
      return;
    }
    if (windowRingPanel) misty_agent_window_ring(view, false);
    windowRingPanel = ringPanel(window.frame);
    // Above the window it covers, not above other apps.
    windowRingPanel.level = window.level;
    windowRingPanel.collectionBehavior = NSWindowCollectionBehaviorFullScreenAuxiliary |
      NSWindowCollectionBehaviorIgnoresCycle;
    windowMist = mistIn(windowRingPanel.contentView, @(windowCornerRadius(window)));
    [window addChildWindow:windowRingPanel ordered:NSWindowAbove];
    fitWindowRing(window);
    __weak NSWindow *weakWindow = window;
    windowRingObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:NSWindowDidResizeNotification object:window queue:NSOperationQueue.mainQueue
      usingBlock:^(NSNotification *note) {
        (void)note;
        if (weakWindow) fitWindowRing(weakWindow);
      }];
    fadeIn(windowRingPanel.contentView, 1);
  });
}

void misty_agent_mist_waiting(bool waiting) {
  onMain(^{
    mistWaiting = waiting;
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
      context.duration = 0.3;
      for (MistyAgentMistView *mist in mists.allObjects)
        mist.animator.alphaValue = waiting ? mistWaitingAlpha : mistActingAlpha;
    }];
  });
}

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import "MistyAgentRing.h"

@interface MistyAgentRingView : NSView
@end
@implementation MistyAgentRingView
- (NSView *)hitTest:(NSPoint)point { (void)point; return nil; }
@end

static NSPanel *framePanel, *pulsePanel;
static CALayer *frameGlow, *frameHairline;
static const CGFloat pulseSize = 44;

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
  panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorStationary |
    NSWindowCollectionBehaviorIgnoresCycle;
  MistyAgentRingView *view = [[MistyAgentRingView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
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
    if (!framePanel) {
      framePanel = ringPanel(frame);
      CALayer *layer = framePanel.contentView.layer;
      // Monochrome: a bright inner line, a dark hairline for light content and a soft glow.
      CALayer *glow = frameGlow = [CALayer layer];
      glow.borderWidth = 3;
      glow.borderColor = [NSColor colorWithWhite:1 alpha:0.9].CGColor;
      glow.shadowColor = NSColor.whiteColor.CGColor;
      glow.shadowOpacity = 0.55;
      glow.shadowRadius = 10;
      glow.shadowOffset = CGSizeZero;
      CALayer *hairline = frameHairline = [CALayer layer];
      hairline.borderWidth = 1;
      hairline.borderColor = [NSColor colorWithWhite:0.07 alpha:0.5].CGColor;
      [layer addSublayer:glow];
      [layer addSublayer:hairline];
      framePanel.alphaValue = 0;
    }
    [framePanel setFrame:frame display:YES];
    CGRect bounds = CGRectMake(0, 0, frame.size.width, frame.size.height);
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    frameGlow.frame = CGRectInset(bounds, 2, 2);
    frameHairline.frame = bounds;
    [CATransaction commit];
    [framePanel orderFrontRegardless];
    if (!pulsePanel) makePulsePanel(CGPointMake(CGRectGetMidX(display), CGRectGetMidY(display)));
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
      context.duration = 0.2;
      framePanel.animator.alphaValue = 1;
    }];
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
    [framePanel orderOut:nil]; framePanel = nil; frameGlow = frameHairline = nil;
    [pulsePanel orderOut:nil]; pulsePanel = nil;
  });
}

@interface MistyAgentPageRingView : NSView
@property(nonatomic, strong) CALayer *glow;
@property(nonatomic, strong) CALayer *hairline;
// Set for a window ring; a page ring follows its page's own corners.
@property(nonatomic, strong) NSNumber *radius;
- (void)build;
- (void)fitWithRadius:(CGFloat)radius;
@end
@implementation MistyAgentPageRingView
- (NSView *)hitTest:(NSPoint)point { (void)point; return nil; }
- (BOOL)isFlipped { return YES; }
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  if (self.radius) [self fitWithRadius:self.radius.doubleValue];
  else [self fit];
}
// Monochrome, as on the desktop: a bright line with a soft inner glow that
// breathes, and a dark hairline so it still reads on white pages.
- (void)build {
  self.wantsLayer = YES;
  CALayer *glow = self.glow = [CALayer layer];
  glow.borderWidth = 3;
  glow.borderColor = [NSColor colorWithWhite:1 alpha:0.9].CGColor;
  glow.shadowColor = NSColor.whiteColor.CGColor;
  glow.shadowOpacity = 0.6;
  glow.shadowRadius = 12;
  glow.shadowOffset = CGSizeZero;
  CALayer *hairline = self.hairline = [CALayer layer];
  hairline.borderWidth = 1;
  hairline.borderColor = [NSColor colorWithWhite:0.07 alpha:0.5].CGColor;
  [self.layer addSublayer:glow];
  [self.layer addSublayer:hairline];
  if (!NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
    CABasicAnimation *breathe = [CABasicAnimation animationWithKeyPath:@"shadowOpacity"];
    breathe.fromValue = @0.3;
    breathe.toValue = @0.75;
    breathe.duration = 1.6;
    breathe.autoreverses = YES;
    breathe.repeatCount = HUGE_VALF;
    breathe.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
    [glow addAnimation:breathe forKey:@"breathe"];
  }
}
// Inside the page's rounded corner mask the ring follows the same corners.
- (void)fit {
  CALayer *page = self.superview.layer;
  [self fitBounds:page.cornerRadius corners:page.maskedCorners];
}
- (void)fitWithRadius:(CGFloat)radius {
  self.radius = @(radius);
  [self fitBounds:radius corners:kCALayerMinXMinYCorner | kCALayerMaxXMinYCorner |
    kCALayerMinXMaxYCorner | kCALayerMaxXMaxYCorner];
}
- (void)fitBounds:(CGFloat)radius corners:(CACornerMask)corners {
  CGRect bounds = CGRectMake(0, 0, self.bounds.size.width, self.bounds.size.height);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  for (CALayer *layer in @[self.glow, self.hairline]) {
    CGFloat inset = layer == self.glow ? 1 : 0;
    layer.frame = CGRectInset(bounds, inset, inset);
    layer.cornerRadius = MAX(0, radius - inset);
    layer.maskedCorners = corners;
  }
  [CATransaction commit];
}
@end

void misty_agent_page_ring(void *view, bool active) {
  NSView *page = (__bridge NSView *)view;
  onMain(^{
    MistyAgentPageRingView *ring = nil;
    for (NSView *subview in page.subviews)
      if ([subview isKindOfClass:MistyAgentPageRingView.class]) ring = (MistyAgentPageRingView *)subview;
    if (!active) {
      [ring removeFromSuperview];
      return;
    }
    if (!ring) {
      ring = [[MistyAgentPageRingView alloc] initWithFrame:page.bounds];
      ring.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [ring build];
      ring.alphaValue = 0;
      [page addSubview:ring positioned:NSWindowAbove relativeTo:nil];
      [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0.2;
        ring.animator.alphaValue = 1;
      }];
    }
    [ring fit];
  });
}

static NSPanel *windowRingPanel;
static MistyAgentPageRingView *windowRingView;
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
  CGFloat radius = windowCornerRadius(window);
  CALayer *base = windowRingView.layer;
  base.cornerRadius = radius;
  base.maskedCorners = kCALayerMinXMinYCorner | kCALayerMaxXMinYCorner |
    kCALayerMinXMaxYCorner | kCALayerMaxXMaxYCorner;
  base.masksToBounds = YES;
  [windowRingView fitWithRadius:radius];
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
      windowRingView = nil;
      return;
    }
    if (windowRingPanel.parentWindow == window) {
      fitWindowRing(window);
      return;
    }
    if (windowRingPanel) misty_agent_window_ring(view, false);
    windowRingPanel = ringPanel(window.frame);
    // Above the window it rings, not above other apps.
    windowRingPanel.level = window.level;
    windowRingPanel.collectionBehavior = NSWindowCollectionBehaviorFullScreenAuxiliary |
      NSWindowCollectionBehaviorIgnoresCycle;
    windowRingView = [[MistyAgentPageRingView alloc] initWithFrame:windowRingPanel.contentView.bounds];
    windowRingView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [windowRingView build];
    [windowRingPanel.contentView addSubview:windowRingView];
    [window addChildWindow:windowRingPanel ordered:NSWindowAbove];
    fitWindowRing(window);
    __weak NSWindow *weakWindow = window;
    windowRingObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:NSWindowDidResizeNotification object:window queue:NSOperationQueue.mainQueue
      usingBlock:^(NSNotification *note) {
        (void)note;
        if (weakWindow) fitWindowRing(weakWindow);
      }];
    windowRingPanel.alphaValue = 0;
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
      context.duration = 0.2;
      windowRingPanel.animator.alphaValue = 1;
    }];
  });
}

#import <AppKit/AppKit.h>
#import <objc/message.h>
#import "MistyAgentRingInternal.h"

// The mist inside a whole Misty window while an agent controls it.
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
  MistyAgentRingOnMain(^{
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
    windowRingPanel = MistyAgentRingPanel(window.frame);
    // Above the window it covers, not above other apps.
    windowRingPanel.level = window.level;
    windowRingPanel.collectionBehavior = NSWindowCollectionBehaviorFullScreenAuxiliary |
      NSWindowCollectionBehaviorIgnoresCycle;
    windowMist = MistyAgentMistIn(windowRingPanel.contentView, @(windowCornerRadius(window)));
    [window addChildWindow:windowRingPanel ordered:NSWindowAbove];
    fitWindowRing(window);
    __weak NSWindow *weakWindow = window;
    windowRingObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:NSWindowDidResizeNotification object:window queue:NSOperationQueue.mainQueue
      usingBlock:^(NSNotification *note) {
        (void)note;
        if (weakWindow) fitWindowRing(weakWindow);
      }];
    MistyAgentRingFadeIn(windowRingPanel.contentView, 1);
  });
}

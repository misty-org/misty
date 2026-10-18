// SPDX-License-Identifier: MIT
// Popup windows an extension opens for its own pages, as Firefox and Chrome do
// for windows.create({type: "popup"}): a small native window with the page and no
// browser chrome. The window and its single tab are real to the extension, so
// windows.update, windows.remove, tabs.query and messaging work as in Chrome.
#import "MistyExtensionsInternal.h"

static const CGFloat MinimumSide = 160, MaximumSide = 2400;

/// Popup pages may go to web and extension pages, as in Chrome; links meant for a
/// new window open as Misty tabs.
API_AVAILABLE(macos(15.4))
@interface MistyPopupWindowDelegate : NSObject <WKNavigationDelegate, WKUIDelegate>
@property (weak) MistyExtensionHost *host;
@end
@implementation MistyPopupWindowDelegate
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))done {
    NSString *scheme = action.request.URL.scheme.lowercaseString;
    done([@[@"http", @"https", @"webkit-extension", @"about", @"blob", @"data"] containsObject:scheme ?: @""] ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (WKWebView *)webView:(WKWebView *)view createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
    NSURL *url = action.request.URL;
    if ([@[@"http", @"https"] containsObject:url.scheme.lowercaseString ?: @""])
        [self.host event:@"open-tab" data:@{@"url":url.absoluteString, @"private":@NO}];
    return nil;
}
- (void)webViewDidClose:(WKWebView *)view { [view.window close]; }
@end
@implementation MistyExtensionHost (PopupWindows)
- (BOOL)openPopupWindow:(WKWebExtensionWindowConfiguration *)configuration context:(WKWebExtensionContext *)context done:(void (^)(id<WKWebExtensionWindow>, NSError *))done {
    if (configuration.windowType != WKWebExtensionWindowTypePopup || configuration.tabURLs.count != 1 || configuration.tabs.count) return NO;
    NSURL *url = configuration.tabURLs.firstObject;
    // Web pages keep opening in Misty's own windows; popups are for the extension's pages.
    if ([self.controller extensionContextForURL:url] != context) return NO;
    WKWebViewConfiguration *pageConfiguration = context.webViewConfiguration;
    if (!pageConfiguration) return NO;

    NSRect frame = configuration.frame;
    BOOL sized = frame.size.width > 0 && frame.size.height > 0 && !isnan(frame.size.width) && !isnan(frame.size.height);
    NSSize size = sized ? frame.size : NSMakeSize(400, 600);
    size.width = MIN(MAX(size.width, MinimumSide), MaximumSide);
    size.height = MIN(MAX(size.height, MinimumSide), MaximumSide);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
    NSWindow *native = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, size.width, size.height) styleMask:style backing:NSBackingStoreBuffered defer:NO];
    native.releasedWhenClosed = NO;
    native.title = context.webExtension.displayName ?: @"";
    // WebKit hands over an AppKit frame; one off every screen is centered instead.
    BOOL placed = sized && !isnan(frame.origin.x) && !isnan(frame.origin.y);
    if (placed) [native setFrame:NSMakeRect(frame.origin.x, frame.origin.y, size.width, size.height) display:NO];
    BOOL visible = NO;
    for (NSScreen *screen in NSScreen.screens) visible |= NSIntersectsRect(screen.visibleFrame, native.frame);
    if (!placed || !visible) [native center];

    WKWebView *view = [[WKWebView alloc] initWithFrame:native.contentView.bounds configuration:pageConfiguration];
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    // Each Space's host has its own delegate, so links open in that Space.
    MistyPopupWindowDelegate *delegate = self.popupWindowDelegate;
    if (!delegate) { delegate = [MistyPopupWindowDelegate new]; delegate.host = self; self.popupWindowDelegate = delegate; }
    view.navigationDelegate = delegate;
    view.UIDelegate = delegate;
    native.contentView = view;

    MistyExtensionWindow *window = [MistyExtensionWindow new];
    window.host = self;
    window.native = native;
    window.popupWindow = YES;
    window.privateWindow = configuration.shouldBePrivate;
    window.identifier = [@"extension-popup-" stringByAppendingString:NSUUID.UUID.UUIDString];
    MistyExtensionTab *tab = [MistyExtensionTab new];
    tab.identifier = [@"extension-popup-tab-" stringByAppendingString:NSUUID.UUID.UUIDString];
    tab.host = self;
    tab.window = window;
    tab.view = view;
    tab.selected = YES;
    tab.logicalURL = url;
    self.tabs[tab.identifier] = tab;
    self.windows[window.identifier] = window;
    // The tab holds its view weakly; the window owns it, and this list owns the window.
    [self.popupWindows addObject:native];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(popupWindowClosing:) name:NSWindowWillCloseNotification object:native];

    [self registerOpenTab:tab];
    [view loadRequest:[NSURLRequest requestWithURL:url]];
    if (configuration.shouldBeFocused) [native makeKeyAndOrderFront:nil];
    else [native orderFront:nil];
    done(window, nil);
    return YES;
}

- (void)popupWindowClosing:(NSNotification *)notification {
    NSWindow *native = notification.object;
    [[NSNotificationCenter defaultCenter] removeObserver:self name:NSWindowWillCloseNotification object:native];
    for (NSString *key in self.tabs.allKeys) {
        MistyExtensionTab *tab = self.tabs[key];
        if (tab.window.native != native || !tab.window.popupWindow) continue;
        MistyExtensionWindow *window = tab.window;
        [self.controller didCloseTab:tab windowIsClosing:YES];
        [self.controller didCloseWindow:window];
        [self.tabs removeObjectForKey:key];
        [self.windows removeObjectForKey:window.identifier];
    }
    [self.popupWindows removeObject:native];
}
@end

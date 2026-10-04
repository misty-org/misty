// SPDX-License-Identifier: MIT
// WebKit's view of Misty's browser tabs and windows.
#import "MistyExtensionsInternal.h"
#import <objc/message.h>

void MistySetPageMuted(WKWebView *view, BOOL muted) {
    SEL selector = NSSelectorFromString(@"_setPageMuted:");
    // _WKMediaAudioMuted is 1; 0 restores audio.
    if ([view respondsToSelector:selector]) ((void (*)(id, SEL, NSUInteger))objc_msgSend)(view, selector, muted ? 1 : 0);
}

@implementation MistyExtensionTab
- (id<WKWebExtensionWindow>)windowForWebExtensionContext:(WKWebExtensionContext *)context { return self.window; }
- (NSUInteger)indexInWindowForWebExtensionContext:(WKWebExtensionContext *)context { return [[self.window tabsForWebExtensionContext:context] indexOfObject:self]; }
- (id<WKWebExtensionTab>)parentTabForWebExtensionContext:(WKWebExtensionContext *)context { return self.parent.window ? self.parent : nil; }
- (void)setParentTab:(id<WKWebExtensionTab>)parent forWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done {
    self.parent = [(NSObject *)parent isKindOfClass:MistyExtensionTab.class] ? (MistyExtensionTab *)parent : nil; done(nil);
}
- (WKWebView *)webViewForWebExtensionContext:(WKWebExtensionContext *)context { return self.view; }
- (NSString *)titleForWebExtensionContext:(WKWebExtensionContext *)context { return self.view.title ?: self.logicalTitle; }
- (NSURL *)urlForWebExtensionContext:(WKWebExtensionContext *)context { return self.view.URL ?: self.logicalURL; }
- (BOOL)isLoadingCompleteForWebExtensionContext:(WKWebExtensionContext *)context { return !self.view.loading; }
- (BOOL)isSelectedForWebExtensionContext:(WKWebExtensionContext *)context { return self.selected; }
- (BOOL)isPlayingAudioForWebExtensionContext:(WKWebExtensionContext *)context { return self.audible; }
- (BOOL)isMutedForWebExtensionContext:(WKWebExtensionContext *)context { return self.muted; }
- (void)setMuted:(BOOL)muted forWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done {
    if (self.view) MistySetPageMuted(self.view, muted);
    self.muted = muted;
    // Misty's tab strip owns the visible mute state.
    [self.host event:@"tab-muted" data:@{@"tabId":self.identifier, @"muted":@(muted)}];
    [self.host.controller didChangeTabProperties:WKWebExtensionTabChangedPropertiesMuted forTab:self];
    done(nil);
}
- (CGSize)sizeForWebExtensionContext:(WKWebExtensionContext *)context { return self.view.bounds.size; }
- (double)zoomFactorForWebExtensionContext:(WKWebExtensionContext *)context { return self.view.pageZoom; }
- (void)setZoomFactor:(double)zoom forWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done { self.view.pageZoom = zoom; done(nil); }
- (void)detectWebpageLocaleForWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSLocale *, NSError *))done {
    if (!self.view) { done(nil, nil); return; }
    [self.view evaluateJavaScript:@"document.documentElement.lang || ''" inFrame:nil inContentWorld:WKContentWorld.defaultClientWorld completionHandler:^(id result, NSError *error) {
        (void)error;
        NSString *language = [result isKindOfClass:NSString.class] ? [(NSString *)result stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet] : @"";
        done(language.length && language.length < 36 ? [NSLocale localeWithLocaleIdentifier:language] : nil, nil);
    }];
}
- (void)reloadFromOrigin:(BOOL)origin forWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done { if (origin) [self.view reloadFromOrigin]; else [self.view reload]; done(nil); }
- (void)goBackForWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done { [self.view goBack]; done(nil); }
- (void)goForwardForWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done { [self.view goForward]; done(nil); }
- (void)loadURL:(NSURL *)url forWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done {
    if (![@[@"https", @"http", @"webkit-extension"] containsObject:url.scheme]) { done(ExtensionError(@"This URL cannot be opened by an extension.")); return; }
    [self.host event:@"navigate" data:@{@"tabId":self.identifier, @"url":url.absoluteString}]; done(nil);
}
- (void)activateForWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done { [self.host event:@"activate-tab" data:@{@"tabId":self.identifier}]; done(nil); }
- (void)duplicateUsingConfiguration:(WKWebExtensionTabConfiguration *)configuration forWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(id<WKWebExtensionTab>, NSError *))done {
    NSURL *url = [self urlForWebExtensionContext:context];
    NSDictionary *options = @{@"focused":@(configuration.shouldBeActive), @"index":@(self.position + 1)};
    [self.host openTabURL:url private:self.window.privateWindow options:options complete:^(MistyExtensionTab *tab, NSError *error) {
        tab.parent = self; done(tab, error);
    }];
}
- (void)closeForWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done { [self.host event:@"close-tab" data:@{@"tabId":self.identifier}]; done(nil); }
@end

@implementation MistyExtensionWindow
- (NSArray<id<WKWebExtensionTab>> *)tabsForWebExtensionContext:(WKWebExtensionContext *)context {
    NSMutableArray *result = [NSMutableArray array];
    for (MistyExtensionTab *tab in [self.host.tabs.allValues sortedArrayUsingComparator:^NSComparisonResult(MistyExtensionTab *a,MistyExtensionTab *b) { return a.position<b.position ? NSOrderedAscending : a.position>b.position ? NSOrderedDescending : NSOrderedSame; }]) {
        if (tab.window == self && (!self.privateWindow || context.hasAccessToPrivateData)) [result addObject:tab];
    }
    return result;
}
- (id<WKWebExtensionTab>)activeTabForWebExtensionContext:(WKWebExtensionContext *)context {
    for (MistyExtensionTab *tab in [self tabsForWebExtensionContext:context]) if (tab.selected) return tab;
    return nil;
}
- (WKWebExtensionWindowType)windowTypeForWebExtensionContext:(WKWebExtensionContext *)context { return WKWebExtensionWindowTypeNormal; }
- (WKWebExtensionWindowState)windowStateForWebExtensionContext:(WKWebExtensionContext *)context {
    NSWindow *window = self.native;
    if (window.miniaturized) return WKWebExtensionWindowStateMinimized;
    if (window.styleMask & NSWindowStyleMaskFullScreen) return WKWebExtensionWindowStateFullscreen;
    if (window.zoomed) return WKWebExtensionWindowStateMaximized;
    return WKWebExtensionWindowStateNormal;
}
- (void)setWindowState:(WKWebExtensionWindowState)state forWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done {
    NSWindow *window = self.native;
    if (!window) { done(ExtensionError(@"This window is not open.")); return; }
    BOOL fullscreen = (window.styleMask & NSWindowStyleMaskFullScreen) != 0;
    if (state != WKWebExtensionWindowStateMinimized && window.miniaturized) [window deminiaturize:nil];
    if ((state == WKWebExtensionWindowStateFullscreen) != fullscreen) [window toggleFullScreen:nil];
    if (state == WKWebExtensionWindowStateMinimized) [window miniaturize:nil];
    else if ((state == WKWebExtensionWindowStateMaximized) != window.zoomed && state != WKWebExtensionWindowStateFullscreen) [window zoom:nil];
    done(nil);
}
- (BOOL)isPrivateForWebExtensionContext:(WKWebExtensionContext *)context { return self.privateWindow; }
- (CGRect)frameForWebExtensionContext:(WKWebExtensionContext *)context { return self.native.frame; }
- (CGRect)screenFrameForWebExtensionContext:(WKWebExtensionContext *)context { return self.native.screen.frame; }
- (void)focusForWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done {
    if (self.identifier) [self.host event:@"focus-window" data:@{@"windowId":self.identifier}];
    [self.native makeKeyAndOrderFront:nil]; done(nil);
}
- (void)closeForWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done {
    // A Misty workspace window can also contain protected app surfaces and
    // private tabs. Only close browser tabs represented by this extension window.
    for (MistyExtensionTab *tab in [self tabsForWebExtensionContext:context]) [self.host event:@"close-tab" data:@{@"tabId":tab.identifier}];
    done(nil);
}
- (void)setFrame:(CGRect)frame forWebExtensionContext:(WKWebExtensionContext *)context completionHandler:(void (^)(NSError *))done { if (self.native) [self.native setFrame:frame display:YES]; done(nil); }
@end

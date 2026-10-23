// SPDX-License-Identifier: MIT
// The extension operations Misty's app asks a Space's host for.
#import "MistyExtensions.h"
#import "MistyExtensionsInternal.h"

@implementation MistyExtensionHost (Requests)
- (void)request:(NSDictionary *)request reply:(Reply)reply {
    NSString *operation = request[@"operation"], *identifier = request[@"id"];
    if ([operation isEqual:@"configure"]) {
        NSString *account = request[@"account"];
        if (![account isEqual:self.account]) {
            [self shutdown];
            self.account = account;
            self.controllerIdentifier = request[@"controllerId"];
        }
        // The controller is made once, over the store the Space has now. A later
        // store change (a new sign-in generation) applies when the Space reopens.
        if (!self.controller) {
            NSUUID *store = [request[@"store"] isKindOfClass:NSString.class] ? [[NSUUID alloc] initWithUUIDString:request[@"store"]] : nil;
            if (!store) { reply(@{@"error":@"This Space has no website data store."}); return; }
            [self startWithStore:[WKWebsiteDataStore dataStoreForIdentifier:store]];
        }
        reply(@{@"supported":@YES}); return;
    }
    if (!self.account || ![request[@"account"] isEqual:self.account]) { reply(@{@"error":@"The extension account changed."}); return; }
    if ([self compatRequest:request reply:reply]) return;
    if ([operation isEqual:@"diagnostics"]) {
        reply(@{@"runtimeCount":@(self.contexts.count),@"bridgeViewCount":@(self.bridges.count),@"platform":NSProcessInfo.processInfo.operatingSystemVersionString,@"minimumOS":@"15.4",@"manifestVersions":@[@2,@3],@"compatibility":@"Version-specific testing required",@"acquisition":@[@"firefox-addons",@"chrome-web-store"],@"knownUnavailable":@[@"debugger",@"proxy"],@"limited":@[@"webRequestBlocking",@"identity",@"management",@"tabHide",@"contextualIdentities",@"privacy",@"sidePanel",@"offscreen",@"tabGroups",@"declarativeContent",@"contentSettings",@"fontSettings",@"power",@"userScripts",@"tabCapture",@"desktopCapture"],@"compatibilityLayer":@[@"notifications",@"downloads",@"history",@"topSites",@"search",@"sessions",@"browsingData",@"find",@"idle",@"tts",@"theme",@"sidePanel",@"offscreen",@"bookmarks",@"tabGroups",@"declarativeContent",@"contentSettings",@"fontSettings",@"power",@"userScripts",@"tabCapture",@"desktopCapture"],@"hostLimitations":@[@"moving existing tabs into new windows",@"pinned and reader-mode tabs"]}); return;
    }
    if ([operation isEqual:@"layout"]) {
        NSMutableSet *seen=[NSMutableSet set];
        for (NSDictionary *item in request[@"tabs"]) {
            NSURL *logicalURL=[NSURL URLWithString:item[@"url"]];
            if (![@[@"http",@"https",@"webkit-extension"] containsObject:logicalURL.scheme] && ![logicalURL.absoluteString isEqual:@"about:blank"]) continue;
            NSString *key=item[@"id"], *windowId=item[@"windowId"];
            BOOL privateTab=[item[@"private"] boolValue];
            NSString *windowKey=[NSString stringWithFormat:@"%@:%d",windowId,privateTab];
            MistyExtensionWindow *window=self.windows[windowKey];
            if (!window) { window=[MistyExtensionWindow new]; window.identifier=windowId; window.host=self; window.privateWindow=privateTab; self.windows[windowKey]=window; [self.controller didOpenWindow:window]; }
            MistyExtensionTab *tab=self.tabs[key]; BOOL isNew=!tab;
            if (!tab) { tab=[MistyExtensionTab new]; tab.identifier=key; tab.host=self; }
            MistyExtensionWindow *old=tab.window; NSUInteger oldIndex=tab.position;
            tab.window=window; if (tab.view.window) window.native=tab.view.window;
            tab.position=[item[@"index"] unsignedIntegerValue]; tab.logicalURL=[NSURL URLWithString:item[@"url"]]; tab.logicalTitle=item[@"title"];
            tab.selected=[item[@"active"] boolValue];
            WKWebExtensionTabChangedProperties changed=WKWebExtensionTabChangedPropertiesNone;
            if (tab.muted!=[item[@"muted"] boolValue]) { tab.muted=[item[@"muted"] boolValue]; changed|=WKWebExtensionTabChangedPropertiesMuted; }
            if (tab.audible!=[item[@"audible"] boolValue]) { tab.audible=[item[@"audible"] boolValue]; changed|=WKWebExtensionTabChangedPropertiesPlayingAudio; }
            self.tabs[key]=tab; [seen addObject:key];
            [self registerOpenTab:tab];
            if (!isNew && changed) [self.controller didChangeTabProperties:changed forTab:tab];
            if (!isNew && (old!=window || oldIndex!=tab.position)) [self.controller didMoveTab:tab fromIndex:oldIndex inWindow:old];
            if (tab.selected && [item[@"focused"] boolValue] && ![self.activeTab isEqual:key]) {
                MistyExtensionTab *previous=self.tabs[self.activeTab]; self.activeTab=key;
                [self.controller didActivateTab:tab previousActiveTab:previous]; [self.controller didFocusWindow:window];
            }
        }
        for (NSString *key in self.tabs.allKeys) if (![seen containsObject:key] && !self.tabs[key].view) { [self.controller didCloseTab:self.tabs[key] windowIsClosing:NO]; [self.tabs removeObjectForKey:key]; }
        for (NSString *key in self.windows.allKeys) {
            MistyExtensionWindow *window=self.windows[key];
            BOOL used=NO; for (MistyExtensionTab *tab in self.tabs.allValues) if (tab.window==window) used=YES;
            if (!used) { [self.controller didCloseWindow:window]; [self.windows removeObjectForKey:key]; }
        }
        reply(@{}); return;
    }
    if ([operation isEqual:@"permission-response"]) {
        void (^complete)(BOOL) = self.pending[request[@"requestId"]];
        if (complete) { [self.pending removeObjectForKey:request[@"requestId"]]; complete([request[@"allowed"] boolValue]); }
        reply(@{}); return;
    }
    if ([operation isEqual:@"pending-navigation"]) { reply(@{@"pending":@(self.tabs[request[@"tabId"]].pendingNavigation!=nil)}); return; }
    if ([operation isEqual:@"tab-created"]) {
        NSString *requestId=request[@"requestId"], *tabId=request[@"tabId"];
        void (^done)(MistyExtensionTab *,NSError *)=self.openRequests[requestId];
        if (done) {
            if (self.tabs[tabId]) { [self.openRequests removeObjectForKey:requestId]; done(self.tabs[tabId],nil); }
            else self.openingTabs[tabId]=requestId;
        }
        reply(@{}); return;
    }
    if ([operation isEqual:@"sync-restored"]) {
        if (self.contexts[identifier] && ![self.restored containsObject:identifier]) { [self.restored addObject:identifier]; [self event:@"actions-changed" data:@{}]; }
        reply(@{}); return;
    }
    if ([operation isEqual:@"load"]) { [self load:request reply:reply]; return; }
    if ([operation isEqual:@"unload"] || [operation isEqual:@"remove"]) {
        WKWebExtensionContext *context = self.contexts[identifier];
        [self unload:identifier]; [self.descriptors removeObjectForKey:identifier];
        if ([operation isEqual:@"remove"] && self.controller) {
            WKWebExtensionController *controller = self.controller;
            NSString *guid = request[@"guid"] ?: context.uniqueIdentifier;
            [controller fetchDataRecordsOfTypes:WKWebExtensionController.allExtensionDataTypes completionHandler:^(NSArray<WKWebExtensionDataRecord *> *records) {
                NSMutableArray *matching = [NSMutableArray array];
                for (WKWebExtensionDataRecord *record in records) if ([record.uniqueIdentifier isEqual:guid]) [matching addObject:record];
                [controller removeDataOfTypes:WKWebExtensionController.allExtensionDataTypes fromDataRecords:matching completionHandler:^{ reply(@{}); }];
            }];
        } else reply(@{});
        return;
    }
    if ([operation isEqual:@"actions"]) {
        NSMutableArray *actions = [NSMutableArray array];
        MistyExtensionTab *tab = self.tabs[request[@"tabId"]];
        for (NSString *key in self.contexts) {
            WKWebExtensionContext *context = self.contexts[key];
            WKWebExtensionAction *action = [context actionForTab:tab];
            NSImage *icon = [action iconForSize:NSMakeSize(20, 20)];
            NSBitmapImageRep *bitmap = icon ? [[NSBitmapImageRep alloc] initWithData:icon.TIFFRepresentation] : nil;
            NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            [actions addObject:@{@"id":key, @"title":action.label ?: @"", @"badge":action.badgeText ?: @"", @"enabled":@(action.enabled && [self.restored containsObject:key] && (!tab.window.privateWindow || context.hasAccessToPrivateData)), @"icon":png ? [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]] : @""}];
        }
        reply(@{@"actions":actions}); return;
    }
    if ([operation isEqual:@"context-menu"]) {
        MistyExtensionTab *tab=self.tabs[request[@"tabId"]];
        NSMenu *menu=[NSMenu new];
        for (NSString *key in self.contexts) {
            if (![request[@"allowedIds"] containsObject:key]) continue;
            WKWebExtensionContext *context=self.contexts[key];
            if (!tab || (tab.window.privateWindow && !context.hasAccessToPrivateData) || ![self.restored containsObject:key]) continue;
            for (NSMenuItem *item in [context menuItemsForTab:tab]) [menu addItem:item];
        }
        if (!menu.numberOfItems) { NSMenuItem *empty=[[NSMenuItem alloc] initWithTitle:@"No extension actions for this page" action:nil keyEquivalent:@""]; empty.enabled=NO; [menu addItem:empty]; }
        [menu popUpMenuPositioningItem:nil atLocation:NSEvent.mouseLocation inView:nil];
        reply(@{}); return;
    }
    WKWebExtensionContext *context = self.contexts[identifier];
    if (!context) { reply(@{@"error":@"This extension is not running."}); return; }
    if ([operation isEqual:@"invoke"] || [operation isEqual:@"options"]) { if (![self.restored containsObject:identifier]) { reply(@{@"error":@"Extension settings are still restoring. Unlock account sync to continue."}); return; } }
    if ([operation isEqual:@"invoke"]) {
        MistyExtensionTab *tab = self.tabs[request[@"tabId"]];
        if (!tab || (tab.window.privateWindow && !context.hasAccessToPrivateData)) { reply(@{@"error":@"This extension cannot access the current tab."}); return; }
        self.popupTab=tab.identifier;
        self.popupParent = tab.view.window.contentView;
        NSDictionary *anchor = [request[@"anchor"] isKindOfClass:NSDictionary.class] ? request[@"anchor"] : @{@"x":@0.94,@"y":@0.04,@"width":@0.02,@"height":@0.02};
        CGSize size=self.popupParent.bounds.size;
        self.popupAnchor = NSMakeRect([anchor[@"x"] doubleValue]*size.width, size.height*(1-[anchor[@"y"] doubleValue]-[anchor[@"height"] doubleValue]), MAX(1,[anchor[@"width"] doubleValue]*size.width), MAX(1,[anchor[@"height"] doubleValue]*size.height));
        [context performActionForTab:tab]; reply(@{}); return;
    }
    if ([operation isEqual:@"options"]) {
        if (!context.optionsPageURL) { reply(@{@"error":@"This extension has no options page."}); return; }
        [self event:@"open-tab" data:@{@"url":context.optionsPageURL.absoluteString, @"private":@NO}]; reply(@{}); return;
    }
    if ([operation isEqual:@"popup-evaluate"]) {
        MistyExtensionTab *tab=self.tabs[request[@"tabId"]];
        WKWebExtensionAction *action=[context actionForTab:tab];
        if (!tab || (tab.window.privateWindow && !context.hasAccessToPrivateData) || !action.popupPopover.shown || action.associatedTab!=tab || [self.controller extensionContextForURL:action.popupWebView.URL]!=context || ![self.restored containsObject:identifier]) { reply(@{@"error":@"Open this extension's popup on the granted tab before inspecting it."}); return; }
        NSString *script=request[@"script"];
        [action.popupWebView evaluateJavaScript:script completionHandler:^(id result,NSError *error) { reply(error ? @{@"error":@"The extension popup changed. Inspect it again."} : @{@"result":result ?: NSNull.null}); }];
        return;
    }
    if ([operation isEqual:@"sync-apply"]) {
        WKWebView *bridge = self.bridges[identifier];
        if (!bridge) { reply(@{@"error":@"Extension sync is not ready."}); return; }
        [bridge callAsyncJavaScript:@"return await window.mistyApplySync(changes)" arguments:@{@"changes":request[@"changes"] ?: @{}} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result, NSError *error) { (void)result; reply(error ? @{@"error":error.localizedDescription} : @{}); }]; return;
    }
    reply(@{@"error":@"Unknown extension operation."});
}
@end

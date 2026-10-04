// SPDX-License-Identifier: MIT
// Exercise the host's adapters and public WebKit open-tab bookkeeping directly.
#import "../../native/macos/MistyExtensions.m"

static void spin(double seconds) {
    NSDate *end=[NSDate dateWithTimeIntervalSinceNow:seconds];
    while (end.timeIntervalSinceNow>0) [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
}
static void require(BOOL condition, NSString *message) {
    if (!condition) { fprintf(stderr,"FAIL: %s\n",message.UTF8String); exit(1); }
}
static id evaluate(WKWebView *view, NSString *script) {
    __block id result; __block NSError *failure; __block BOOL done=NO;
    [view callAsyncJavaScript:script arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value,NSError *error) { result=value; failure=error; done=YES; }];
    for (int i=0;i<500&&!done;i++) spin(.01);
    require(done && !failure, failure.localizedDescription ?: @"JavaScript timed out");
    return result;
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc!=3 || !misty_extensions_supported()) return 2;
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        host=[MistyExtensionHost new]; host.account=NSUUID.UUID.UUIDString; host.controllerIdentifier=NSUUID.UUID.UUIDString;
        NSString *url=[NSString stringWithUTF8String:argv[2]];
        NSDictionary *layout=@{@"operation":@"layout",@"account":host.account,@"tabs":@[@{@"id":@"restored",@"windowId":@"main",@"url":url,@"title":@"Fixture",@"private":@NO,@"index":@0,@"active":@YES,@"focused":@YES}]};
        // Restored logical tabs exist before a controller, extension, or native view.
        [host request:layout reply:^(NSDictionary *result) {}];
        [host configureStore:[WKWebsiteDataStore nonPersistentDataStore]];
        __block BOOL loaded=NO;
        [host load:@{@"id":@"1",@"guid":@"native-fixture@misty.test",@"origin":NSUUID.UUID.UUIDString.lowercaseString,@"runtimePath":[NSString stringWithUTF8String:argv[1]],@"privateAccess":@YES,@"permissions":@[@"storage",@"activeTab",@"scripting"],@"hosts":@[@"http://127.0.0.1/*"]} reply:^(NSDictionary *result) { require(!result[@"error"],result[@"error"]); loaded=YES; }];
        for (int i=0;i<500&&!loaded;i++) spin(.01);
        require(loaded,@"Extension loading timed out");
        WKWebExtensionContext *context=host.contexts[@"1"];
        MistyExtensionTab *tab=host.tabs[@"restored"];
        require([context.openTabs containsObject:tab],@"Restored tab was not announced to the new context");
        WKWebViewConfiguration *original=[WKWebViewConfiguration new]; original.websiteDataStore=host.store;
        WKWebViewConfiguration *config=CFBridgingRelease(misty_extensions_configuration((__bridge void *)original,url.UTF8String,false));
        WKWebView *view=[[WKWebView alloc] initWithFrame:NSMakeRect(0,0,500,300) configuration:config];
        NSWindow *window=[[NSWindow alloc] initWithContentRect:NSMakeRect(80,80,500,300) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        [window.contentView addSubview:view]; [window makeKeyAndOrderFront:nil];
        // Reproduce the inconsistent state from the live failure: the action and
        // window adapter expose a tab that is absent from context.openTabs.
        [context didCloseTab:tab windowIsClosing:NO];
        [context actionForTab:tab];
        require(![context.openTabs containsObject:tab],@"Regression setup did not produce an unannounced tab");
        misty_extensions_register_tab((__bridge void *)view,"restored",false,url.UTF8String);
        require([context.openTabs containsObject:tab],@"Binding an existing adapter did not restore its open registration");
        [view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:url]]];
        BOOL connected=NO;
        for(int i=0;i<60&&!connected;i++) { spin(.1); connected=[evaluate(view,@"return document.documentElement.dataset.mistyFixture") isEqual:@"content-and-background"]; }
        require(connected,@"Content script could not communicate with the background after restoration");
        WKWebView *bridge=host.bridges[@"1"];
        // No tabs permission is needed to compare IDs in the known fixture.
        NSNumber *tabID=evaluate(bridge,@"return (await browser.tabs.query({active:true}))[0].id");
        for(int i=0;i<5;i++) {
            [host request:layout reply:^(NSDictionary *result) {}];
            misty_extensions_register_tab((__bridge void *)view,"restored",false,url.UTF8String);
            misty_extensions_tab_event("restored","updated");
        }
        require([tabID isEqual:evaluate(bridge,@"return (await browser.tabs.query({active:true}))[0].id")],@"Repeated registration changed the extension tab ID");
        [context didCloseTab:tab windowIsClosing:NO]; [context actionForTab:tab];
        [host request:layout reply:^(NSDictionary *result) {}];
        require([context.openTabs containsObject:tab],@"Layout reconciliation did not restore an existing tab");
        [context didCloseTab:tab windowIsClosing:NO]; [context actionForTab:tab];
        misty_extensions_tab_event("restored","activate");
        require([context.openTabs containsObject:tab],@"Activation did not restore an existing tab");
        [host unload:@"1"];
        puts("PASS: restored adapters, open-tab reconciliation, content/background messaging, stable IDs during repeated layout/registration");
    }
    return 0;
}

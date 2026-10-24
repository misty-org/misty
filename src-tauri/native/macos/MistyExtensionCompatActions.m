// SPDX-License-Identifier: MIT
// What the compatibility layer does natively for an extension: language
// detection, browsing data, tab moves, user scripts, idle state, downloads
// and identity redirects. Requests reach these through MistyExtensionCompat.m.
#import "MistyExtensions.h"
#import "MistyExtensionsInternal.h"
#import <objc/message.h>
#import <NaturalLanguage/NaturalLanguage.h>
#import <CommonCrypto/CommonDigest.h>

/// Where user scripts' code is stored inside an extension's own package.
static NSString *const UserScriptDirectory = @"__misty_user_scripts__";

static NSString *const IdentitySuffix = @".extensions.misty.invalid";

/// WebKit data types for each browsingData key.
static NSSet<NSString *> *WebsiteDataTypes(NSDictionary *types) {
    NSDictionary<NSString *, NSArray *> *map = @{
        @"cookies":@[WKWebsiteDataTypeCookies],
        @"localStorage":@[WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeSessionStorage],
        @"indexedDB":@[WKWebsiteDataTypeIndexedDBDatabases],
        @"serviceWorkers":@[WKWebsiteDataTypeServiceWorkerRegistrations],
        @"cache":@[WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache],
        @"cacheStorage":@[WKWebsiteDataTypeFetchCache],
        @"fileSystems":@[WKWebsiteDataTypeFileSystem],
        @"webSQL":@[WKWebsiteDataTypeWebSQLDatabases],
    };
    NSMutableSet *result = [NSMutableSet set];
    for (NSString *key in map) if ([types[key] boolValue]) [result addObjectsFromArray:map[key]];
    return result;
}

/// Whether a website data record (named by registrable domain) belongs to one of the hosts.
static BOOL RecordMatches(WKWebsiteDataRecord *record, NSArray *hosts) {
    NSString *name = record.displayName.lowercaseString;
    for (id value in hosts) {
        if (![value isKindOfClass:NSString.class]) continue;
        NSString *host = [value lowercaseString];
        NSURL *url = [NSURL URLWithString:host];
        if (url.host) host = url.host.lowercaseString;
        if ([host isEqual:name] || [host hasSuffix:[@"." stringByAppendingString:name]]) return YES;
    }
    return NO;
}

@implementation MistyExtensionHost (CompatActions)
- (NSDictionary *)detectLanguage:(id)text {
    NLLanguageRecognizer *recognizer = [NLLanguageRecognizer new];
    if ([text isKindOfClass:NSString.class]) [recognizer processString:[(NSString *)text substringToIndex:MIN([(NSString *)text length], 20000)]];
    NSDictionary<NLLanguage, NSNumber *> *hypotheses = [recognizer languageHypothesesWithMaximum:3];
    NSMutableArray *languages = [NSMutableArray array];
    double best = 0;
    for (NLLanguage language in hypotheses) {
        double probability = hypotheses[language].doubleValue;
        best = MAX(best, probability);
        [languages addObject:@{@"language":language, @"percentage":@((NSInteger)llround(probability * 100))}];
    }
    [languages sortUsingDescriptors:@[[NSSortDescriptor sortDescriptorWithKey:@"percentage" ascending:NO]]];
    return @{@"isReliable":@(best >= 0.8), @"languages":languages};
}

/// Removes website data from the browsing profile's store, for every site or
/// for named hosts. Hosts take precedence over a start time, as WebKit cannot
/// filter by both.
- (void)removeWebsiteData:(NSDictionary *)options types:(NSDictionary *)types complete:(void (^)(void))complete {
    NSSet *dataTypes = WebsiteDataTypes(types);
    WKWebsiteDataStore *store = self.store;
    if (!dataTypes.count || !store) { complete(); return; }
    NSArray *hosts = [options[@"hostnames"] isKindOfClass:NSArray.class] ? options[@"hostnames"] : [options[@"origins"] isKindOfClass:NSArray.class] ? options[@"origins"] : nil;
    NSArray *excluded = [options[@"excludeOrigins"] isKindOfClass:NSArray.class] ? options[@"excludeOrigins"] : nil;
    if (!hosts && !excluded) {
        double since = [options[@"since"] isKindOfClass:NSNumber.class] ? [options[@"since"] doubleValue] / 1000 : 0;
        [store removeDataOfTypes:dataTypes modifiedSince:[NSDate dateWithTimeIntervalSince1970:since] completionHandler:complete];
        return;
    }
    [store fetchDataRecordsOfTypes:dataTypes completionHandler:^(NSArray<WKWebsiteDataRecord *> *records) {
        NSMutableArray *matching = [NSMutableArray array];
        for (WKWebsiteDataRecord *record in records) {
            if (hosts && !RecordMatches(record, hosts)) continue;
            if (excluded && RecordMatches(record, excluded)) continue;
            [matching addObject:record];
        }
        [store removeDataOfTypes:dataTypes forDataRecords:matching completionHandler:complete];
    }];
}

/// Finds an extension-visible tab by its window's tab order and position, then
/// asks Misty's workspace to move it. WebKit keeps its tab ids private.
- (NSString *)moveTab:(id)request context:(WKWebExtensionContext *)context {
    if (![request isKindOfClass:NSDictionary.class] || ![request[@"urls"] isKindOfClass:NSArray.class]) return @"Invalid tab move.";
    MistyExtensionTab *found = [self locateTab:request context:context];
    if (!found) return @"Misty could not identify that tab.";
    [self event:@"move-tab" data:@{@"tabId":found.identifier, @"index":@([request[@"to"] unsignedIntegerValue])}];
    return nil;
}

/// The one tab at `from` in the only window whose tabs show these addresses, as
/// this extension sees them. Nil when no window, or more than one, matches.
- (MistyExtensionTab *)locateTab:(id)request context:(WKWebExtensionContext *)context {
    if (![request isKindOfClass:NSDictionary.class] || ![request[@"urls"] isKindOfClass:NSArray.class]) return nil;
    NSArray *urls = request[@"urls"];
    NSUInteger from = [request[@"from"] unsignedIntegerValue];
    MistyExtensionTab *found = nil;
    NSUInteger candidates = 0;
    for (MistyExtensionWindow *window in [NSSet setWithArray:[self.tabs.allValues valueForKey:@"window"]]) {
        if (![window isKindOfClass:MistyExtensionWindow.class]) continue;
        NSArray<MistyExtensionTab *> *tabs = (NSArray *)[window tabsForWebExtensionContext:context];
        if (tabs.count != urls.count || from >= tabs.count) continue;
        BOOL same = YES;
        for (NSUInteger i = 0; i < tabs.count && same; i++) {
            NSString *expected = [urls[i] isKindOfClass:NSString.class] ? urls[i] : @"";
            NSString *actual = [tabs[i] urlForWebExtensionContext:context].absoluteString ?: @"";
            same = !expected.length || [expected isEqual:actual];
        }
        if (same) { found = tabs[from]; candidates++; }
    }
    return candidates == 1 ? found : nil;
}

/// Stores a user script's code as a file in the extension's own package, named by
/// its SHA-256, and returns its package path. WebKit registers scripts only from
/// files. Bounded: 4 MiB a script and 2,000 scripts an extension.
- (NSString *)writeUserScript:(id)code identifier:(NSString *)identifier {
    if (![code isKindOfClass:NSString.class]) return nil;
    NSData *data = [(NSString *)code dataUsingEncoding:NSUTF8StringEncoding];
    NSString *root = self.descriptors[identifier][@"runtimePath"];
    if (!data || data.length > 4 * 1024 * 1024 || ![root isKindOfClass:NSString.class]) return nil;
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *name = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2 + 3];
    for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [name appendFormat:@"%02x", digest[i]];
    [name appendString:@".js"];
    NSFileManager *files = NSFileManager.defaultManager;
    NSString *directory = [root stringByAppendingPathComponent:UserScriptDirectory];
    NSString *file = [directory stringByAppendingPathComponent:name];
    if (![files fileExistsAtPath:file]) {
        if (![files createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil]) return nil;
        if ([files contentsOfDirectoryAtPath:directory error:nil].count >= 2000) return nil;
        if (![data writeToFile:file atomically:YES]) return nil;
    }
    return [NSString stringWithFormat:@"%@/%@", UserScriptDirectory, name];
}

- (NSString *)idleState:(id)threshold {
    double seconds = [threshold isKindOfClass:NSNumber.class] ? MAX(15, [threshold doubleValue]) : 60;
    NSDictionary *session = CFBridgingRelease(CGSessionCopyCurrentDictionary());
    if ([session[@"CGSSessionScreenIsLocked"] boolValue]) return @"locked";
    CFTimeInterval idle = CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType);
    return idle >= seconds ? @"idle" : @"active";
}

/// Starts a download in a browser tab of the matching privacy, so Misty's own
/// download handling saves it and lists it. Returns an error message on failure.
- (NSString *)startDownload:(id)options context:(WKWebExtensionContext *)context {
    if (![options isKindOfClass:NSDictionary.class]) return @"A download needs a URL.";
    NSURL *url = [options[@"url"] isKindOfClass:NSString.class] ? [NSURL URLWithString:options[@"url"]] : nil;
    if (![@[@"http", @"https", @"data"] containsObject:url.scheme.lowercaseString]) return @"Only http, https and data URLs can be downloaded.";
    BOOL incognito = [options[@"incognito"] boolValue];
    if (incognito && !context.hasAccessToPrivateData) return @"Private access is disabled.";
    MistyExtensionTab *tab = self.tabs[self.activeTab];
    if (!tab.view || tab.window.privateWindow != incognito) {
        tab = nil;
        for (MistyExtensionTab *candidate in self.tabs.allValues) if (candidate.view && candidate.window.privateWindow == incognito) { tab = candidate; break; }
    }
    WKWebView *view = tab.view;
    if (!view) return @"Open a browser tab to download files.";
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    if ([options[@"method"] isEqual:@"POST"]) {
        request.HTTPMethod = @"POST";
        if ([options[@"body"] isKindOfClass:NSString.class]) request.HTTPBody = [options[@"body"] dataUsingEncoding:NSUTF8StringEncoding];
    }
    if ([options[@"headers"] isKindOfClass:NSArray.class]) {
        for (NSDictionary *header in options[@"headers"]) {
            if ([header isKindOfClass:NSDictionary.class] && [header[@"name"] isKindOfClass:NSString.class] && [header[@"value"] isKindOfClass:NSString.class])
                [request setValue:header[@"value"] forHTTPHeaderField:header[@"name"]];
        }
    }
    __weak WKWebView *weakView = view;
    [view startDownloadUsingRequest:request completionHandler:^(WKDownload *download) {
        WKWebView *strongView = weakView;
        id<WKNavigationDelegate> delegate = strongView.navigationDelegate;
        SEL selector = @selector(webView:navigationAction:didBecomeDownload:);
        // wry adopts downloads here; its handler ignores the action argument.
        if (strongView && [delegate respondsToSelector:selector])
            ((void (*)(id, SEL, WKWebView *, WKNavigationAction *, WKDownload *))objc_msgSend)(delegate, selector, strongView, [WKNavigationAction new], download);
    }];
    return nil;
}

- (NSURL *)identityRedirect:(NSURL *)url {
    NSString *name = url.host.lowercaseString;
    if (![url.scheme.lowercaseString isEqual:@"https"] || ![name hasSuffix:IdentitySuffix]) return nil;
    NSString *origin = [name substringToIndex:name.length - IdentitySuffix.length];
    for (WKWebExtensionContext *context in self.contexts.allValues) {
        if (![context.baseURL.host.lowercaseString isEqual:origin]) continue;
        NSString *fragment = [url.absoluteString stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.alphanumericCharacterSet];
        return [NSURL URLWithString:[@"__misty_compat__/identity.html#" stringByAppendingString:fragment] relativeToURL:context.baseURL].absoluteURL;
    }
    return nil;
}
@end

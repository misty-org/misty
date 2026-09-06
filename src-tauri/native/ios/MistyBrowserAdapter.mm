#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static NSMutableDictionary<NSString *, WKWebView *> *MistyBrowserViews(void) {
  static NSMutableDictionary<NSString *, WKWebView *> *views;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{ views = [NSMutableDictionary dictionary]; });
  return views;
}

static __weak WKWebView *mistyMainWebView;
static WKWebsiteDataStore *mistyBrowserDataStore;

static WKWebsiteDataStore *MistyBrowserDataStore(void) {
  if (mistyBrowserDataStore) return mistyBrowserDataStore;
  if (@available(iOS 17.0, *)) {
    NSUUID *identifier = [[NSUUID alloc]
      initWithUUIDString:@"68258F34-888A-4ABD-A621-8F4CE2637196"];
    mistyBrowserDataStore = [WKWebsiteDataStore dataStoreForIdentifier:identifier];
  } else {
    // iOS 15–16 cannot create named persistent stores. Keep arbitrary web
    // content out of the Host's default store even though sign-ins then last
    // only for this process.
    mistyBrowserDataStore = WKWebsiteDataStore.nonPersistentDataStore;
  }
  return mistyBrowserDataStore;
}
static char MistyBrowserDelegateKey;

static UIViewController *MistyRootViewController(void) {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) continue;
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    for (UIWindow *window in windowScene.windows) {
      if (window.isKeyWindow && window.rootViewController) return window.rootViewController;
    }
    if (windowScene.windows.firstObject.rootViewController) {
      return windowScene.windows.firstObject.rootViewController;
    }
  }
  return nil;
}

static WKWebView *MistyFindWebView(UIView *view) {
  if ([view isKindOfClass:WKWebView.class]) return (WKWebView *)view;
  for (UIView *child in view.subviews) {
    WKWebView *candidate = MistyFindWebView(child);
    if (candidate) return candidate;
  }
  return nil;
}

static void MistyEmitBrowserEvent(NSDictionary *detail) {
  WKWebView *main = mistyMainWebView;
  if (!main) return;
  NSData *data = [NSJSONSerialization dataWithJSONObject:detail options:0 error:nil];
  if (!data) return;
  NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  NSString *script = [NSString stringWithFormat:
    @"window.dispatchEvent(new CustomEvent('misty:ios-browser-event',{detail:%@}));", json];
  [main evaluateJavaScript:script completionHandler:nil];
}

@interface MistyBrowserDelegate : NSObject <WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate>
@property(nonatomic, copy) NSString *browserId;
@property(nonatomic, strong) NSMutableDictionary<NSValue *, NSURL *> *downloadDestinations;
@end

@implementation MistyBrowserDelegate

- (instancetype)init {
  self = [super init];
  if (self) _downloadDestinations = [NSMutableDictionary dictionary];
  return self;
}

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation {
  MistyEmitBrowserEvent(@{
    @"kind": @"page", @"id": self.browserId, @"phase": @"started",
    @"url": webView.URL.absoluteString ?: @"about:blank"
  });
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  MistyEmitBrowserEvent(@{
    @"kind": @"page", @"id": self.browserId, @"phase": @"finished",
    @"url": webView.URL.absoluteString ?: @"about:blank"
  });
  MistyEmitBrowserEvent(@{
    @"kind": @"title", @"id": self.browserId, @"title": webView.title ?: @"Browser"
  });
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation
    withError:(NSError *)error {
  MistyEmitBrowserEvent(@{
    @"kind": @"error", @"id": self.browserId,
    @"message": error.localizedDescription ?: @"The page could not be loaded."
  });
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation
    withError:(NSError *)error {
  [self webView:webView didFailNavigation:navigation withError:error];
}

- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
    forNavigationAction:(WKNavigationAction *)navigationAction
    windowFeatures:(WKWindowFeatures *)windowFeatures {
  NSString *url = navigationAction.request.URL.absoluteString;
  if (url.length) {
    MistyEmitBrowserEvent(@{
      @"kind": @"popup", @"sourceId": self.browserId, @"url": url
    });
  }
  return nil;
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationResponse:(WKNavigationResponse *)navigationResponse
    decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
  if (@available(iOS 14.5, *)) {
    if (!navigationResponse.canShowMIMEType) {
      decisionHandler(WKNavigationResponsePolicyDownload);
      return;
    }
  }
  decisionHandler(WKNavigationResponsePolicyAllow);
}

- (void)webView:(WKWebView *)webView navigationResponse:(WKNavigationResponse *)navigationResponse
    didBecomeDownload:(WKDownload *)download API_AVAILABLE(ios(14.5)) {
  download.delegate = self;
}

- (void)download:(WKDownload *)download
    decideDestinationUsingResponse:(NSURLResponse *)response
    suggestedFilename:(NSString *)suggestedFilename
    completionHandler:(void (^)(NSURL *destination))completionHandler API_AVAILABLE(ios(14.5)) {
  NSURL *support = [NSFileManager.defaultManager URLForDirectory:NSApplicationSupportDirectory
    inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil];
  NSURL *directory = [support URLByAppendingPathComponent:@"browser-downloads" isDirectory:YES];
  [NSFileManager.defaultManager createDirectoryAtURL:directory
    withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *name = suggestedFilename.lastPathComponent.length
    ? suggestedFilename.lastPathComponent : @"download";
  NSURL *destination = [directory URLByAppendingPathComponent:name];
  NSString *stem = name.stringByDeletingPathExtension;
  NSString *extension = name.pathExtension;
  NSInteger suffix = 2;
  while ([NSFileManager.defaultManager fileExistsAtPath:destination.path]) {
    NSString *candidate = extension.length
      ? [NSString stringWithFormat:@"%@ (%ld).%@", stem, (long)suffix++, extension]
      : [NSString stringWithFormat:@"%@ (%ld)", stem, (long)suffix++];
    destination = [directory URLByAppendingPathComponent:candidate];
  }
  self.downloadDestinations[[NSValue valueWithNonretainedObject:download]] = destination;
  MistyEmitBrowserEvent(@{
    @"kind": @"download", @"id": self.browserId, @"state": @"requested",
    @"path": destination.path ?: @"", @"success": @NO
  });
  completionHandler(destination);
}

- (void)downloadDidFinish:(WKDownload *)download API_AVAILABLE(ios(14.5)) {
  NSValue *key = [NSValue valueWithNonretainedObject:download];
  NSURL *destination = self.downloadDestinations[key];
  [self.downloadDestinations removeObjectForKey:key];
  MistyEmitBrowserEvent(@{
    @"kind": @"download", @"id": self.browserId, @"state": @"finished",
    @"path": destination.path ?: @"download", @"success": @YES
  });
}

- (void)download:(WKDownload *)download didFailWithError:(NSError *)error
    resumeData:(NSData *)resumeData API_AVAILABLE(ios(14.5)) {
  NSValue *key = [NSValue valueWithNonretainedObject:download];
  NSURL *destination = self.downloadDestinations[key];
  [self.downloadDestinations removeObjectForKey:key];
  MistyEmitBrowserEvent(@{
    @"kind": @"download", @"id": self.browserId, @"state": @"failed",
    @"path": destination.path ?: @"", @"success": @NO,
    @"error": error.localizedDescription ?: @"The download failed."
  });
}

@end

static NSString *MistyString(const char *value) {
  return value ? [NSString stringWithUTF8String:value] : @"";
}

extern "C" bool misty_ios_browser_create(const char *identifier, const char *rawUrl,
    double x, double y, double width, double height) {
  __block bool created = false;
  void (^work)(void) = ^{
    UIViewController *controller = MistyRootViewController();
    NSString *browserId = MistyString(identifier);
    NSURL *url = [NSURL URLWithString:MistyString(rawUrl)];
    if (!controller || !browserId.length || !url) return;
    if (!mistyMainWebView) mistyMainWebView = MistyFindWebView(controller.view);
    WKWebView *webView = MistyBrowserViews()[browserId];
    if (!webView) {
      WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
      configuration.websiteDataStore = MistyBrowserDataStore();
      webView = [[WKWebView alloc] initWithFrame:CGRectMake(x, y, width, height)
        configuration:configuration];
      webView.autoresizingMask = UIViewAutoresizingNone;
      webView.allowsBackForwardNavigationGestures = YES;
      webView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
      MistyBrowserDelegate *delegate = [[MistyBrowserDelegate alloc] init];
      delegate.browserId = browserId;
      webView.navigationDelegate = delegate;
      webView.UIDelegate = delegate;
      objc_setAssociatedObject(webView, &MistyBrowserDelegateKey, delegate,
        OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      [controller.view addSubview:webView];
      MistyBrowserViews()[browserId] = webView;
    }
    webView.frame = CGRectMake(x, y, width, height);
    webView.hidden = NO;
    [controller.view bringSubviewToFront:webView];
    [webView loadRequest:[NSURLRequest requestWithURL:url]];
    created = true;
  };
  if (NSThread.isMainThread) work(); else dispatch_sync(dispatch_get_main_queue(), work);
  return created;
}

extern "C" void misty_ios_browser_set_bounds(const char *identifier, double x, double y,
    double width, double height) {
  dispatch_async(dispatch_get_main_queue(), ^{
    WKWebView *view = MistyBrowserViews()[MistyString(identifier)];
    view.frame = CGRectMake(x, y, width, height);
    view.hidden = NO;
    [view.superview bringSubviewToFront:view];
  });
}

extern "C" void misty_ios_browser_navigate(const char *identifier, const char *rawUrl) {
  dispatch_async(dispatch_get_main_queue(), ^{
    WKWebView *view = MistyBrowserViews()[MistyString(identifier)];
    NSURL *url = [NSURL URLWithString:MistyString(rawUrl)];
    if (view && url) [view loadRequest:[NSURLRequest requestWithURL:url]];
  });
}

extern "C" void misty_ios_browser_action(const char *identifier, const char *rawAction) {
  dispatch_async(dispatch_get_main_queue(), ^{
    WKWebView *view = MistyBrowserViews()[MistyString(identifier)];
    NSString *action = MistyString(rawAction);
    if ([action isEqualToString:@"back"] && view.canGoBack) [view goBack];
    else if ([action isEqualToString:@"forward"] && view.canGoForward) [view goForward];
    else if ([action isEqualToString:@"reload"]) [view reload];
  });
}

extern "C" void misty_ios_browser_set_visible(const char *identifier, bool visible) {
  dispatch_async(dispatch_get_main_queue(), ^{
    WKWebView *view = MistyBrowserViews()[MistyString(identifier)];
    view.hidden = !visible;
    if (visible) [view.superview bringSubviewToFront:view];
  });
}

extern "C" void misty_ios_browser_hide_all(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    for (WKWebView *view in MistyBrowserViews().allValues) view.hidden = YES;
  });
}

extern "C" void misty_ios_browser_close(const char *identifier) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *browserId = MistyString(identifier);
    WKWebView *view = MistyBrowserViews()[browserId];
    [view stopLoading];
    [view removeFromSuperview];
    [MistyBrowserViews() removeObjectForKey:browserId];
  });
}

#import "MistyDesktopCapture.h"
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreImage/CoreImage.h>

API_AVAILABLE(macos(14.0))
@interface MistyDesktopStream : NSObject <SCStreamOutput, SCStreamDelegate>
@property NSCondition *condition;
@property SCStream *stream;
@property CIContext *images;
@property NSData *jpeg;
@property NSError *failure;
@property NSUInteger width, height, sequence;
@property BOOL stopped;
@property uint32_t displayID;
@property NSTimeInterval capturedAt;
@end

@implementation MistyDesktopStream
- (instancetype)init {
  if ((self = [super init])) {
    _condition = [NSCondition new];
    _images = [CIContext contextWithOptions:@{kCIContextUseSoftwareRenderer: @NO}];
  }
  return self;
}
- (void)failed:(NSError *)error {
  [self.condition lock];
  self.failure = error;
  [self.condition broadcast];
  [self.condition unlock];
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error { [self failed:error]; }
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample)) return;
  NSArray *attachments = (__bridge NSArray *)CMSampleBufferGetSampleAttachmentsArray(sample, NO);
  NSNumber *status = attachments.firstObject[SCStreamFrameInfoStatus];
  if (!status) return;
  if (status.integerValue == SCFrameStatusIdle) {
    // ScreenCaptureKit explicitly reports an unchanged display; retained pixels
    // are current, unlike replaying a frame after a stopped/lost stream.
    [self.condition lock];
    if (!self.stopped && self.jpeg) { self.capturedAt = NSDate.date.timeIntervalSince1970; [self.condition broadcast]; }
    [self.condition unlock];
    return;
  }
  if (status.integerValue != SCFrameStatusComplete) return;
  CVPixelBufferRef pixels = CMSampleBufferGetImageBuffer(sample);
  if (!pixels) return;
  @autoreleasepool {
    CIImage *image = [CIImage imageWithCVPixelBuffer:pixels];
    CGImageRef frame = [self.images createCGImage:image fromRect:image.extent];
    if (!frame) return;
    NSData *jpeg = [[[NSBitmapImageRep alloc] initWithCGImage:frame]
      representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor: @0.85}];
    [self.condition lock];
    if (!self.stopped && jpeg.length) {
      self.jpeg = jpeg;
      self.width = CGImageGetWidth(frame);
      self.height = CGImageGetHeight(frame);
      self.sequence++;
      self.capturedAt = NSDate.date.timeIntervalSince1970;
      [self.condition broadcast];
    }
    [self.condition unlock];
    CGImageRelease(frame);
  }
}
- (void)stop {
  [self.condition lock];
  self.stopped = YES;
  self.jpeg = nil;
  SCStream *stream = self.stream;
  self.stream = nil;
  [self.condition broadcast];
  [self.condition unlock];
  [stream stopCaptureWithCompletionHandler:^(NSError *error) { (void)error; }];
}
@end

static NSObject *streamLock(void) {
  static NSObject *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ lock = [NSObject new]; });
  return lock;
}
static MistyDesktopStream *activeStream API_AVAILABLE(macos(14.0));

void MistyDesktopCaptureStop(void) {
  if (@available(macOS 14.0, *)) {
    @synchronized(streamLock()) {
      [activeStream stop];
      activeStream = nil;
    }
  }
}

NSDictionary *MistyDesktopFrame(uint32_t displayID, NSTimeInterval after) {
  if (@available(macOS 14.0, *)) {
    MistyDesktopStream *owner;
    BOOL start = NO;
    @synchronized(streamLock()) {
      if (activeStream.displayID != displayID) {
        [activeStream stop];
        activeStream = nil;
      }
      if (!activeStream) {
        activeStream = [MistyDesktopStream new];
        activeStream.displayID = displayID;
        start = YES;
      }
      owner = activeStream;
    }
    if (start) {
      [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES
        completionHandler:^(SCShareableContent *content, NSError *error) {
          SCDisplay *target;
          for (SCDisplay *display in content.displays) if (display.displayID == displayID) target = display;
          if (error || !target) {
            [owner failed:error ?: [NSError errorWithDomain:@"MistyDesktop" code:1
              userInfo:@{NSLocalizedDescriptionKey: @"The captured display disconnected."}]];
            return;
          }
          NSMutableArray *excluded = [NSMutableArray new];
          for (SCWindow *window in content.windows) {
            if (window.owningApplication.processID == NSProcessInfo.processInfo.processIdentifier &&
                [window.title isEqualToString:@"Misty cursor"])
              [excluded addObject:window];
          }
          SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:target excludingWindows:excluded];
          SCStreamConfiguration *config = [SCStreamConfiguration new];
          double scale = MIN(2.0, 2000.0 / MAX(target.width, target.height));
          config.width = MAX(1, (size_t)(target.width * scale));
          config.height = MAX(1, (size_t)(target.height * scale));
          config.minimumFrameInterval = CMTimeMake(1, 5);
          config.queueDepth = 3;
          config.pixelFormat = kCVPixelFormatType_32BGRA;
          config.showsCursor = NO;
          config.capturesAudio = NO;
          SCStream *stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:owner];
          NSError *outputError;
          if (![stream addStreamOutput:owner type:SCStreamOutputTypeScreen
                sampleHandlerQueue:dispatch_queue_create("misty.desktop.frames", DISPATCH_QUEUE_SERIAL) error:&outputError]) {
            [owner stream:stream didStopWithError:outputError]; return;
          }
          [owner.condition lock];
          if (owner.stopped) { [owner.condition unlock]; return; }
          owner.stream = stream;
          [stream startCaptureWithCompletionHandler:^(NSError *failure) {
            if (failure) [owner stream:stream didStopWithError:failure];
            [owner.condition lock];
            BOOL stopped = owner.stopped;
            [owner.condition unlock];
            if (stopped) [stream stopCaptureWithCompletionHandler:^(NSError *ignored) { (void)ignored; }];
          }];
          [owner.condition unlock];
        }];
    }
    [owner.condition lock];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:6];
    while ((!owner.jpeg || owner.capturedAt < after) && !owner.failure && !owner.stopped) {
      if (![owner.condition waitUntilDate:deadline]) break;
    }
    NSDictionary *result;
    if (owner.stopped || owner.failure || !owner.jpeg || owner.capturedAt < after) {
      result = @{@"error": owner.failure.localizedDescription ?: (owner.stopped ? @"Desktop control stopped." : @"ScreenCaptureKit did not produce a frame.")};
    } else {
      result = @{@"dataUrl": [@"data:image/jpeg;base64," stringByAppendingString:[owner.jpeg base64EncodedStringWithOptions:0]],
        @"width": @(owner.width), @"height": @(owner.height), @"sequence": @(owner.sequence),
        @"capturedAt": @(owner.capturedAt * 1000), @"source": @"screencapturekit-stream"};
    }
    [owner.condition unlock];
    return result;
  }
  return @{@"error": @"Desktop control requires macOS 14 or later."};
}

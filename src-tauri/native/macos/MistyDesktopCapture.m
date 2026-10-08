#import "MistyDesktopCapture.h"
#import "MistyAgentRing.h"
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
// The display's own audio, mono 16-bit PCM, as a rolling buffer in memory.
@property NSMutableData *audio;
@property NSUInteger audioWrite;
@property BOOL audioWrapped;
@end

static const double audioRate = 16000;
static const NSUInteger audioCapacity = 30 * 16000 * sizeof(int16_t);

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
- (void)appendAudio:(CMSampleBufferRef)sample {
  const AudioStreamBasicDescription *format = CMAudioFormatDescriptionGetStreamBasicDescription(CMSampleBufferGetFormatDescription(sample));
  if (!format || !(format->mFormatFlags & kAudioFormatFlagIsFloat) || format->mBitsPerChannel != 32) return;
  BOOL interleaved = !(format->mFormatFlags & kAudioFormatFlagIsNonInterleaved);
  UInt32 channels = MAX(1, format->mChannelsPerFrame);
  size_t listSize = 0;
  CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, &listSize, NULL, 0, NULL, NULL, 0, NULL);
  if (!listSize) return;
  AudioBufferList *list = malloc(listSize);
  CMBlockBufferRef block = NULL;
  if (CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, NULL, list, listSize, NULL, NULL,
        kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, &block) == noErr && list->mNumberBuffers) {
    const float *samples = list->mBuffers[0].mData;
    UInt32 stride = interleaved ? channels : 1;
    NSUInteger frames = list->mBuffers[0].mDataByteSize / sizeof(float) / stride;
    NSMutableData *pcm = [NSMutableData dataWithLength:frames * sizeof(int16_t)];
    int16_t *out = pcm.mutableBytes;
    for (NSUInteger i = 0; i < frames; i++) out[i] = (int16_t)(fmaxf(-1, fminf(1, samples[i * stride])) * 32767);
    [self.condition lock];
    if (!self.stopped) {
      if (!self.audio) self.audio = [NSMutableData dataWithLength:audioCapacity];
      const uint8_t *bytes = pcm.bytes;
      for (NSUInteger left = pcm.length; left;) {
        NSUInteger chunk = MIN(left, audioCapacity - self.audioWrite);
        memcpy((uint8_t *)self.audio.mutableBytes + self.audioWrite, bytes, chunk);
        bytes += chunk; left -= chunk;
        self.audioWrite = (self.audioWrite + chunk) % audioCapacity;
        if (!self.audioWrite) self.audioWrapped = YES;
      }
    }
    [self.condition unlock];
  }
  if (block) CFRelease(block);
  free(list);
}
- (NSData *)recentAudio:(NSTimeInterval)seconds {
  [self.condition lock];
  NSUInteger stored = !self.audio ? 0 : self.audioWrapped ? audioCapacity : self.audioWrite;
  NSUInteger length = MIN(stored, (NSUInteger)(MAX(0, seconds) * audioRate) * sizeof(int16_t));
  NSMutableData *pcm = [NSMutableData dataWithLength:length];
  NSUInteger start = (self.audioWrite + audioCapacity - length) % audioCapacity;
  NSUInteger first = MIN(length, audioCapacity - start);
  if (length) {
    memcpy(pcm.mutableBytes, (const uint8_t *)self.audio.bytes + start, first);
    memcpy((uint8_t *)pcm.mutableBytes + first, self.audio.bytes, length - first);
  }
  [self.condition unlock];
  if (!length) return nil;
  // A 44-byte WAV header: PCM, mono, 16-bit.
  uint32_t rate = (uint32_t)audioRate, size = (uint32_t)length;
  NSMutableData *wav = [NSMutableData dataWithCapacity:44 + length];
  uint32_t riff = 36 + size, fmtSize = 16, byteRate = rate * 2, dataSize = size;
  uint16_t pcmFormat = 1, mono = 1, align = 2, bits = 16;
  [wav appendBytes:"RIFF" length:4]; [wav appendBytes:&riff length:4]; [wav appendBytes:"WAVEfmt " length:8];
  [wav appendBytes:&fmtSize length:4]; [wav appendBytes:&pcmFormat length:2]; [wav appendBytes:&mono length:2];
  [wav appendBytes:&rate length:4]; [wav appendBytes:&byteRate length:4]; [wav appendBytes:&align length:2];
  [wav appendBytes:&bits length:2]; [wav appendBytes:"data" length:4]; [wav appendBytes:&dataSize length:4];
  [wav appendData:pcm];
  return wav;
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
  if (!CMSampleBufferIsValid(sample)) return;
  if (type == SCStreamOutputTypeAudio) { [self appendAudio:sample]; return; }
  if (type != SCStreamOutputTypeScreen) return;
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
  self.audio = nil;
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
                ([window.title isEqualToString:@"Misty cursor"] || [window.title isEqualToString:MistyAgentRingTitle]))
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
          // The display's audio (games, calls, videos); never Misty's own.
          config.capturesAudio = YES;
          config.sampleRate = (NSInteger)audioRate;
          config.channelCount = 1;
          config.excludesCurrentProcessAudio = YES;
          SCStream *stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:owner];
          NSError *outputError;
          if (![stream addStreamOutput:owner type:SCStreamOutputTypeScreen
                sampleHandlerQueue:dispatch_queue_create("misty.desktop.frames", DISPATCH_QUEUE_SERIAL) error:&outputError]) {
            [owner stream:stream didStopWithError:outputError]; return;
          }
          // Frames still flow if audio cannot be added.
          [stream addStreamOutput:owner type:SCStreamOutputTypeAudio
            sampleHandlerQueue:dispatch_queue_create("misty.desktop.audio", DISPATCH_QUEUE_SERIAL) error:nil];
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

NSData *MistyDesktopRecentAudio(NSTimeInterval seconds) {
  if (@available(macOS 14.0, *)) {
    MistyDesktopStream *owner;
    @synchronized(streamLock()) { owner = activeStream; }
    return [owner recentAudio:seconds];
  }
  return nil;
}

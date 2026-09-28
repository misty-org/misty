// Screen recording the person starts: one display through ScreenCaptureKit,
// written as H.264 video with AAC audio to an .mp4 file by AVAssetWriter.
// System audio excludes Misty's own sound. The microphone is a second audio
// track on macOS 15 and later. Nothing here starts on its own.
#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <stdbool.h>

API_AVAILABLE(macos(13.0))
@interface MistyScreenRecorder : NSObject <SCStreamOutput, SCStreamDelegate>
@property SCStream *stream;
@property AVAssetWriter *writer;
@property AVAssetWriterInput *video;
@property AVAssetWriterInput *audio;
@property AVAssetWriterInput *microphone;
@property dispatch_queue_t queue;
@property BOOL sessionStarted;
@property CMTime firstTime;
@property CMTime lastTime;
@property NSError *failure;
@end

@implementation MistyScreenRecorder
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
  @synchronized(self) { self.failure = error; }
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
  if (!CMSampleBufferIsValid(sample) || self.writer.status == AVAssetWriterStatusFailed) return;
  CMTime time = CMSampleBufferGetPresentationTimeStamp(sample);
  if (type == SCStreamOutputTypeScreen) {
    NSArray *attachments = (__bridge NSArray *)CMSampleBufferGetSampleAttachmentsArray(sample, NO);
    NSNumber *status = attachments.firstObject[SCStreamFrameInfoStatus];
    // Idle frames repeat the last picture; the file holds it until the next one.
    if (status.integerValue != SCFrameStatusComplete) return;
    if (!self.sessionStarted) {
      [self.writer startSessionAtSourceTime:time];
      self.sessionStarted = YES;
      self.firstTime = time;
    }
    if (self.video.readyForMoreMediaData) [self.video appendSampleBuffer:sample];
    self.lastTime = time;
    return;
  }
  // Audio before the first picture would start the file on a black frame.
  if (!self.sessionStarted) return;
  AVAssetWriterInput *input = type == SCStreamOutputTypeAudio ? self.audio : nil;
  if (@available(macOS 15.0, *)) {
    if (type == SCStreamOutputTypeMicrophone) input = self.microphone;
  }
  if (input.readyForMoreMediaData) [input appendSampleBuffer:sample];
}
@end

static MistyScreenRecorder *activeRecorder API_AVAILABLE(macos(13.0));

static int32_t fail(char *error, size_t length, NSString *message) {
  if (error && length) strlcpy(error, message.UTF8String ?: "Recording failed.", length);
  return 1;
}

static AVAssetWriterInput *audioInput(void) {
  AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio outputSettings:@{
    AVFormatIDKey: @(kAudioFormatMPEG4AAC), AVSampleRateKey: @48000, AVNumberOfChannelsKey: @2, AVEncoderBitRateKey: @128000,
  }];
  input.expectsMediaDataInRealTime = YES;
  return input;
}

int32_t MistyScreenRecordStart(const char *path, uint32_t displayID, bool microphone, char *error, size_t errorLength) {
  if (@available(macOS 13.0, *)) {
    @synchronized([MistyScreenRecorder class]) {
      if (activeRecorder) return fail(error, errorLength, @"A recording is already running.");
    }
    if (!CGPreflightScreenCaptureAccess()) {
      CGRequestScreenCaptureAccess();
      return fail(error, errorLength, @"Allow Screen Recording for Misty in System Settings, then try again.");
    }
    __block SCShareableContent *content = nil;
    __block NSError *contentError = nil;
    dispatch_semaphore_t ready = dispatch_semaphore_create(0);
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:YES
                                                 completionHandler:^(SCShareableContent *shareable, NSError *failure) {
      content = shareable;
      contentError = failure;
      dispatch_semaphore_signal(ready);
    }];
    if (dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) || !content)
      return fail(error, errorLength, contentError.localizedDescription ?: @"The screen couldn't be read.");
    SCDisplay *display = nil;
    for (SCDisplay *candidate in content.displays)
      if (candidate.displayID == displayID || (!displayID && candidate.displayID == CGMainDisplayID())) display = candidate;
    if (!display) return fail(error, errorLength, @"That display isn't connected.");

    size_t width = CGDisplayPixelsWide(display.displayID), height = CGDisplayPixelsHigh(display.displayID);
    CGDisplayModeRef mode = CGDisplayCopyDisplayMode(display.displayID);
    if (mode) {
      width = CGDisplayModeGetPixelWidth(mode);
      height = CGDisplayModeGetPixelHeight(mode);
      CGDisplayModeRelease(mode);
    }
    // H.264 needs even sizes; very large displays are scaled to 4K wide.
    if (width > 3840) {
      height = height * 3840 / width;
      width = 3840;
    }
    width &= ~(size_t)1;
    height &= ~(size_t)1;

    NSError *writerError = nil;
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
    MistyScreenRecorder *recorder = [MistyScreenRecorder new];
    recorder.writer = [AVAssetWriter assetWriterWithURL:url fileType:AVFileTypeMPEG4 error:&writerError];
    if (!recorder.writer) return fail(error, errorLength, writerError.localizedDescription ?: @"The recording file couldn't be made.");
    recorder.video = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:@{
      AVVideoCodecKey: AVVideoCodecTypeH264, AVVideoWidthKey: @(width), AVVideoHeightKey: @(height),
      AVVideoCompressionPropertiesKey: @{AVVideoAverageBitRateKey: @(MIN(2500000, width * height)), AVVideoExpectedSourceFrameRateKey: @30},
    }];
    recorder.video.expectsMediaDataInRealTime = YES;
    recorder.audio = audioInput();
    [recorder.writer addInput:recorder.video];
    [recorder.writer addInput:recorder.audio];

    SCStreamConfiguration *config = [SCStreamConfiguration new];
    config.width = width;
    config.height = height;
    config.minimumFrameInterval = CMTimeMake(1, 30);
    config.queueDepth = 6;
    config.showsCursor = YES;
    config.capturesAudio = YES;
    config.excludesCurrentProcessAudio = YES;
    config.sampleRate = 48000;
    config.channelCount = 2;
    BOOL withMicrophone = NO;
    if (@available(macOS 15.0, *)) {
      if (microphone) {
        config.captureMicrophone = YES;
        recorder.microphone = audioInput();
        [recorder.writer addInput:recorder.microphone];
        withMicrophone = YES;
      }
    }
    if (![recorder.writer startWriting])
      return fail(error, errorLength, recorder.writer.error.localizedDescription ?: @"The recording file couldn't be made.");

    SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
    recorder.queue = dispatch_queue_create("misty.screen-recorder", DISPATCH_QUEUE_SERIAL);
    recorder.stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:recorder];
    NSError *outputError = nil;
    BOOL added = [recorder.stream addStreamOutput:recorder type:SCStreamOutputTypeScreen sampleHandlerQueue:recorder.queue error:&outputError] &&
                 [recorder.stream addStreamOutput:recorder type:SCStreamOutputTypeAudio sampleHandlerQueue:recorder.queue error:&outputError];
    if (@available(macOS 15.0, *)) {
      if (added && withMicrophone)
        added = [recorder.stream addStreamOutput:recorder type:SCStreamOutputTypeMicrophone sampleHandlerQueue:recorder.queue error:&outputError];
    }
    if (!added) {
      [recorder.writer cancelWriting];
      return fail(error, errorLength, outputError.localizedDescription ?: @"The screen couldn't be recorded.");
    }
    __block NSError *startError = nil;
    dispatch_semaphore_t started = dispatch_semaphore_create(0);
    [recorder.stream startCaptureWithCompletionHandler:^(NSError *failure) {
      startError = failure;
      dispatch_semaphore_signal(started);
    }];
    if (dispatch_semaphore_wait(started, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) || startError) {
      [recorder.writer cancelWriting];
      return fail(error, errorLength, startError.localizedDescription ?: @"The screen couldn't be recorded.");
    }
    @synchronized([MistyScreenRecorder class]) { activeRecorder = recorder; }
    return 0;
  }
  return fail(error, errorLength, @"Recording the screen needs macOS 13 or later.");
}

int32_t MistyScreenRecordStop(double *seconds, char *error, size_t errorLength) {
  if (@available(macOS 13.0, *)) {
    MistyScreenRecorder *recorder;
    @synchronized([MistyScreenRecorder class]) {
      recorder = activeRecorder;
      activeRecorder = nil;
    }
    if (!recorder) return fail(error, errorLength, @"Nothing is being recorded.");
    dispatch_semaphore_t stopped = dispatch_semaphore_create(0);
    [recorder.stream stopCaptureWithCompletionHandler:^(NSError *failure) { dispatch_semaphore_signal(stopped); }];
    dispatch_semaphore_wait(stopped, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    // Drain what the stream already queued before closing the file.
    dispatch_sync(recorder.queue, ^{});
    if (!recorder.sessionStarted) {
      [recorder.writer cancelWriting];
      return fail(error, errorLength, @"Nothing was recorded.");
    }
    [recorder.video markAsFinished];
    [recorder.audio markAsFinished];
    [recorder.microphone markAsFinished];
    [recorder.writer endSessionAtSourceTime:recorder.lastTime];
    dispatch_semaphore_t written = dispatch_semaphore_create(0);
    [recorder.writer finishWritingWithCompletionHandler:^{ dispatch_semaphore_signal(written); }];
    dispatch_semaphore_wait(written, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC));
    if (recorder.writer.status != AVAssetWriterStatusCompleted)
      return fail(error, errorLength, recorder.writer.error.localizedDescription ?: @"The recording couldn't be saved.");
    if (seconds) *seconds = CMTimeGetSeconds(CMTimeSubtract(recorder.lastTime, recorder.firstTime));
    return 0;
  }
  return fail(error, errorLength, @"Nothing is being recorded.");
}

bool MistyScreenRecording(void) {
  if (@available(macOS 13.0, *)) {
    @synchronized([MistyScreenRecorder class]) { return activeRecorder != nil; }
  }
  return false;
}

#import <Foundation/Foundation.h>

// Capture owns one live ScreenCaptureKit stream; pixels never go to disk.
FOUNDATION_EXPORT NSDictionary *MistyDesktopFrame(uint32_t displayID, NSTimeInterval after);
FOUNDATION_EXPORT void MistyDesktopCaptureStop(void);
// Up to the last 30 seconds of the captured display's audio as WAV, or nil.
FOUNDATION_EXPORT NSData *MistyDesktopRecentAudio(NSTimeInterval seconds);

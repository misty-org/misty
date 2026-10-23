#import <Foundation/Foundation.h>

// Capture owns one live ScreenCaptureKit stream; pixels never go to disk.
FOUNDATION_EXPORT NSDictionary *MistyDesktopFrame(uint32_t displayID, NSTimeInterval after);
FOUNDATION_EXPORT void MistyDesktopCaptureStop(void);

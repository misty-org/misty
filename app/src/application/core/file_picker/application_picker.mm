#ifdef __APPLE__

#include "application_picker.h"

#import <Cocoa/Cocoa.h>

namespace misty::core {

std::optional<std::string> ApplicationPicker::pick() {
    @autoreleasepool {
        NSOpenPanel* panel = [NSOpenPanel openPanel];
        [panel setCanChooseFiles:NO];
        [panel setCanChooseDirectories:YES];
        [panel setAllowsMultipleSelection:NO];
        [panel setCanCreateDirectories:NO];
        [panel setResolvesAliases:YES];
        [panel setTreatsFilePackagesAsDirectories:NO];
        [panel setTitle:@"Choose Application"];
        [panel setAllowedFileTypes:@[@"app"]];

        if ([panel runModal] == NSModalResponseOK) {
            NSURL* url = [[panel URLs] firstObject];
            if (url != nil) {
                return std::string([[[url path] stringByStandardizingPath] UTF8String]);
            }
        }
    }

    return std::nullopt;
}

} // namespace misty::core

#endif

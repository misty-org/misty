#ifdef __APPLE__

#include "application_picker.h"

#import <Cocoa/Cocoa.h>

namespace misty::core {

void ApplicationPicker::pick(std::function<void(std::optional<std::string>)> callback) {
    // Defer to the next main-queue drain (after the current ImGui frame finishes)
    // so runModal doesn't block mid-render. runModal runs its own NSModalPanelRunLoopMode
    // event loop, which is the only reliable way to drive NSOpenPanel in a GLFW app —
    // beginWithCompletionHandler: conflicts with GLFW's glfwPollEvents() run-loop usage.
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            NSOpenPanel* panel = [NSOpenPanel openPanel];
            // .app bundles are opaque packages (not directories), so file selection
            // must be enabled — directory selection alone cannot pick them.
            [panel setCanChooseFiles:YES];
            [panel setCanChooseDirectories:NO];
            [panel setAllowsMultipleSelection:NO];
            [panel setCanCreateDirectories:NO];
            [panel setResolvesAliases:YES];
            [panel setTreatsFilePackagesAsDirectories:NO];
            [panel setTitle:@"Choose Application"];
            [panel setAllowedFileTypes:@[@"app"]];
            [panel setDirectoryURL:[NSURL fileURLWithPath:@"/Applications"]];

            NSInteger result = [panel runModal];
            if (result == NSModalResponseOK) {
                NSURL* url = [[panel URLs] firstObject];
                if (url != nil) {
                    callback(std::string([[[url path] stringByStandardizingPath] UTF8String]));
                    return;
                }
            }
            callback(std::nullopt);
        }
    });
}

} // namespace misty::core

#endif

#import <Foundation/Foundation.h>
#include <stdlib.h>
#include <string.h>

char *misty_folder_bookmark_create(const char *path) {
    @autoreleasepool {
        NSURL *url = [NSURL fileURLWithPath:@(path) isDirectory:YES];
        NSData *data = [url bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope
                    includingResourceValuesForKeys:nil relativeToURL:nil error:nil];
        return data ? strdup([[data base64EncodedStringWithOptions:0] UTF8String]) : NULL;
    }
}
// Resolution never presents UI. The caller retains the scope for the grant lifetime.
void *misty_folder_bookmark_open(const char *encoded, char **path) {
    @autoreleasepool {
        NSData *data = [[NSData alloc] initWithBase64EncodedString:@(encoded) options:0];
        if (!data) return NULL;
        BOOL stale = NO;
        NSURL *url = [NSURL URLByResolvingBookmarkData:data
            options:NSURLBookmarkResolutionWithSecurityScope | NSURLBookmarkResolutionWithoutUI
            relativeToURL:nil bookmarkDataIsStale:&stale error:nil];
        if (!url || !url.isFileURL) return NULL;
        // Unsandboxed builds may return NO because access is already available.
        BOOL active = [url startAccessingSecurityScopedResource];
        *path = strdup(url.fileSystemRepresentation);
        if (!*path) { if (active) [url stopAccessingSecurityScopedResource]; return NULL; }
        return (__bridge_retained void *)@[url, @(active)];
    }
}
void misty_folder_bookmark_close(void *scope) {
    @autoreleasepool {
        NSArray *lease = (__bridge_transfer NSArray *)scope;
        if ([lease[1] boolValue]) [lease[0] stopAccessingSecurityScopedResource];
    }
}

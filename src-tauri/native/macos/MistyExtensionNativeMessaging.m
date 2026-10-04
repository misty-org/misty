// SPDX-License-Identifier: MIT
#import "MistyExtensionNativeMessaging.h"
#include <sys/stat.h>
#include <signal.h>

static NSError *NativeError(NSString *message) { return [NSError errorWithDomain:@"MistyNativeMessaging" code:1 userInfo:@{NSLocalizedDescriptionKey:message}]; }
@interface MistyExtensionNativeMessaging ()
@property NSTask *task;
@property NSFileHandle *input;
@property NSFileHandle *output;
@property dispatch_queue_t writes;
@property (copy) void (^handler)(id, NSError *);
@end
@implementation MistyExtensionNativeMessaging
+ (instancetype)connect:(NSString *)name extension:(NSString *)identifier error:(NSError **)error {
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[a-z0-9_]+(?:\\.[a-z0-9_]+)*$" options:0 error:nil];
    if (!name || name.length > 255 || [pattern numberOfMatchesInString:name options:0 range:NSMakeRange(0,name.length)] != 1) { *error = NativeError(@"Invalid native application name."); return nil; }
    NSString *relative = [@"Mozilla/NativeMessagingHosts/" stringByAppendingString:[name stringByAppendingString:@".json"]];
    NSArray *roots = @[[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support"], @"/Library/Application Support"];
    NSString *manifestPath; NSDictionary *manifest;
    for (NSString *root in roots) {
        NSString *candidate = [root stringByAppendingPathComponent:relative];
        if (![NSFileManager.defaultManager fileExistsAtPath:candidate]) continue;
        NSData *data = [NSData dataWithContentsOfFile:candidate];
        if (!data || data.length > 1024 * 1024) break;
        id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([parsed isKindOfClass:NSDictionary.class]) { manifest = parsed; manifestPath = candidate; }
        break;
    }
    if (!manifest) { *error = NativeError(@"Install this extension's companion application to use native messaging."); return nil; }
    NSString *path = manifest[@"path"];
    if (![manifest[@"name"] isEqual:name] || ![manifest[@"type"] isEqual:@"stdio"] || ![manifest[@"allowed_extensions"] isKindOfClass:NSArray.class] || ![manifest[@"allowed_extensions"] containsObject:identifier] || ![path isKindOfClass:NSString.class] || !path.isAbsolutePath || ![NSFileManager.defaultManager isExecutableFileAtPath:path]) { *error = NativeError(@"The native application does not authorize this extension."); return nil; }
    struct stat info;
    if (stat(path.fileSystemRepresentation,&info) != 0 || !S_ISREG(info.st_mode)) { *error = NativeError(@"The native application executable is invalid."); return nil; }
    MistyExtensionNativeMessaging *connection = [self new];
    connection.writes = dispatch_queue_create("com.misty.extensions.native-messaging",DISPATCH_QUEUE_SERIAL);
    connection.task = [NSTask new]; connection.task.executableURL = [NSURL fileURLWithPath:path];
    connection.task.arguments = @[manifestPath, identifier];
    NSPipe *input = [NSPipe pipe], *output = [NSPipe pipe];
    connection.task.standardInput = input; connection.task.standardOutput = output;
    connection.task.standardError = [NSFileHandle fileHandleWithNullDevice];
    connection.input = input.fileHandleForWriting; connection.output = output.fileHandleForReading;
    if (![connection.task launchAndReturnError:error]) return nil;
    return connection;
}
- (void)send:(id)message {
    NSData *json = [NSJSONSerialization dataWithJSONObject:message options:NSJSONWritingFragmentsAllowed error:nil];
    if (!json || json.length > 1024 * 1024) { if (self.handler) self.handler(nil,NativeError(@"Native message exceeds the 1 MiB limit.")); [self stop]; return; }
    uint32_t size = (uint32_t)json.length;
    NSMutableData *packet = [NSMutableData dataWithBytes:&size length:4]; [packet appendData:json];
    dispatch_async(self.writes, ^{
        NSError *error;
        if (![self.input writeData:packet error:&error]) { dispatch_async(dispatch_get_main_queue(), ^{ if (self.handler) self.handler(nil,NativeError(@"The native application disconnected.")); [self stop]; }); }
    });
}
- (NSData *)readExactly:(NSUInteger)count {
    NSMutableData *result = [NSMutableData data];
    while (result.length < count) {
        NSData *part = [self.output readDataUpToLength:count-result.length error:nil];
        if (!part.length) return nil;
        [result appendData:part];
    }
    return result;
}
- (void)receive:(void (^)(id, NSError *))handler {
    self.handler = handler;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0), ^{
        while (YES) {
            NSData *header = [self readExactly:4]; if (!header) break;
            uint32_t length; [header getBytes:&length length:4];
            if (length > 1024 * 1024) break;
            NSData *data = [self readExactly:length]; if (!data) break;
            id message = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil];
            if (!message) break;
            dispatch_async(dispatch_get_main_queue(), ^{ if (self.handler) self.handler(message,nil); });
        }
        dispatch_async(dispatch_get_main_queue(), ^{ if (self.handler) self.handler(nil,NativeError(@"The native application disconnected or returned an invalid message.")); [self stop]; });
    });
}
- (void)stop {
    self.handler = nil;
    [self.input closeAndReturnError:nil]; [self.output closeAndReturnError:nil];
    NSTask *task=self.task;
    if (task.running) {
        [task terminate];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,2*NSEC_PER_SEC),dispatch_get_main_queue(),^{ if (task.running) kill(task.processIdentifier,SIGKILL); });
    }
}
@end

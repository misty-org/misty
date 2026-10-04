// SPDX-License-Identifier: MIT
// browser.notifications through UNUserNotificationCenter. Misty's own app
// notifications go through NSUserNotification (notify-rust), so this center's
// delegate is free for extension clicks, buttons and dismissals.
#import "MistyExtensionsInternal.h"
#import <UserNotifications/UserNotifications.h>

static NSString *const ExtensionKey = @"mistyExtension";
static NSString *const NameKey = @"mistyNotification";

API_AVAILABLE(macos(15.4))
@interface MistyExtensionNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@property (weak) MistyExtensionHost *host;
@end

API_AVAILABLE(macos(15.4)) static MistyExtensionNotificationDelegate *notificationDelegate;
static NSMutableDictionary<NSString *, NSDictionary *> *notificationOptions;
static NSMutableSet<UNNotificationCategory *> *notificationCategories;

static NSString *NotificationIdentifier(NSString *extension, NSString *name) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:@[extension, name] options:0 error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

@implementation MistyExtensionNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))done {
    NSDictionary *info = notification.request.content.userInfo;
    if (!info[ExtensionKey]) { done(UNNotificationPresentationOptionNone); return; }
    // Extension notifications show while Misty is in front, as in Firefox.
    done(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | ([info[@"silent"] boolValue] ? 0 : UNNotificationPresentationOptionSound));
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center didReceiveNotificationResponse:(UNNotificationResponse *)response withCompletionHandler:(void (^)(void))done {
    NSDictionary *info = response.notification.request.content.userInfo;
    NSString *extension = info[ExtensionKey], *name = info[NameKey];
    MistyExtensionHost *host = self.host;
    if (host && [extension isKindOfClass:NSString.class] && [name isKindOfClass:NSString.class]) {
        NSString *action = response.actionIdentifier;
        if ([action isEqual:UNNotificationDefaultActionIdentifier]) [host deliverCompatEvent:@"notifications.onClicked" args:@[name] to:extension];
        else if ([action isEqual:UNNotificationDismissActionIdentifier]) {
            [notificationOptions removeObjectForKey:response.notification.request.identifier];
            [host deliverCompatEvent:@"notifications.onClosed" args:@[name, @YES] to:extension];
        } else if ([action hasPrefix:@"button-"]) [host deliverCompatEvent:@"notifications.onButtonClicked" args:@[name, @([action substringFromIndex:7].integerValue)] to:extension];
    }
    done();
}
@end

@implementation MistyExtensionHost (Notifications)
/// UserNotifications requires a bundled app; `misty dev` runs a bare binary.
- (UNUserNotificationCenter *)notificationCenter {
    if (!NSBundle.mainBundle.bundleIdentifier || ![NSBundle.mainBundle.bundlePath hasSuffix:@".app"]) return nil;
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    if (!notificationDelegate) {
        if (center.delegate) return nil;
        notificationDelegate = [MistyExtensionNotificationDelegate new];
        notificationOptions = [NSMutableDictionary dictionary];
        notificationCategories = [NSMutableSet set];
        center.delegate = notificationDelegate;
    }
    notificationDelegate.host = self;
    return center.delegate == notificationDelegate ? center : nil;
}

- (BOOL)handleNotification:(NSString *)method args:(NSArray *)args identifier:(NSString *)identifier reply:(void (^)(id, NSString *))reply {
    UNUserNotificationCenter *center = [self notificationCenter];
    if (!center) return NO;
    NSString *name = [args.firstObject isKindOfClass:NSString.class] ? args.firstObject : @"";
    NSString *key = NotificationIdentifier(identifier, name);
    if ([method isEqual:@"notifications.create"] || [method isEqual:@"notifications.update"]) {
        NSDictionary *given = args.count > 1 && [args[1] isKindOfClass:NSDictionary.class] ? args[1] : @{};
        BOOL update = [method isEqual:@"notifications.update"];
        if (update && !notificationOptions[key]) { reply(@NO, nil); return YES; }
        NSMutableDictionary *options = [(update ? notificationOptions[key] : @{}) mutableCopy];
        [options addEntriesFromDictionary:given];
        [self post:options name:name key:key identifier:identifier center:center reply:^(NSString *failure) {
            if (failure) { reply(nil, failure); return; }
            notificationOptions[key] = options;
            if (!update) [self deliverCompatEvent:@"notifications.onShown" args:@[name] to:identifier];
            reply(update ? @YES : NSNull.null, nil);
        }];
        return YES;
    }
    if ([method isEqual:@"notifications.clear"]) {
        BOOL existed = notificationOptions[key] != nil;
        [notificationOptions removeObjectForKey:key];
        [center removeDeliveredNotificationsWithIdentifiers:@[key]];
        [center removePendingNotificationRequestsWithIdentifiers:@[key]];
        if (existed) [self deliverCompatEvent:@"notifications.onClosed" args:@[name, @NO] to:identifier];
        reply(@(existed), nil);
        return YES;
    }
    if ([method isEqual:@"notifications.getAll"]) {
        [center getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *delivered) {
            NSMutableDictionary *all = [NSMutableDictionary dictionary];
            for (UNNotification *notification in delivered) {
                NSDictionary *info = notification.request.content.userInfo;
                if ([info[ExtensionKey] isEqual:identifier] && [info[NameKey] isKindOfClass:NSString.class]) all[info[NameKey]] = @YES;
            }
            dispatch_async(dispatch_get_main_queue(), ^{ reply(all, nil); });
        }];
        return YES;
    }
    return NO;
}

- (void)post:(NSDictionary *)options name:(NSString *)name key:(NSString *)key identifier:(NSString *)identifier center:(UNUserNotificationCenter *)center reply:(void (^)(NSString *))reply {
    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    NSString *(^text)(NSString *, NSUInteger) = ^NSString *(NSString *field, NSUInteger limit) {
        id value = options[field];
        return [value isKindOfClass:NSString.class] ? [value substringToIndex:MIN([value length], limit)] : @"";
    };
    content.title = text(@"title", 256);
    content.subtitle = text(@"contextMessage", 256);
    NSMutableArray *lines = [NSMutableArray arrayWithObject:text(@"message", 2048)];
    if ([options[@"items"] isKindOfClass:NSArray.class]) {
        for (NSDictionary *item in options[@"items"]) {
            if (![item isKindOfClass:NSDictionary.class]) continue;
            [lines addObject:[NSString stringWithFormat:@"%@ %@", item[@"title"] ?: @"", item[@"message"] ?: @""]];
        }
    }
    content.body = [[lines filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]] componentsJoinedByString:@"\n"];
    BOOL silent = [options[@"silent"] boolValue];
    if (!silent) content.sound = UNNotificationSound.defaultSound;
    content.userInfo = @{ExtensionKey:identifier, NameKey:name, @"silent":@(silent)};
    content.interruptionLevel = [options[@"requireInteraction"] boolValue] ? UNNotificationInterruptionLevelTimeSensitive : UNNotificationInterruptionLevelActive;
    content.categoryIdentifier = [self categoryFor:options center:center];
    UNNotificationAttachment *attachment = [self attachment:options[@"imageUrl"] ?: options[@"iconUrl"] identifier:identifier];
    if (attachment) content.attachments = @[attachment];
    UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:key content:content trigger:nil];
    [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound completionHandler:^(BOOL granted, NSError *error) {
        (void)error;
        if (!granted) { dispatch_async(dispatch_get_main_queue(), ^{ reply(@"Notifications are turned off for Misty."); }); return; }
        [center addNotificationRequest:request withCompletionHandler:^(NSError *failure) {
            dispatch_async(dispatch_get_main_queue(), ^{ reply(failure ? @"The notification could not be shown." : nil); });
        }];
    }];
}

/// A category per set of button titles; buttons report their index.
- (NSString *)categoryFor:(NSDictionary *)options center:(UNUserNotificationCenter *)center {
    NSMutableArray *actions = [NSMutableArray array];
    NSArray *buttons = [options[@"buttons"] isKindOfClass:NSArray.class] ? options[@"buttons"] : @[];
    for (NSUInteger i = 0; i < MIN(buttons.count, 2); i++) {
        NSString *title = [buttons[i] isKindOfClass:NSDictionary.class] && [buttons[i][@"title"] isKindOfClass:NSString.class] ? buttons[i][@"title"] : @"";
        if (title.length) [actions addObject:[UNNotificationAction actionWithIdentifier:[NSString stringWithFormat:@"button-%lu", (unsigned long)i] title:[title substringToIndex:MIN(title.length, 64)] options:UNNotificationActionOptionForeground]];
    }
    NSString *identifier = [@"misty-extension-" stringByAppendingString:[[actions valueForKey:@"title"] componentsJoinedByString:@"\x1F"]];
    for (UNNotificationCategory *category in notificationCategories) if ([category.identifier isEqual:identifier]) return identifier;
    [notificationCategories addObject:[UNNotificationCategory categoryWithIdentifier:identifier actions:actions intentIdentifiers:@[] options:UNNotificationCategoryOptionCustomDismissAction]];
    [center setNotificationCategories:notificationCategories];
    return identifier;
}

/// Copies an extension image or data URL into a temporary file; the system
/// takes ownership of attachment files.
- (UNNotificationAttachment *)attachment:(id)source identifier:(NSString *)identifier {
    if (![source isKindOfClass:NSString.class] || ![source length]) return nil;
    NSString *root = self.descriptors[identifier][@"runtimePath"];
    NSData *data = nil;
    NSString *extension = @"png";
    if ([source hasPrefix:@"data:"]) {
        NSRange comma = [source rangeOfString:@","];
        if (comma.location == NSNotFound || ![[source substringToIndex:comma.location] hasSuffix:@";base64"]) return nil;
        data = [[NSData alloc] initWithBase64EncodedString:[source substringFromIndex:comma.location + 1] options:NSDataBase64DecodingIgnoreUnknownCharacters];
        if ([source hasPrefix:@"data:image/jpeg"]) extension = @"jpg";
        else if ([source hasPrefix:@"data:image/gif"]) extension = @"gif";
    } else if ([root isKindOfClass:NSString.class]) {
        NSURL *url = [NSURL URLWithString:source];
        NSString *path = [url.scheme isEqual:@"webkit-extension"] ? url.path : url.scheme ? nil : [source componentsSeparatedByString:@"?"].firstObject;
        if (!path) return nil;
        NSString *file = [[root stringByAppendingPathComponent:path] stringByStandardizingPath];
        // Only the extension's own files.
        if (![file hasPrefix:[[root stringByStandardizingPath] stringByAppendingString:@"/"]]) return nil;
        data = [NSData dataWithContentsOfFile:file];
        if (file.pathExtension.length) extension = file.pathExtension;
    }
    if (!data.length || data.length > 10 * 1024 * 1024) return nil;
    NSString *copy = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"misty-notification-%@.%@", NSUUID.UUID.UUIDString, extension]];
    if (![data writeToFile:copy atomically:YES]) return nil;
    return [UNNotificationAttachment attachmentWithIdentifier:@"image" URL:[NSURL fileURLWithPath:copy] options:nil error:nil];
}
@end

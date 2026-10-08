#import <AppKit/AppKit.h>
#import <objc/runtime.h>

// The Dock menu lists the account's Spaces, with a checkmark beside each one that has a
// window open; choosing one opens or focuses its window. Tauri has no Dock menu, so the
// app delegate learns `applicationDockMenu:` here.

typedef void (*MistySpaceDockChoice)(const char *key);

static NSMenu *dockMenu;
static MistySpaceDockChoice choice;

@interface MistySpaceDockTarget : NSObject
@end

@implementation MistySpaceDockTarget
- (void)open:(NSMenuItem *)item {
    NSString *key = item.representedObject;
    if (choice && [key isKindOfClass:NSString.class]) choice(key.UTF8String);
}
@end

static MistySpaceDockTarget *target;

static NSMenu *misty_application_dock_menu(id __unused self, SEL __unused _cmd, NSApplication *__unused app) {
    return dockMenu;
}

// Installs the Dock menu once; `callback` runs on the main thread with the chosen key.
void misty_space_dock_install(MistySpaceDockChoice callback) {
    dispatch_async(dispatch_get_main_queue(), ^{
        choice = callback;
        if (!target) target = [MistySpaceDockTarget new];
        if (!dockMenu) dockMenu = [[NSMenu alloc] initWithTitle:@"Spaces"];
        id delegate = NSApp.delegate;
        if (!delegate) return;
        Class cls = object_getClass(delegate);
        SEL selector = @selector(applicationDockMenu:);
        if (!class_respondsToSelector(cls, selector)) {
            class_addMethod(cls, selector, (IMP)misty_application_dock_menu, "@@:@");
        }
    });
}

// Replaces the Spaces listed. `json` is an array of {"key","name","open"}.
void misty_space_dock_set(const char *json) {
    if (!json) return;
    NSData *data = [NSData dataWithBytes:json length:strlen(json)];
    dispatch_async(dispatch_get_main_queue(), ^{
        NSArray *spaces = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![spaces isKindOfClass:NSArray.class]) return;
        if (!target) target = [MistySpaceDockTarget new];
        if (!dockMenu) dockMenu = [[NSMenu alloc] initWithTitle:@"Spaces"];
        [dockMenu removeAllItems];
        for (NSDictionary *space in spaces) {
            if (![space isKindOfClass:NSDictionary.class]) continue;
            NSString *key = space[@"key"];
            NSString *name = space[@"name"];
            if (![key isKindOfClass:NSString.class] || ![name isKindOfClass:NSString.class]) continue;
            NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:name
                                                          action:@selector(open:)
                                                   keyEquivalent:@""];
            item.target = target;
            item.representedObject = key;
            item.state = [space[@"open"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
            [dockMenu addItem:item];
        }
    });
}

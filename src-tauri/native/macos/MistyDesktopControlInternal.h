// Declarations shared by desktop control (MistyDesktopControl.m) and its
// control island (MistyDesktopIsland.m). All of it runs on the main queue.
#import <AppKit/AppKit.h>

// The task that holds the desktop, or nil.
NSString *MistyDesktopTask(void);
// Ends control; a reason is announced to Misty once.
void stopControl(NSString *reason);
// A malloc'd JSON string the caller frees.
char *DesktopJSON(NSDictionary *value);

// Forgets the island's text and sets where its presses go, for a new task.
void islandReset(void (*island)(const char *));
// What Misty's island shows; nil falls back to the default text.
void islandSetText(NSString *status, NSString *meta, NSString *waiting);
// The island panel on `display`, built once per control session.
NSPanel *islandPanel(CGRect display);
// Working (field and buttons) or waiting for the person (Done).
void islandMode(BOOL waiting);

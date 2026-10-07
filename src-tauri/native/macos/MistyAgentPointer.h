#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

// Marks input Misty sends, so its own Escape never reads as the person stopping it.
#define MistyAgentEventTag 0x4d49535459414754LL

// Misty's own desktop pointer and the Accessibility actions it performs.
// Coordinates are global display points with a top-left origin.
void misty_agent_pointer_move(double x, double y);
void misty_agent_pointer_hide(void);
NSDictionary *MistyAgentDesktopAction(NSDictionary *action, CGPoint point);

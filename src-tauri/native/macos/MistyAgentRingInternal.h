// Declarations shared by the control mist's implementation files.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import "MistyAgentRing.h"

// One mist view for the display, a page and a window. Two inner fogs: a bright
// one gray close to the edge and a wide darker-gray one that still reads on white
// pages. Each is the shadow of a shape that lies entirely outside the bounds,
// so only the shadow falls inward; the view clips to its own rounded corners.
@interface MistyAgentMistView : NSView
@property(nonatomic, strong) CAShapeLayer *near;
@property(nonatomic, strong) CAShapeLayer *wide;
// Set for a window or the display; a page mist follows its page's own corners.
@property(nonatomic, strong) NSNumber *radius;
- (void)build;
- (void)fit;
- (void)breathe;
@end

// A mist view filling `host`, above its other subviews.
MistyAgentMistView *MistyAgentMistIn(NSView *host, NSNumber *radius);
// Fades a mist's container in; the mist view itself keeps its waiting alpha.
void MistyAgentRingFadeIn(id target, CGFloat alpha);
// A click-through borderless panel that holds a mist.
NSPanel *MistyAgentRingPanel(NSRect frame);
void MistyAgentRingOnMain(void (^work)(void));

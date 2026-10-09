#import <CoreGraphics/CoreGraphics.h>

// Misty's control ring for desktop tasks: a frame around the display Misty
// controls and a pulse where it acts. Drawings only; they never take input,
// and desktop capture leaves them out so the agent sees the apps underneath.
// Rects and points are global display coordinates with a top-left origin.
#define MistyAgentRingTitle @"Misty control ring"
void misty_agent_ring_show(CGRect display);
void misty_agent_ring_pulse(CGPoint point);
void misty_agent_ring_hide(void);

// The same ring inside one browser page while an agent holds it. `view` is the
// page's WKWebView; the ring is its subview, so it follows the page's bounds
// and rounded corners. WebKit snapshots draw web content only, so the agent's
// captures never include it.
void misty_agent_page_ring(void *view, bool active);

// The same ring around a whole Misty window while an agent controls it. `view`
// is any view in that window. The ring is a click-through child panel, so it
// moves with the window, and window capture (one window only) leaves it out.
void misty_agent_window_ring(void *view, bool active);

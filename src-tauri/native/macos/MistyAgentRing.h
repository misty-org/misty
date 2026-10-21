#import <CoreGraphics/CoreGraphics.h>

// Misty's control mist: a soft white fog inside the edges of whatever an agent
// controls (docs/design/agents-at-cursor/BRIEF.md), and a pulse where it acts.
// Drawings only; they never take input, nothing is drawn outside the frame,
// and captures leave them out so the agent sees the content underneath.
// Rects and points are global display coordinates with a top-left origin.
#define MistyAgentRingTitle @"Misty control ring"
// The mist along the edges of the display Misty controls on the desktop.
void misty_agent_ring_show(CGRect display);
void misty_agent_ring_pulse(CGPoint point);
void misty_agent_ring_hide(void);

// The same mist inside one browser page while an agent holds it. `view` is the
// page's WKWebView; the mist is its subview, so it follows the page's bounds
// and rounded corners. WebKit snapshots draw web content only, so the agent's
// captures never include it.
void misty_agent_page_ring(void *view, bool active);

// The same mist inside a whole Misty window while an agent controls it. `view`
// is any view in that window. The mist is a click-through child panel, so it
// moves with the window, and window capture (one window only) leaves it out.
void misty_agent_window_ring(void *view, bool active);

// While an agent waits for the person (a sign-in, a code), every mist thins
// instead of disappearing: the task still holds the screen, the person acts.
void misty_agent_mist_waiting(bool waiting);

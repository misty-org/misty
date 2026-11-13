import { ChevronLeft, ChevronRight, PictureInPicture, X } from "lucide-react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { FloatingPip, IconButton, type PipCorner } from "@/shared/ui";
import { closeAgentBrowser, showView, useAgentBrowser } from "./agentBrowserStore";

const corners: readonly PipCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** Where the picture rests, kept for this device like the system's own picture-in-picture. A
 * device setting, so a corner dragged to before the stored one is read is the one that stays. */
const usePipCorner = createDeviceSetting<{ corner: PipCorner }>({
  scope: "agents/browser-pip",
  defaults: { corner: "top-right" },
  normalize: (stored) => {
    const corner = (stored as { corner?: unknown } | null)?.corner;
    return { corner: corners.includes(corner as PipCorner) ? (corner as PipCorner) : "top-right" };
  },
});

function rememberCorner(corner: PipCorner) {
  usePipCorner.getState().set((state) => ({ ...state, corner }));
}

/**
 * The open chat's agent browser as a picture-in-picture floating over the chat: a picture
 * refreshed after each step and each load, never a live page. A live page is a native view drawn
 * above the whole app, so in a frame this small it could not be clipped by the chat or covered by
 * a menu. It moves like the system's own: drag it anywhere and it settles in the nearest corner.
 * A press, the dock button, or letting go past the chat's right edge puts the browser back in its
 * panel beside the chat, where the agent works. With several views it flips between them; the
 * close button puts it away until the agent opens another page. A white ring breathes around it
 * while the agent works in the view it shows.
 */
export function AgentBrowserPip({
  conversationId,
  onDock,
}: {
  conversationId?: string;
  /** Puts the browser back in the chat's side panel. */
  onDock: () => void;
}) {
  const chat = useAgentBrowser((state) =>
    conversationId ? state.chats[conversationId] : undefined,
  );
  const corner = usePipCorner((state) => state.value.corner);
  // Only a browser the person detached floats here.
  if (!chat?.views.length || chat.hidden || chat.expanded || !chat.detached) return null;
  const index = Math.max(
    0,
    chat.views.findIndex((view) => view.id === chat.shownView),
  );
  const view = chat.views[index]!;
  const flip = (step: number) =>
    showView(
      chat.conversationId,
      chat.views[(index + step + chat.views.length) % chat.views.length]!.id,
    );
  const several = chat.views.length > 1;
  return (
    <FloatingPip
      label="Agent browser"
      openLabel="Back to the browser panel"
      picture={view.picture ? <img src={view.picture} alt="" draggable={false} /> : <span />}
      // The ring already says whether the agent is at work; only several views need a caption.
      caption={several ? `${index + 1} of ${chat.views.length}` : undefined}
      active={view.status === "working"}
      corner={corner}
      onCornerChange={rememberCorner}
      onOpen={onDock}
      onDock={onDock}
      // Clear of the chat's header, which floats over the column's top.
      clearOf=".agent-conversation-heading, .agent-studio-bar"
      actions={
        <>
          {several ? (
            <>
              <IconButton label="Previous view" onClick={() => flip(-1)}>
                <ChevronLeft />
              </IconButton>
              <IconButton label="Next view" onClick={() => flip(1)}>
                <ChevronRight />
              </IconButton>
            </>
          ) : null}
          <IconButton label="Back to the browser panel" onClick={onDock}>
            <PictureInPicture />
          </IconButton>
          <IconButton
            label="Close the agent browser"
            onClick={() => closeAgentBrowser(chat.conversationId)}
          >
            <X />
          </IconButton>
        </>
      }
    />
  );
}

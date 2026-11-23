import { ChevronLeft, ChevronRight, PictureInPicture, X } from "lucide-react";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { FloatingPip, IconButton, type PipCorner } from "@misty/ui";
import { closeAgentBrowser, showView, useAgentBrowser } from "./agent_browser_store";

const corners: readonly PipCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

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

export function AgentBrowserPip({
  conversationId,
  onDock,
}: {
  conversationId?: string;
  onDock: () => void;
}) {
  const chat = useAgentBrowser((state) =>
    conversationId ? state.chats[conversationId] : undefined,
  );
  const corner = usePipCorner((state) => state.value.corner);
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
      caption={several ? `${index + 1} of ${chat.views.length}` : undefined}
      active={view.status === "working"}
      corner={corner}
      onCornerChange={rememberCorner}
      onOpen={onDock}
      onDock={onDock}
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

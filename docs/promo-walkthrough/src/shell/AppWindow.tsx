import type { AppState } from "../film/state";
import { AgentsView } from "../surfaces/agents/AgentsView";
import { BrowserView } from "../surfaces/browser/BrowserView";
import { ExplorerView } from "../surfaces/files/ExplorerView";
import { TransfersView } from "../surfaces/files/TransfersView";
import { HomeView } from "../surfaces/HomeView";
import { SpaceView } from "../surfaces/spaces/SpaceView";
import { SyncPopup } from "../surfaces/sync/SyncPopup";
import { Rail } from "./Rail";
import { TabStrip } from "./TabStrip";

function Content({ state }: { state: AppState }) {
  const tab = state.tabs.find((item) => item.id === state.active);
  if (!tab || state.empty) return <HomeView device={state.device} />;
  switch (tab.kind) {
    case "site":
      return state.browser ? <BrowserView state={state.browser} /> : null;
    case "space":
      return state.space ? <SpaceView state={state.space} /> : null;
    case "explorer":
      return <ExplorerView state={state.files ?? { location: "home" }} />;
    case "transfers":
      return <TransfersView state={state.files ?? { location: "home" }} />;
    case "agents":
      return <AgentsView state={state.agents ?? {}} />;
    default:
      return <HomeView device={state.device} />;
  }
}

/**
 * A macOS Misty window: native traffic lights over the merged titlebar, the
 * global navigator, the tab strip, and the bordered content panel.
 */
export function AppWindow(props: { state: AppState; width: number; height: number; windowId?: string }) {
  const { state, width, height } = props;
  return (
    <div
      data-window={props.windowId ?? state.device}
      className="app-pages-root relative overflow-hidden rounded-[12px] bg-[#101010] text-cream ring-1 ring-white/10"
      style={{ width, height, boxShadow: "0 40px 120px rgba(0,0,0,0.65), 0 8px 30px rgba(0,0,0,0.5)" }}
    >
      <div className="absolute left-[20px] top-[13px] z-40 flex gap-2">
        {[0, 1, 2].map((index) => (
          <span key={index} className="size-3 rounded-full bg-[#3b3b3b] ring-1 ring-black/40" />
        ))}
      </div>
      <Rail active={state.rail} height={height} pressed={state.pressed} />
      <TabStrip state={state} />
      <main
        className="absolute bottom-0 left-[54px] right-0 top-[38px] overflow-hidden rounded-tl-[10px] border-l border-t border-charcoal-border bg-[#101010]"
        data-t="content"
      >
        <Content state={state} />
      </main>
      {state.sync?.open && <SyncPopup state={state} height={height} />}
    </div>
  );
}

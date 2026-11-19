import { useAgentPanel } from "@opencut/media/agent-panel";
"use client";

import { Separator } from "@opencut/components/ui/separator";
import { type Tab, useAssetsPanelStore } from "@opencut/components/editor/panels/assets/assets-panel-store";
import { TabBar } from "./tabbar";
import { Captions } from "@opencut/subtitles/components/assets-view";
import { MediaView } from "./views/assets";
import { SettingsView } from "./views/settings";
import { SpaceSoundsView } from "@opencut/sounds/components/space-sounds-view";
import { StickersView } from "@opencut/stickers/components/assets-view";
import { AdjustmentView } from "@opencut/look/components/adjustment-view";
import { TransitionsView } from "@opencut/look/components/transitions-view";
import { TextView } from "@opencut/text/components/assets-view";
import { EffectsView } from "@opencut/effects/components/assets-view";

export function AssetsPanel() {
	const { activeTab } = useAssetsPanelStore();

	const viewMap: Record<Tab, React.ReactNode> = {
		agent: <AgentView />,
		media: <MediaView />,
		sounds: <SpaceSoundsView />,
		text: <TextView />,
		stickers: <StickersView />,
		effects: <EffectsView />,
		transitions: <TransitionsView />,
		captions: <Captions />,
		adjustment: <AdjustmentView />,
		settings: <SettingsView />,
	};

	return (
		<div className="panel bg-oc-background flex h-full rounded-sm border overflow-hidden">
			<TabBar />
			<Separator orientation="vertical" />
			<div className="flex-1 overflow-hidden">{viewMap[activeTab]}</div>
		</div>
	);
}

/** Misty: the Agent tab's chat, or Media when there is no agent for this video. */
function AgentView() {
	const panel = useAgentPanel();
	return panel ? <div className="flex h-full min-h-0 flex-col">{panel}</div> : <MediaView />;
}

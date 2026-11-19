// OpenCut's editor layout (apps/web/src/app/editor/[project_id]/page.tsx, MIT), as a component
// Misty mounts inside its own window: the media and tools panel, the preview and the properties
// side by side over the timeline, each pane resizable. Misty: the seams between panes are
// Misty's SplitHandle.
import { Panel, PanelGroup } from "react-resizable-panels";
import { SplitHandle } from "@/shared/ui";
import { AssetsPanel } from "@opencut/components/editor/panels/assets";
import { PropertiesPanel } from "@opencut/components/editor/panels/properties";
import { Timeline } from "@opencut/timeline/components";
import { PreviewPanel } from "@opencut/preview/components";
import { usePanelStore } from "@opencut/editor/panel-store";
import { usePasteMedia } from "@opencut/media/use-paste-media";
import { useMemo } from "react";
import { useEditor } from "@opencut/editor/use-editor";
import {
	createPreviewOverlayControl,
	isPreviewOverlayVisible,
	mergePreviewOverlaySources,
} from "@opencut/preview/overlays";
import { usePreviewStore } from "@opencut/preview/preview-store";
import { getGuidePreviewOverlaySource } from "@opencut/guides";
import {
	bookmarkNotesPreviewOverlay,
	getBookmarkPreviewOverlaySource,
} from "@opencut/timeline/bookmarks/index";

export function EditorLayout() {
	usePasteMedia();
	const { panels, setPanel } = usePanelStore();
	const activeScene = useEditor((editor) =>
		editor.scenes.getActiveSceneOrNull(),
	);
	const currentTime = useEditor((editor) => editor.playback.getCurrentTime());
	const activeGuide = usePreviewStore((state) => state.activeGuide);
	const overlays = usePreviewStore((state) => state.overlays);
	const setOverlayVisibility = usePreviewStore(
		(state) => state.setOverlayVisibility,
	);
	const showBookmarkNotes = isPreviewOverlayVisible({
		overlay: bookmarkNotesPreviewOverlay,
		overlays,
	});

	const overlaySource = useMemo(
		() =>
			mergePreviewOverlaySources({
				sources: [
					getGuidePreviewOverlaySource({
						guideId: activeGuide,
					}),
					activeScene
						? getBookmarkPreviewOverlaySource({
								bookmarks: activeScene.bookmarks,
								time: currentTime,
								isVisible: showBookmarkNotes,
							})
						: {
								definitions: [bookmarkNotesPreviewOverlay],
								instances: [],
							},
				],
			}),
		[activeGuide, activeScene, currentTime, showBookmarkNotes],
	);

	const overlayControls = useMemo(
		() =>
			overlaySource.definitions.map((overlay) =>
				createPreviewOverlayControl({ overlay, overlays }),
			),
		[overlaySource.definitions, overlays],
	);

	return (
		<PanelGroup
			direction="vertical"
			className="size-full"
			onLayout={(sizes) => {
				setPanel({
					panel: "mainContent",
					size: sizes[0] ?? panels.mainContent,
				});
				setPanel({
					panel: "timeline",
					size: sizes[1] ?? panels.timeline,
				});
			}}
		>
			<Panel
				defaultSize={panels.mainContent}
				minSize={30}
				maxSize={85}
				className="min-h-0"
			>
				<PanelGroup
					direction="horizontal"
					className="size-full px-3"
					onLayout={(sizes) => {
						setPanel({ panel: "tools", size: sizes[0] ?? panels.tools });
						setPanel({ panel: "preview", size: sizes[1] ?? panels.preview });
						setPanel({
							panel: "properties",
							size: sizes[2] ?? panels.properties,
						});
					}}
				>
					<Panel
						defaultSize={panels.tools}
						minSize={15}
						maxSize={40}
						className="min-w-0"
					>
						<AssetsPanel />
					</Panel>

					<SplitHandle direction="horizontal" label="Resize media and preview" />

					<Panel
						defaultSize={panels.preview}
						minSize={30}
						className="min-h-0 min-w-0 flex-1"
					>
						<PreviewPanel
							overlayControls={overlayControls}
							overlayInstances={overlaySource.instances}
							onOverlayVisibilityChange={setOverlayVisibility}
						/>
					</Panel>

					<SplitHandle direction="horizontal" label="Resize preview and properties" />

					<Panel
						defaultSize={panels.properties}
						minSize={15}
						maxSize={40}
						className="min-w-0"
					>
						<PropertiesPanel />
					</Panel>
				</PanelGroup>
			</Panel>

			<SplitHandle direction="vertical" label="Resize editor and timeline" />

			<Panel
				defaultSize={panels.timeline}
				minSize={15}
				maxSize={70}
				className="min-h-0 px-3 pb-3"
			>
				<Timeline />
			</Panel>
		</PanelGroup>
	);
}

// Misty: the left rail's Adjustment tab (empty in OpenCut): the color of the selected video or
// photo, through the same fields and keyframe toggles as the properties panel.
import { PanelView } from "@opencut/components/editor/panels/assets/views/base-panel";
import { ElementParamsTab } from "@opencut/components/editor/panels/properties/components/element-params-tab";
import { useEditor } from "@opencut/editor/use-editor";
import { useElementSelection } from "@opencut/timeline/hooks/element/use-element-selection";
import { ADJUST_KEYS } from "@opencut/look/adjust";

export function AdjustmentView() {
	const editor = useEditor();
	useEditor((e) => e.scenes.getActiveSceneOrNull());
	const { selectedElements } = useElementSelection();
	const [selected] = editor.timeline.getElementsWithTracks({ elements: selectedElements });
	const adjustable =
		selectedElements.length === 1 &&
		selected &&
		(selected.element.type === "video" || selected.element.type === "image");
	return (
		<PanelView title="Adjustment">
			{adjustable ? (
				<ElementParamsTab
					element={selected.element}
					trackId={selected.track.id}
					paramKeys={ADJUST_KEYS}
					sectionKey="adjust"
				/>
			) : (
				<p className="text-oc-muted-foreground px-1 pt-2 text-sm">
					Select a video or photo on the timeline to change its color.
				</p>
			)}
		</PanelView>
	);
}

// Misty: the left rail's Transitions tab (empty in OpenCut). Each transition can be set as how
// the selected clips come in or go out; their length is set in the properties panel.
import { Button } from "@opencut/components/ui/button";
import { PanelView } from "@opencut/components/editor/panels/assets/views/base-panel";
import { useEditor } from "@opencut/editor/use-editor";
import { useElementSelection } from "@opencut/timeline/hooks/element/use-element-selection";
import { TRANSITION_KINDS, type TransitionKind } from "@opencut/look/transitions";
import type { TimelineElement } from "@opencut/timeline";

type Side = "in" | "out";

function currentKind(element: TimelineElement, side: Side): string {
	const params = "params" in element ? element.params : {};
	const value = params[`transition.${side}`];
	return typeof value === "string" ? value : "none";
}

export function TransitionsView() {
	const editor = useEditor();
	useEditor((e) => e.scenes.getActiveSceneOrNull());
	const { selectedElements } = useElementSelection();
	const targets = editor.timeline
		.getElementsWithTracks({ elements: selectedElements })
		.filter(({ element }) => element.type !== "audio" && element.type !== "effect");

	const apply = (kind: TransitionKind, side: Side) =>
		editor.timeline.updateElements({
			updates: targets.map(({ element, track }) => ({
				trackId: track.id,
				elementId: element.id,
				patch: {
					params: {
						...("params" in element ? element.params : {}),
						[`transition.${side}`]: currentKind(element, side) === kind ? "none" : kind,
					},
				} as Partial<TimelineElement>,
			})),
		});

	const isSet = (kind: TransitionKind, side: Side) =>
		targets.length > 0 && targets.every(({ element }) => currentKind(element, side) === kind);

	return (
		<PanelView title="Transitions">
			{targets.length === 0 ? (
				<p className="text-oc-muted-foreground px-1 pt-2 text-sm">
					Select clips on the timeline to give them a way in or out.
				</p>
			) : (
				<div className="grid gap-3 pt-2">
					{TRANSITION_KINDS.filter(({ value }) => value !== "none").map(({ value, label }) => (
						<div key={value} role="group" aria-label={label} className="grid gap-1">
							<span className="text-sm">{label}</span>
							<div className="flex gap-1">
								{(["in", "out"] as const).map((side) => (
									<Button
										key={side}
										size="sm"
										variant={isSet(value, side) ? "secondary" : "ghost"}
										aria-pressed={isSet(value, side)}
										onClick={() => apply(value, side)}
									>
										{side === "in" ? "In" : "Out"}
									</Button>
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</PanelView>
	);
}

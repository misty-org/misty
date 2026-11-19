"use client";

// Misty: the Text tab's starter motion graphics. Each card shows a frame of its graphic and adds
// it to the timeline like any other graphic, by its plus or by dragging.
import { useEffect, useRef, useState } from "react";
import { DraggableItem } from "@opencut/components/editor/panels/assets/draggable-item";
import { useEditor } from "@opencut/editor/use-editor";
import { buildGraphicElement } from "@opencut/timeline/element-utils";
import type { MediaTime } from "@opencut/wasm";
import { MOTION_GRAPHIC_ID, drawMotionGraphic } from "../definition";
import { MOTION_PRESETS, type MotionPreset } from "../presets";
import { serializeMotionProps } from "../props";
import { isMotionRuntimeReady, loadMotionRuntime } from "../runtime";

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
/** The cards stand for a graphic over a video, so they draw it over a dark frame. */
const PREVIEW_BACKDROP = "#18181b";

function presetParams(preset: MotionPreset) {
	return { script: preset.script, props: serializeMotionProps(preset.props) };
}

export function MotionPresetItems() {
	const [ready, setReady] = useState(isMotionRuntimeReady());
	useEffect(() => {
		if (ready) return;
		let live = true;
		loadMotionRuntime().then(
			() => live && setReady(true),
			() => undefined,
		);
		return () => {
			live = false;
		};
	}, [ready]);

	return (
		<div className="flex flex-col gap-2 pt-4">
			<span className="text-oc-muted-foreground px-1 text-sm">Motion graphics</span>
			<div className="grid grid-cols-2 gap-2">
				{MOTION_PRESETS.map((preset) => (
					<MotionPresetItem key={preset.id} preset={preset} ready={ready} />
				))}
			</div>
		</div>
	);
}

function MotionPresetItem({ preset, ready }: { preset: MotionPreset; ready: boolean }) {
	const editor = useEditor();

	const handleAddToTimeline = ({ currentTime }: { currentTime: MediaTime }) => {
		editor.timeline.insertElement({
			element: buildGraphicElement({
				definitionId: MOTION_GRAPHIC_ID,
				name: preset.name,
				startTime: currentTime,
				params: presetParams(preset),
			}),
			placement: { mode: "auto" },
		});
	};

	// The card's own label cuts names short, so the name goes under it whole.
	return (
		<div className="flex flex-col gap-1">
			<DraggableItem
				name={preset.name}
				preview={<MotionPresetPreview preset={preset} ready={ready} />}
				dragData={{
					id: `motion:${preset.id}`,
					type: "graphic",
					name: preset.name,
					definitionId: MOTION_GRAPHIC_ID,
					params: presetParams(preset),
				}}
				aspectRatio={16 / 9}
				containerClassName="w-full"
				shouldShowLabel={false}
				onAddToTimeline={handleAddToTimeline}
			/>
			<span className="text-oc-muted-foreground px-1 text-xs">{preset.name}</span>
		</div>
	);
}

function MotionPresetPreview({ preset, ready }: { preset: MotionPreset; ready: boolean }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const ctx = canvasRef.current?.getContext("2d");
		if (!ready || !ctx) return;
		ctx.fillStyle = PREVIEW_BACKDROP;
		ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
		drawMotionGraphic({
			ctx,
			params: presetParams(preset),
			time: preset.previewTime,
			duration: preset.previewDuration,
			width: PREVIEW_WIDTH,
			height: PREVIEW_HEIGHT,
		});
	}, [preset, ready]);

	return (
		<canvas
			ref={canvasRef}
			width={PREVIEW_WIDTH}
			height={PREVIEW_HEIGHT}
			aria-hidden
			className="size-full"
		/>
	);
}

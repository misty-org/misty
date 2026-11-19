// Misty: the motion graphic, a graphic whose look is a script. Its params hold the script and
// its props (JSON); it draws at the frame's own size for each moment of the element, through
// the sandbox in runtime.ts. A frame the script can't draw stays empty, and the error is kept
// for the properties panel (errors.ts); the preview and the export carry on.
import type { ParamDefinition, ParamValues } from "@opencut/params";
import type { GraphicDefinition } from "@opencut/graphics/types";
import { replayMotionCommands } from "./commands";
import { reportMotionError } from "./errors";
import { MOTION_PRESETS } from "./presets";
import { motionPropValues, readMotionProps, serializeMotionProps } from "./props";
import { isMotionRuntimeReady, loadMotionRuntime, runMotionFrame } from "./runtime";

export const MOTION_GRAPHIC_ID = "motion";

const starter = MOTION_PRESETS[0];

const MOTION_PARAMS: ParamDefinition<"script" | "props">[] = [
	{
		key: "script",
		label: "Script",
		type: "text",
		default: starter.script,
		keyframable: false,
	},
	{
		key: "props",
		label: "Props",
		type: "text",
		default: serializeMotionProps(starter.props),
		keyframable: false,
	},
];

export function isMotionGraphic(element: { type: string; definitionId?: string }): boolean {
	return element.type === "graphic" && element.definitionId === MOTION_GRAPHIC_ID;
}

export function readMotionScript(params: ParamValues): string {
	return typeof params.script === "string" ? params.script : "";
}

/** Draws one frame of a motion graphic; the error that left it empty, or null. */
export function drawMotionGraphic({
	ctx,
	params,
	time,
	duration,
	width,
	height,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	params: ParamValues;
	time: number;
	duration: number;
	width: number;
	height: number;
}): string | null {
	const result = runMotionFrame({
		script: readMotionScript(params),
		props: motionPropValues(readMotionProps(params.props)),
		time,
		duration,
		width,
		height,
	});
	if (!result.ok) return result.error;
	try {
		replayMotionCommands(ctx, result.commands);
		return null;
	} catch (error) {
		ctx.clearRect(0, 0, width, height);
		return error instanceof Error ? error.message : "The script couldn't draw this frame.";
	}
}

export const motionGraphicDefinition: GraphicDefinition = {
	id: MOTION_GRAPHIC_ID,
	name: "Motion graphic",
	keywords: ["motion", "animated", "title", "script", "code"],
	params: MOTION_PARAMS,
	animated: true,
	prepare: loadMotionRuntime,
	render({ ctx, params, width, height, time = 0, duration = 0 }) {
		ctx.clearRect(0, 0, width, height);
		if (!isMotionRuntimeReady()) return;
		const error = drawMotionGraphic({ ctx, params, time, duration, width, height });
		reportMotionError({ script: readMotionScript(params), error });
	},
};

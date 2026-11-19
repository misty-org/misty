// Misty: the drawing a motion graphic's script recorded, checked call by call and replayed on a
// real canvas. Nothing the script hands back reaches the canvas unchecked: every call must be
// one the stand-in context offers, every number finite and in range, every color, font and
// gradient one the canvas can only paint with. A call with a bad value is left out, as a
// canvas ignores one; a drawing that breaks the limits or the shape of the list is refused.
import {
	MAX_COMMANDS,
	MAX_COORDINATE,
	MAX_DASH_SEGMENTS,
	MAX_FRAME_TEXT_CHARS,
	MAX_GRADIENTS,
	MAX_LINE_WIDTH,
	MAX_SAVE_DEPTH,
	MAX_TEXT_CHARS,
	isSafeColor,
	isSafeFont,
} from "./limits";

export type MotionCommandArg = number | string | boolean | number[];
export type MotionCommand = readonly [string, ...MotionCommandArg[]];

export type SanitizedMotionCommands =
	| { ok: true; commands: MotionCommand[] }
	| { ok: false; error: string };

type MotionContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const isCoordinate = (value: unknown): value is number =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	Math.abs(value) <= MAX_COORDINATE;
const isLength = (value: unknown): value is number =>
	isCoordinate(value) && value >= 0;
const isPositive = (value: unknown): value is number =>
	typeof value === "number" && value > 0 && value <= MAX_LINE_WIDTH;
const isRadii = (value: unknown): boolean =>
	isLength(value) ||
	(Array.isArray(value) &&
		value.length >= 1 &&
		value.length <= 4 &&
		value.every(isLength));
const isDash = (value: unknown): boolean =>
	Array.isArray(value) &&
	value.length <= MAX_DASH_SEGMENTS &&
	value.every((segment) => isLength(segment) && segment <= MAX_LINE_WIDTH);
const oneOf =
	(...options: string[]) =>
	(value: unknown): boolean =>
		typeof value === "string" && options.includes(value);
const isRule = oneOf("evenodd");
const isBoolean = (value: unknown): boolean => typeof value === "boolean";

type Check = (value: unknown) => boolean;

/** Each call's required arguments, then the ones it may also take. */
const CALLS: Record<string, { args: Check[]; optional?: Check[] }> = {
	beginPath: { args: [] },
	closePath: { args: [] },
	moveTo: { args: [isCoordinate, isCoordinate] },
	lineTo: { args: [isCoordinate, isCoordinate] },
	quadraticCurveTo: { args: Array(4).fill(isCoordinate) },
	bezierCurveTo: { args: Array(6).fill(isCoordinate) },
	arcTo: { args: [isCoordinate, isCoordinate, isCoordinate, isCoordinate, isLength] },
	rect: { args: Array(4).fill(isCoordinate) },
	arc: {
		args: [isCoordinate, isCoordinate, isLength, isCoordinate, isCoordinate, isBoolean],
	},
	ellipse: {
		args: [
			isCoordinate,
			isCoordinate,
			isLength,
			isLength,
			isCoordinate,
			isCoordinate,
			isCoordinate,
			isBoolean,
		],
	},
	roundRect: { args: [isCoordinate, isCoordinate, isCoordinate, isCoordinate, isRadii] },
	fill: { args: [], optional: [isRule] },
	stroke: { args: [] },
	clip: { args: [], optional: [isRule] },
	fillRect: { args: Array(4).fill(isCoordinate) },
	strokeRect: { args: Array(4).fill(isCoordinate) },
	clearRect: { args: Array(4).fill(isCoordinate) },
	fillText: {
		args: [isText, isCoordinate, isCoordinate],
		optional: [(value) => isLength(value) && value > 0],
	},
	strokeText: {
		args: [isText, isCoordinate, isCoordinate],
		optional: [(value) => isLength(value) && value > 0],
	},
	save: { args: [] },
	restore: { args: [] },
	translate: { args: [isCoordinate, isCoordinate] },
	rotate: { args: [isCoordinate] },
	scale: { args: [isCoordinate, isCoordinate] },
	transform: { args: Array(6).fill(isCoordinate) },
	setTransform: { args: Array(6).fill(isCoordinate) },
	resetTransform: { args: [] },
	setLineDash: { args: [isDash] },
	globalAlpha: { args: [(value) => typeof value === "number" && value >= 0 && value <= 1] },
	lineWidth: { args: [isPositive] },
	miterLimit: { args: [isPositive] },
	lineDashOffset: { args: [isCoordinate] },
	font: { args: [isSafeFont] },
	lineCap: { args: [oneOf("butt", "round", "square")] },
	lineJoin: { args: [oneOf("round", "bevel", "miter")] },
	textAlign: { args: [oneOf("left", "right", "center", "start", "end")] },
	textBaseline: {
		args: [oneOf("top", "hanging", "middle", "alphabetic", "ideographic", "bottom")],
	},
};

function isText(value: unknown): boolean {
	return typeof value === "string" && value.length <= MAX_TEXT_CHARS;
}

function argumentsFit(args: unknown[], call: { args: Check[]; optional?: Check[] }) {
	const optional = call.optional ?? [];
	if (args.length < call.args.length || args.length > call.args.length + optional.length) {
		return false;
	}
	return args.every((value, index) =>
		index < call.args.length
			? call.args[index](value)
			: optional[index - call.args.length](value),
	);
}

const refused = (error: string): SanitizedMotionCommands => ({ ok: false, error });

/** The calls of one frame as the script recorded them, kept only where they are safe. */
export function sanitizeMotionCommands(raw: unknown): SanitizedMotionCommands {
	if (!Array.isArray(raw)) return refused("The script's drawing couldn't be read.");
	if (raw.length > MAX_COMMANDS) {
		return refused(`A frame can make at most ${MAX_COMMANDS} drawing calls; draw fewer shapes.`);
	}
	const commands: MotionCommand[] = [];
	const gradients = new Set<number>();
	let nextGradient = 0;
	let textChars = 0;
	let depth = 0;
	for (const entry of raw) {
		if (!Array.isArray(entry) || typeof entry[0] !== "string") {
			return refused("The script's drawing couldn't be read.");
		}
		const [name, ...args] = entry as [string, ...unknown[]];
		if (name === "linearGradient" || name === "radialGradient") {
			if (args[0] !== nextGradient || nextGradient >= MAX_GRADIENTS) {
				return refused("The script's gradients couldn't be read.");
			}
			nextGradient++;
			const fits =
				name === "linearGradient"
					? args.length === 5 && args.slice(1).every(isCoordinate)
					: args.length === 7 &&
						[1, 2, 4, 5].every((index) => isCoordinate(args[index])) &&
						isLength(args[3]) &&
						isLength(args[6]);
			if (fits) {
				gradients.add(args[0] as number);
				commands.push(entry as unknown as MotionCommand);
			}
			continue;
		}
		if (name === "colorStop") {
			const [id, offset, color] = args;
			if (
				args.length === 3 &&
				typeof id === "number" &&
				gradients.has(id) &&
				typeof offset === "number" &&
				offset >= 0 &&
				offset <= 1 &&
				isSafeColor(color)
			) {
				commands.push(["colorStop", id, offset, color]);
			}
			continue;
		}
		if (name === "fillStyle" || name === "strokeStyle") {
			const [paint] = args;
			if (
				args.length === 1 &&
				(isSafeColor(paint) || (typeof paint === "number" && gradients.has(paint)))
			) {
				commands.push([name, paint]);
			}
			continue;
		}
		const call = CALLS[name];
		if (!call) return refused(`ctx.${name} isn't available in a motion graphic.`);
		if (!argumentsFit(args, call)) continue;
		if (name === "fillText" || name === "strokeText") {
			textChars += (args[0] as string).length;
			if (textChars > MAX_FRAME_TEXT_CHARS) {
				return refused(`A frame can draw at most ${MAX_FRAME_TEXT_CHARS} characters of text.`);
			}
		}
		if (name === "save") {
			if (++depth > MAX_SAVE_DEPTH) {
				return refused(`save() can be nested at most ${MAX_SAVE_DEPTH} deep.`);
			}
		}
		if (name === "restore") {
			if (depth === 0) continue;
			depth--;
		}
		commands.push(entry as unknown as MotionCommand);
	}
	return { ok: true, commands };
}

/** Draws checked calls (from sanitizeMotionCommands) on a canvas, leaving its state as it was. */
export function replayMotionCommands(
	ctx: MotionContext2D,
	commands: readonly MotionCommand[],
): void {
	const gradients = new Map<number, CanvasGradient>();
	const paint = (value: MotionCommandArg): string | CanvasGradient | null =>
		typeof value === "number" ? (gradients.get(value) ?? null) : String(value);
	let depth = 0;
	ctx.save();
	try {
		for (const command of commands) {
			const [name, ...args] = command;
			const at = (index: number) => args[index] as number;
			switch (name) {
				case "beginPath":
					ctx.beginPath();
					break;
				case "closePath":
					ctx.closePath();
					break;
				case "moveTo":
					ctx.moveTo(at(0), at(1));
					break;
				case "lineTo":
					ctx.lineTo(at(0), at(1));
					break;
				case "quadraticCurveTo":
					ctx.quadraticCurveTo(at(0), at(1), at(2), at(3));
					break;
				case "bezierCurveTo":
					ctx.bezierCurveTo(at(0), at(1), at(2), at(3), at(4), at(5));
					break;
				case "arcTo":
					ctx.arcTo(at(0), at(1), at(2), at(3), at(4));
					break;
				case "rect":
					ctx.rect(at(0), at(1), at(2), at(3));
					break;
				case "arc":
					ctx.arc(at(0), at(1), at(2), at(3), at(4), args[5] as boolean);
					break;
				case "ellipse":
					ctx.ellipse(
						at(0),
						at(1),
						at(2),
						at(3),
						at(4),
						at(5),
						at(6),
						args[7] as boolean,
					);
					break;
				case "roundRect":
					if (typeof ctx.roundRect === "function") {
						ctx.roundRect(at(0), at(1), at(2), at(3), args[4] as number | number[]);
					} else {
						ctx.rect(at(0), at(1), at(2), at(3));
					}
					break;
				case "fill":
					ctx.fill(args[0] === "evenodd" ? "evenodd" : "nonzero");
					break;
				case "stroke":
					ctx.stroke();
					break;
				case "clip":
					ctx.clip(args[0] === "evenodd" ? "evenodd" : "nonzero");
					break;
				case "fillRect":
					ctx.fillRect(at(0), at(1), at(2), at(3));
					break;
				case "strokeRect":
					ctx.strokeRect(at(0), at(1), at(2), at(3));
					break;
				case "clearRect":
					ctx.clearRect(at(0), at(1), at(2), at(3));
					break;
				case "fillText":
					if (args.length > 3) {
						ctx.fillText(String(args[0]), at(1), at(2), at(3));
					} else {
						ctx.fillText(String(args[0]), at(1), at(2));
					}
					break;
				case "strokeText":
					if (args.length > 3) {
						ctx.strokeText(String(args[0]), at(1), at(2), at(3));
					} else {
						ctx.strokeText(String(args[0]), at(1), at(2));
					}
					break;
				case "save":
					ctx.save();
					depth++;
					break;
				case "restore":
					if (depth > 0) {
						ctx.restore();
						depth--;
					}
					break;
				case "translate":
					ctx.translate(at(0), at(1));
					break;
				case "rotate":
					ctx.rotate(at(0));
					break;
				case "scale":
					ctx.scale(at(0), at(1));
					break;
				case "transform":
					ctx.transform(at(0), at(1), at(2), at(3), at(4), at(5));
					break;
				case "setTransform":
					ctx.setTransform(at(0), at(1), at(2), at(3), at(4), at(5));
					break;
				case "resetTransform":
					ctx.setTransform(1, 0, 0, 1, 0, 0);
					break;
				case "setLineDash":
					ctx.setLineDash(args[0] as number[]);
					break;
				case "globalAlpha":
					ctx.globalAlpha = at(0);
					break;
				case "lineWidth":
					ctx.lineWidth = at(0);
					break;
				case "miterLimit":
					ctx.miterLimit = at(0);
					break;
				case "lineDashOffset":
					ctx.lineDashOffset = at(0);
					break;
				case "font":
					ctx.font = String(args[0]);
					break;
				case "lineCap":
					ctx.lineCap = args[0] as CanvasLineCap;
					break;
				case "lineJoin":
					ctx.lineJoin = args[0] as CanvasLineJoin;
					break;
				case "textAlign":
					ctx.textAlign = args[0] as CanvasTextAlign;
					break;
				case "textBaseline":
					ctx.textBaseline = args[0] as CanvasTextBaseline;
					break;
				case "fillStyle": {
					const value = paint(args[0]);
					if (value !== null) ctx.fillStyle = value;
					break;
				}
				case "strokeStyle": {
					const value = paint(args[0]);
					if (value !== null) ctx.strokeStyle = value;
					break;
				}
				case "linearGradient":
					gradients.set(
						at(0),
						ctx.createLinearGradient(at(1), at(2), at(3), at(4)),
					);
					break;
				case "radialGradient":
					try {
						gradients.set(
							at(0),
							ctx.createRadialGradient(at(1), at(2), at(3), at(4), at(5), at(6)),
						);
					} catch {
						// A radius the canvas refuses leaves the gradient out.
					}
					break;
				case "colorStop":
					try {
						gradients.get(at(0))?.addColorStop(at(1), String(args[2]));
					} catch {
						// A color name the canvas doesn't know leaves the stop out, as fillStyle would.
					}
					break;
			}
		}
	} finally {
		// Saves the script left open are closed before the outer one, so the canvas ends as it began.
		while (depth-- > 0) ctx.restore();
		ctx.restore();
	}
}

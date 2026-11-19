// Misty: the limits a motion graphic's script draws within, and the checks for the colors and
// fonts it may use. The script's recorder (prelude.ts) and the host that replays what it drew
// (commands.ts) both read them, so the two agree on what a frame may hold.

/** The longest script a motion graphic keeps, in characters. */
export const MAX_SCRIPT_CHARS = 20_000;
/** Drawing calls one frame may make. */
export const MAX_COMMANDS = 20_000;
/** Characters one fillText or measureText may take, and all text in a frame together. */
export const MAX_TEXT_CHARS = 1_000;
export const MAX_FRAME_TEXT_CHARS = 20_000;
/** measureText calls in one frame. */
export const MAX_MEASURES = 2_000;
export const MAX_GRADIENTS = 256;
export const MAX_GRADIENT_STOPS = 32;
export const MAX_SAVE_DEPTH = 64;
export const MAX_DASH_SEGMENTS = 32;
/** How far from the frame a coordinate may reach before a call is dropped. */
export const MAX_COORDINATE = 1_000_000;
export const MAX_LINE_WIDTH = 10_000;
export const MAX_FONT_PIXELS = 2_048;
export const MAX_FONT_CHARS = 120;
export const MAX_COLOR_CHARS = 64;

/** How long a script may take to draw one frame, and to load. */
export const FRAME_TIME_LIMIT_MS = 100;
export const COMPILE_TIME_LIMIT_MS = 250;
/** Memory and stack each script's engine may use. */
export const MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
export const STACK_LIMIT_BYTES = 512 * 1024;

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_COLOR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([\d\s.,%+\-/a-z]*\)$/i;
const NAMED_COLOR = /^[a-z]{3,24}$/i;

/** A CSS color the canvas can take: hex, a color function with plain numbers, or a name. */
export function isSafeColor(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= MAX_COLOR_CHARS &&
		(HEX_COLOR.test(value) || FUNCTION_COLOR.test(value) || NAMED_COLOR.test(value))
	);
}

/** Font shorthand: weights, sizes and family names, nothing else. Shared with the recorder. */
export const FONT_PATTERN = /^[\w\s"'.,%/-]+$/;

export function fontPixelSize(font: string): number | null {
	const match = /(\d+(?:\.\d+)?)(px|pt)\b/i.exec(font);
	if (!match) return null;
	const size = Number(match[1]);
	return match[2].toLowerCase() === "pt" ? (size * 4) / 3 : size;
}

export function isSafeFont(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_FONT_CHARS) {
		return false;
	}
	if (!FONT_PATTERN.test(value)) return false;
	const size = fontPixelSize(value);
	return size === null || size <= MAX_FONT_PIXELS;
}

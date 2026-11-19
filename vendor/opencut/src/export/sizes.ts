// Misty: the sizes an export can be rendered at, all keeping the project's shape: its own size,
// 720p to 4K by the short side, and the size a platform asks for, offered only when the
// project already has that platform's shape. The scene is laid out in the project's canvas and
// drawn at the chosen size (CanvasRenderer's `design`), so nothing moves or changes size
// relative to the frame.
import { canEncodeVideo, type VideoCodec } from "mediabunny";
import type { ExportFormat } from "./index";

export const EXPORT_SIZE_VALUES = [
	"project",
	"720p",
	"1080p",
	"1440p",
	"4k",
	"vertical",
	"square",
	"widescreen",
] as const;

export type ExportSize = (typeof EXPORT_SIZE_VALUES)[number];

type Shape = { width: number; height: number };

const SHORT_SIDES: Partial<Record<ExportSize, number>> = {
	"720p": 720,
	"1080p": 1080,
	"1440p": 1440,
	"4k": 2160,
};

/** Each platform's frame, and the shape a project needs for it to be offered. */
const PLATFORMS: Partial<Record<ExportSize, Shape>> = {
	vertical: { width: 1080, height: 1920 },
	square: { width: 1080, height: 1080 },
	widescreen: { width: 1920, height: 1080 },
};

export const EXPORT_SIZE_LABELS: Record<ExportSize, string> = {
	project: "Project size",
	"720p": "720p",
	"1080p": "1080p",
	"1440p": "1440p",
	"4k": "4K",
	vertical: "TikTok, Reels, Shorts",
	square: "Square",
	widescreen: "YouTube",
};

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

function sameShape(a: Shape, b: Shape): boolean {
	return Math.abs(a.width / a.height - b.width / b.height) < 0.01;
}

export function isExportSize(value: string): value is ExportSize {
	return (EXPORT_SIZE_VALUES as readonly string[]).includes(value);
}

/**
 * The frame size an export choice renders at for a project of this canvas, or null when the
 * choice doesn't apply to its shape (a platform's frame of another shape).
 */
export function resolveExportSize({
	size,
	canvas,
}: {
	size: ExportSize;
	canvas: Shape;
}): Shape | null {
	if (size === "project") return { width: canvas.width, height: canvas.height };
	const platform = PLATFORMS[size];
	if (platform) return sameShape(platform, canvas) ? { ...platform } : null;
	const short = SHORT_SIDES[size];
	if (!short) return null;
	const scale = short / Math.min(canvas.width, canvas.height);
	return { width: even(canvas.width * scale), height: even(canvas.height * scale) };
}

export type ExportSizeChoice = { size: ExportSize; width: number; height: number };

/**
 * The choices that apply to a project of this canvas, each with the frame it renders. The
 * project's own size is left out when one of 720p to 4K is that size already.
 */
export function exportSizeChoices({ canvas }: { canvas: Shape }): ExportSizeChoice[] {
	const choices: ExportSizeChoice[] = [];
	for (const size of EXPORT_SIZE_VALUES) {
		const frame = resolveExportSize({ size, canvas });
		if (frame) choices.push({ size, ...frame });
	}
	const isProjectSize = (choice: ExportSizeChoice) =>
		choice.size in SHORT_SIDES &&
		choice.width === canvas.width &&
		choice.height === canvas.height;
	return choices.some(isProjectSize)
		? choices.filter((choice) => choice.size !== "project")
		: choices;
}

/** The choice a project exports at unless another is picked: the one at its own size. */
export function defaultExportSize({ canvas }: { canvas: Shape }): ExportSize {
	const own = exportSizeChoices({ canvas }).find(
		(choice) =>
			choice.size in SHORT_SIDES &&
			choice.width === canvas.width &&
			choice.height === canvas.height,
	);
	return own?.size ?? "project";
}

/** Why a choice can't be used for a project of this canvas, or null when it can. */
export function exportSizeMismatch({
	size,
	canvas,
}: {
	size: ExportSize;
	canvas: Shape;
}): string | null {
	if (resolveExportSize({ size, canvas })) return null;
	const platform = PLATFORMS[size];
	return platform
		? `${EXPORT_SIZE_LABELS[size]} is ${platform.width}×${platform.height}, a different shape from this video's ${canvas.width}×${canvas.height}; change its frame first.`
		: `${size} isn't an export size.`;
}

const codecOf = (format: ExportFormat): VideoCodec => (format === "webm" ? "vp9" : "avc");

/**
 * Whether this webview can encode a video of this size in this format (mediabunny asks
 * `VideoEncoder.isConfigSupported` with the codec string the export will use).
 */
export async function canEncodeExportSize({
	format,
	width,
	height,
}: {
	format: ExportFormat;
	width: number;
	height: number;
}): Promise<boolean> {
	if (typeof VideoEncoder === "undefined") return false;
	try {
		return await canEncodeVideo(codecOf(format), { width, height });
	} catch {
		return false;
	}
}

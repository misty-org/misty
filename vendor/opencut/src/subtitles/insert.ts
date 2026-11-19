import type { EditorCore } from "@opencut/core";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@opencut/commands";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import type { SubtitleCue } from "./types";
import type { CaptionStyle } from "./caption-style";

export function insertCaptionChunksAsTextTrack({
	editor,
	captions,
	captionStyle,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
	/** Misty: the caption style the Captions tab has chosen. */
	captionStyle?: CaptionStyle;
}): string | null {
	if (captions.length === 0) {
		return null;
	}

	const addTrackCommand = new AddTrackCommand({ type: "text", index: 0 });
	const trackId = addTrackCommand.getTrackId();
	const canvasSize = editor.project.getActive().settings.canvasSize;
	const insertCommands = captions.map(
		(caption, index) =>
			new InsertElementCommand({
				placement: { mode: "explicit", trackId },
				element: buildSubtitleTextElement({
					index,
					caption,
					canvasSize,
					captionStyle,
				}),
			}),
	);
	editor.command.execute({
		command: new BatchCommand([addTrackCommand, ...insertCommands]),
	});

	return trackId;
}

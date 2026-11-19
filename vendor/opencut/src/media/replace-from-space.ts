// Misty: the timeline's "Replace media": a clip's media swapped for a file picked from the
// Space's Media, at the same place and timing (timeline/replace-source.ts). Adding the file to
// the project and swapping it in are one command, so one undo takes both back.
import { EditorCore } from "@opencut/core";
import { toast } from "@opencut/components/toast";
import { AddMediaAssetCommand, BatchCommand, TracksSnapshotCommand } from "@opencut/commands";
import { processMediaAssets } from "@opencut/media/processing";
import { getSpaceMedia } from "@opencut/media/space-media";
import type { TimelineElement } from "@opencut/timeline";
import {
	replaceElementSource,
	replacementMismatch,
} from "@opencut/timeline/replace-source";

export async function replaceElementMediaFromSpace({
	elementId,
}: {
	elementId: string;
}): Promise<void> {
	const spaceMedia = getSpaceMedia();
	if (!spaceMedia) return;
	const [file] = await spaceMedia.pick({ single: true });
	if (!file) return;
	// Unsupported files are reported by the import itself.
	const [asset] = await processMediaAssets({ files: [file] });
	if (!asset) return;

	const editor = EditorCore.getInstance();
	const project = editor.project.getActiveOrNull();
	if (!project) return;
	const before = editor.scenes.getActiveScene().tracks;
	const element = [...before.overlay, before.main, ...before.audio]
		.flatMap((track): TimelineElement[] => track.elements)
		.find((candidate) => candidate.id === elementId);
	if (!element) return;
	const mismatch = replacementMismatch({ element, media: asset });
	if (mismatch) {
		toast.error(mismatch);
		return;
	}

	const add = new AddMediaAssetCommand({ projectId: project.metadata.id, asset });
	let replaced: ReturnType<typeof replaceElementSource>;
	try {
		replaced = replaceElementSource({
			tracks: before,
			elementId,
			media: {
				assetId: add.getAssetId(),
				type: asset.type,
				name: asset.name,
				duration: asset.duration,
				hasAudio: asset.hasAudio,
			},
		});
	} catch (error) {
		toast.error(error instanceof Error ? error.message : "The media could not be replaced.");
		return;
	}
	editor.command.execute({
		command: new BatchCommand([
			add,
			new TracksSnapshotCommand({ before, after: replaced.tracks }),
		]),
	});
	if (replaced.shortenedBy > 0) {
		toast(`The clip now ends where “${asset.name}” ends.`);
	}
}

// Misty: puts bookmarks at many moments at once (a sound's beats, a video's cuts), as one step
// to undo. Moments that already have a bookmark keep it as it is.
import { Command, type CommandResult } from "@opencut/commands/base-command";
import { EditorCore } from "@opencut/core";
import type { TScene } from "@opencut/timeline";
import { updateSceneInArray } from "@opencut/timeline/scenes";
import { findBookmarkIndex, getFrameTime } from "@opencut/timeline/bookmarks/index";
import type { MediaTime } from "@opencut/wasm";

export class AddBookmarksCommand extends Command {
	private savedScenes: TScene[] | null = null;

	constructor(
		private times: MediaTime[],
		private note?: string,
	) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const activeScene = editor.scenes.getActiveScene();
		const activeProject = editor.project.getActive();
		if (!activeScene || !activeProject) return;

		const scenes = editor.scenes.getScenes();
		this.savedScenes = [...scenes];
		const bookmarks = [...activeScene.bookmarks];
		for (const time of this.times) {
			const frameTime = getFrameTime({ time, fps: activeProject.settings.fps });
			if (findBookmarkIndex({ bookmarks, frameTime }) !== -1) continue;
			bookmarks.push(this.note ? { time: frameTime, note: this.note } : { time: frameTime });
		}
		bookmarks.sort((a, b) => a.time - b.time);

		editor.scenes.setScenes({
			scenes: updateSceneInArray({
				scenes,
				sceneId: activeScene.id,
				updates: { bookmarks },
			}),
		});
	}

	undo(): void {
		if (!this.savedScenes) return;
		EditorCore.getInstance().scenes.setScenes({ scenes: this.savedScenes });
	}
}

import { spaceItemOf } from "@opencut/media/space-media";
import { captureVideoProject } from "./projectDocument";
import type { VideoProjectSource } from "./videoEditorTypes";

/** How long the project rests after a change before it is kept in its Space. */
const KEEP_AFTER_MS = 1500;

export interface ProjectKeeper {
  /** Keeps the project once changes rest. */
  schedule(): void;
  /** Keeps any change not yet kept now, after keeping under way; resolves once all is kept. */
  flush(): Promise<void>;
}

/**
 * Keeps an open project in its Space as it changes, one write at a time: the media it uses that
 * isn't in Media yet goes there first, so the project only ever points at Media items.
 * `itemIds` maps the project's media assets to their Media items and grows as media is added.
 */
export function createProjectKeeper(
  projectId: string,
  source: VideoProjectSource,
  itemIds: Map<string, string>,
  onError: (error: Error) => void,
): ProjectKeeper {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  // Whether there is a change not yet kept: closing an unchanged project writes nothing.
  let changed = false;
  const keepNow = async (): Promise<void> => {
    const { document, unkept } = await captureVideoProject(projectId, itemIds);
    if (unkept.length) {
      // A file picked from Media is that item already; only one from the computer is added.
      for (const media of unkept)
        itemIds.set(media.assetId, spaceItemOf(media.file) ?? (await source.keepMedia(media.file)));
      return keepNow();
    }
    await source.keep(document);
  };
  const enqueue = () => {
    changed = false;
    queue = queue.then(keepNow).catch((reason: unknown) => {
      onError(reason instanceof Error ? reason : new Error("The video could not be saved."));
    });
    return queue;
  };
  return {
    schedule() {
      changed = true;
      clearTimeout(timer);
      timer = setTimeout(enqueue, KEEP_AFTER_MS);
    },
    flush() {
      clearTimeout(timer);
      return changed ? enqueue() : queue;
    },
  };
}

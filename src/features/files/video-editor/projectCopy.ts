import type { VideoProjectDocument } from "./projectDocumentTypes";

/**
 * A copy of a video project to keep as a new Media item (a variant to edit on its own): the same
 * timeline pointing at the same Media items, under a project id of its own, so the editor never
 * takes the two for one project, and named `name`. The document given is left as it was.
 */
export function copyVideoProject(
  document: VideoProjectDocument,
  name: string,
  now: Date = new Date(),
): VideoProjectDocument {
  const media = document.media.map((entry) => ({ ...entry }));
  if (document.project === null) return { kind: "misty.video", version: 1, project: null, media };
  const project = structuredClone(document.project) as {
    metadata: Record<string, unknown>;
  } & Record<string, unknown>;
  const at = now.toISOString();
  project.metadata = {
    ...project.metadata,
    id: crypto.randomUUID(),
    name,
    createdAt: at,
    updatedAt: at,
  };
  return { kind: "misty.video", version: 1, project, media };
}

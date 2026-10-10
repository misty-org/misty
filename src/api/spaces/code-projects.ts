import { z } from "zod";
import { apiRequest } from "@/api/client";

/** A coding project linked to a Space. Its files stay on the owner's device. */
const codeProjectSchema = z.object({
  id: z.string(),
  space_id: z.string(),
  owner_user_id: z.string(),
  owner_name: z.string(),
  project_id: z.string(),
  device_id: z.string(),
  name: z.string(),
  github_repo: z.string(),
  linked_at: z.string(),
  updated_at: z.string(),
  /** A private project shows only to its owner. */
  visibility: z.enum(["public", "private"]).optional(),
});
export type SpaceCodeProject = z.infer<typeof codeProjectSchema>;

const path = (spaceId: string, linkId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/code-projects${linkId ? `/${encodeURIComponent(linkId)}` : ""}`;

export const codeProjectsApi = {
  async list(spaceId: string, signal?: AbortSignal) {
    return z
      .object({ projects: z.array(codeProjectSchema) })
      .parse(await apiRequest<unknown>(path(spaceId), { signal }));
  },
  /** Links one of your projects; linking it again updates its name and repository. */
  async link(
    spaceId: string,
    project: { project_id: string; device_id: string; name: string; github_repo: string },
  ) {
    return codeProjectSchema.parse(
      await apiRequest<unknown>(path(spaceId), { method: "POST", body: JSON.stringify(project) }),
    );
  },
  /** Its owner or the Space's owner may unlink it; the files are untouched. */
  async unlink(spaceId: string, linkId: string) {
    await apiRequest<unknown>(path(spaceId, linkId), { method: "DELETE" });
  },
};

/** "owner/name" from a GitHub remote URL, or "" when it isn't one. */
export function githubRepoFromRemote(remote: string | null | undefined): string {
  const match = (remote ?? "").match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : "";
}

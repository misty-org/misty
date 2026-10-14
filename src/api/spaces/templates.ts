import { apiRequest } from "@/api/client";
import type { SpacePerson, SpaceTemplate } from "./dto/entities";

/** What a saved template captures from its Space. Files and messages never are. */
export interface SpaceTemplateParts {
  tasks: boolean;
  notes: boolean;
  collections: boolean;
}

export const personalSpaceTemplatesApi = {
  list: () => apiRequest<{ templates: SpaceTemplate[] }>("/me/space-templates"),
  save: (
    input: { name: string; description: string; space_id?: string; include?: SpaceTemplateParts },
    id?: string,
  ) =>
    apiRequest<SpaceTemplate>(`/me/space-templates${id ? `/${encodeURIComponent(id)}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiRequest<void>(`/me/space-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** People the account already shares a Space with, for one-click invites. */
  people: () => apiRequest<{ people: SpacePerson[] }>("/me/space-people"),
};

import { apiRequest } from "@/api/client";
export interface PersonalSpaceTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
}
export const personalSpaceTemplatesApi = {
  list: () => apiRequest<{ templates: PersonalSpaceTemplate[] }>("/me/space-templates"),
  save: (input: { name: string; description: string; space_id?: string }, id?: string) =>
    apiRequest<PersonalSpaceTemplate>(
      `/me/space-templates${id ? `/${encodeURIComponent(id)}` : ""}`,
      { method: id ? "PUT" : "POST", body: JSON.stringify(input) },
    ),
  remove: (id: string) =>
    apiRequest<void>(`/me/space-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

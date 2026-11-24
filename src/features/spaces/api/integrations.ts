import type { SpaceIntegration, SpaceIntegrationInput } from "./dto/entities";
import type { SpaceRequest } from "./space_request_types";

export const integrationsPath = (spaceId: string) =>
  `/spaces/${encodeURIComponent(spaceId)}/integrations`;

export function createSpaceIntegrationsApi(request: SpaceRequest) {
  const integrationPath = (spaceId: string, integrationId: string) =>
    `${integrationsPath(spaceId)}/${encodeURIComponent(integrationId)}`;
  return {
    integrations: (spaceId: string) =>
      request<{ integrations?: SpaceIntegration[] }>(integrationsPath(spaceId)).then(
        (result) => result.integrations ?? [],
      ),
    createIntegration: (spaceId: string, input: SpaceIntegrationInput) =>
      request<SpaceIntegration & { token: string }>(integrationsPath(spaceId), {
        method: "POST",
        body: JSON.stringify(input),
      }),
    replaceIntegrationToken: (spaceId: string, integrationId: string) =>
      request<{ token: string }>(`${integrationPath(spaceId, integrationId)}/token`, {
        method: "POST",
      }),
    removeIntegration: (spaceId: string, integrationId: string) =>
      request(integrationPath(spaceId, integrationId), { method: "DELETE" }),
  };
}

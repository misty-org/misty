import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceLibraryData } from "@/models/types/features/spaces/useSpaceLibraryData";

/**
 * The Library's opt-in switches for face/pet grouping and AI features.
 *
 * Semantic search depends on AI processing, so enabling it turns AI on and
 * turning AI off also switches semantic search back off.
 */
export function useLibraryPolicies(data: SpaceLibraryData) {
  const { spaceId, canEditLibrary, peoplePolicy, setPeoplePolicy, setLocalError } = data;

  const save = async (
    patch: Parameters<typeof spacesApi.updatePeoplePolicy>[2],
    fallback: string,
  ) => {
    if (!canEditLibrary || !peoplePolicy) return;
    try {
      setPeoplePolicy(await spacesApi.updatePeoplePolicy(spaceId, peoplePolicy, patch));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : fallback);
    }
  };

  const togglePeoplePolicy = (kind: "person" | "pet") =>
    save(
      kind === "person"
        ? { faces_enabled: !peoplePolicy?.faces_enabled }
        : { pets_enabled: !peoplePolicy?.pets_enabled },
      "People & Pets settings could not be updated.",
    );

  const toggleIntelligencePolicy = (kind: "ai" | "semantic") =>
    save(
      kind === "ai"
        ? {
            ai_enabled: !peoplePolicy?.ai_enabled,
            ...(peoplePolicy?.ai_enabled ? { semantic_search_enabled: false } : {}),
          }
        : {
            semantic_search_enabled: !peoplePolicy?.semantic_search_enabled,
            ...(peoplePolicy?.semantic_search_enabled ? {} : { ai_enabled: true }),
          },
      "Library intelligence settings could not be updated.",
    );

  return { togglePeoplePolicy, toggleIntelligencePolicy };
}

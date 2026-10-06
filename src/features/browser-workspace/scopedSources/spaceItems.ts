import { drawingsApi } from "@/api/drawings/api";
import { codeProjectsApi } from "@/api/spaces/code-projects";
import { spacesApi } from "@/api/spaces/api";
import type { useSpacesStore } from "@/features/spaces/core";
import { resultLimit, type ScopedSearchResult } from "../scopedSearchSources";

type Space = ReturnType<typeof useSpacesStore.getState>["spaces"][number];

const maxSpaces = 10;

function recentSpaces(spaces: readonly Space[]): Space[] {
  return [...spaces]
    .sort((left, right) => (right.updated_at ?? "").localeCompare(left.updated_at ?? ""))
    .slice(0, maxSpaces);
}

const matches = (query: string, ...fields: string[]) => {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = fields.join(" ").toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
};

/** `!files`: files in your Spaces, searched by the server. */
export async function searchSpaceFiles(
  query: string,
  spaces: readonly Space[],
): Promise<ScopedSearchResult[]> {
  if (!query.trim()) return [];
  const pages = await Promise.all(
    recentSpaces(spaces).map((space) =>
      spacesApi
        .libraryItems(space.id, { q: query, limit: resultLimit })
        .then((page) => page.items.map((item) => ({ space, item })))
        .catch(() => []),
    ),
  );
  return pages
    .flat()
    .sort((left, right) => (right.item.updated_at ?? "").localeCompare(left.item.updated_at ?? ""))
    .slice(0, resultLimit)
    .map(({ space, item }) => ({
      id: `file:${item.id}`,
      kind: "file",
      title: item.display_name,
      subtitle: space.name,
      target: {
        kind: "route",
        route: `/spaces/${encodeURIComponent(space.id)}/library?item=${encodeURIComponent(item.id)}`,
      },
    }));
}

/** `!drawings`: drawings in your Spaces, by title. */
export async function searchSpaceDrawings(
  query: string,
  spaces: readonly Space[],
): Promise<ScopedSearchResult[]> {
  if (!query.trim()) return [];
  const lists = await Promise.all(
    recentSpaces(spaces).map((space) =>
      drawingsApi
        .list(space.id)
        .then(({ drawings }) =>
          drawings
            .filter((drawing) => drawing.lifecycle_state === "active")
            .map((drawing) => ({ space, drawing })),
        )
        .catch(() => []),
    ),
  );
  return lists
    .flat()
    .filter(({ drawing }) => matches(query, drawing.title ?? ""))
    .slice(0, resultLimit)
    .map(({ space, drawing }) => ({
      id: `drawing:${drawing.id}`,
      kind: "drawing",
      title: drawing.title || "Untitled drawing",
      subtitle: space.name,
      target: {
        kind: "route",
        route: `/spaces/${encodeURIComponent(space.id)}/drawings/${encodeURIComponent(drawing.id)}`,
      },
    }));
}

/** `!code`: coding projects linked to your Spaces, by name or repository. */
export async function searchSpaceCode(
  query: string,
  spaces: readonly Space[],
): Promise<ScopedSearchResult[]> {
  const lists = await Promise.all(
    recentSpaces(spaces).map((space) =>
      codeProjectsApi
        .list(space.id)
        .then(({ projects }) => projects.map((project) => ({ space, project })))
        .catch(() => []),
    ),
  );
  return lists
    .flat()
    .filter(({ project }) => !query.trim() || matches(query, project.name, project.github_repo))
    .slice(0, resultLimit)
    .map(({ space, project }) => ({
      id: `code:${project.id}`,
      kind: "code",
      title: project.name,
      subtitle: [project.github_repo, space.name].filter(Boolean).join(" · "),
      target: { kind: "route", route: `/spaces/${encodeURIComponent(space.id)}/code` },
    }));
}

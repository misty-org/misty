import type {
  LibraryAlbum,
  LibraryAlbumFolder,
  LibraryGroup,
  LibraryGroupRule,
  LibraryIntelligencePolicy,
  LibraryPerson,
  SpaceLibraryItem,
} from "@/api/spaces/dto/interfaces/types";

import type { SpaceRequest } from "./types";
export function createSpaceLibraryCollectionsApi(spaceRequest: SpaceRequest) {
  return {
    albums: (spaceId: string) =>
      spaceRequest<{ albums: LibraryAlbum[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/albums`,
      ),
    albumFolders: (spaceId: string) =>
      spaceRequest<{ folders: LibraryAlbumFolder[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/album-folders`,
      ),
    createAlbumFolder: (spaceId: string, name: string, parentFolderId = "") =>
      spaceRequest<LibraryAlbumFolder>(
        `/spaces/${encodeURIComponent(spaceId)}/library/album-folders`,
        { method: "POST", body: JSON.stringify({ name, parent_folder_id: parentFolderId }) },
      ),
    updateAlbumFolder: (
      spaceId: string,
      folder: LibraryAlbumFolder,
      patch: Partial<Pick<LibraryAlbumFolder, "name" | "parent_folder_id" | "position">>,
    ) =>
      spaceRequest<LibraryAlbumFolder>(
        `/spaces/${encodeURIComponent(spaceId)}/library/album-folders/${encodeURIComponent(folder.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: folder.version,
            name: patch.name ?? folder.name,
            parent_folder_id: patch.parent_folder_id ?? folder.parent_folder_id ?? "",
            position: patch.position ?? folder.position,
          }),
        },
      ),
    deleteAlbumFolder: (spaceId: string, folder: LibraryAlbumFolder) =>
      spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/album-folders/${encodeURIComponent(folder.id)}?version=${folder.version}`,
        { method: "DELETE" },
      ),
    createAlbum: (spaceId: string, name: string, description = "") =>
      spaceRequest<LibraryAlbum>(`/spaces/${encodeURIComponent(spaceId)}/library/albums`, {
        method: "POST",
        body: JSON.stringify({ name, description }),
      }),
    organizeAlbum: (
      spaceId: string,
      album: LibraryAlbum,
      patch: Partial<Pick<LibraryAlbum, "folder_id" | "view_mode" | "sort_mode" | "position">>,
    ) =>
      spaceRequest<LibraryAlbum>(
        `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(album.id)}/organization`,
        {
          method: "PUT",
          body: JSON.stringify({
            version: album.version,
            folder_id: patch.folder_id ?? album.folder_id ?? "",
            view_mode: patch.view_mode ?? album.view_mode,
            sort_mode: patch.sort_mode ?? album.sort_mode,
            position: patch.position ?? album.position,
          }),
        },
      ),
    updateAlbum: (
      spaceId: string,
      album: LibraryAlbum,
      patch: Partial<Pick<LibraryAlbum, "name" | "description" | "cover_item_id">>,
    ) =>
      spaceRequest<LibraryAlbum>(
        `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(album.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: album.version,
            name: patch.name ?? album.name,
            description: patch.description ?? album.description,
            cover_item_id: patch.cover_item_id ?? album.cover_item_id ?? "",
          }),
        },
      ),
    deleteAlbum: (spaceId: string, album: LibraryAlbum) =>
      spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(album.id)}?version=${album.version}`,
        { method: "DELETE" },
      ),
    albumItems: (spaceId: string, albumId: string) =>
      spaceRequest<{ items: SpaceLibraryItem[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(albumId)}/items`,
      ),
    addAlbumItems: (spaceId: string, albumId: string, itemIds: string[]) =>
      spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(albumId)}/items`,
        { method: "POST", body: JSON.stringify({ item_ids: itemIds }) },
      ),
    reorderAlbumItems: (spaceId: string, album: LibraryAlbum, itemIds: string[]) =>
      spaceRequest<LibraryAlbum>(
        `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(album.id)}/order`,
        { method: "POST", body: JSON.stringify({ version: album.version, item_ids: itemIds }) },
      ),
    groups: (spaceId: string) =>
      spaceRequest<{ groups: LibraryGroup[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/groups`,
      ),
    createGroup: (spaceId: string, name: string, rules: LibraryGroupRule[]) =>
      spaceRequest<LibraryGroup>(`/spaces/${encodeURIComponent(spaceId)}/library/groups`, {
        method: "POST",
        body: JSON.stringify({ name, rules: { all: rules } }),
      }),
    groupItems: (spaceId: string, groupId: string) =>
      spaceRequest<{ items: SpaceLibraryItem[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/groups/${encodeURIComponent(groupId)}/items`,
      ),
    peoplePolicy: (spaceId: string) =>
      spaceRequest<LibraryIntelligencePolicy>(
        `/spaces/${encodeURIComponent(spaceId)}/library/people/policy`,
      ),
    updatePeoplePolicy: (
      spaceId: string,
      policy: LibraryIntelligencePolicy,
      patch: Partial<
        Pick<
          LibraryIntelligencePolicy,
          "faces_enabled" | "pets_enabled" | "ai_enabled" | "semantic_search_enabled"
        >
      >,
    ) =>
      spaceRequest<LibraryIntelligencePolicy>(
        `/spaces/${encodeURIComponent(spaceId)}/library/people/policy`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: policy.version,
            faces_enabled: patch.faces_enabled ?? policy.faces_enabled,
            pets_enabled: patch.pets_enabled ?? policy.pets_enabled,
            ai_enabled: patch.ai_enabled ?? policy.ai_enabled,
            semantic_search_enabled:
              patch.semantic_search_enabled ?? policy.semantic_search_enabled,
          }),
        },
      ),
    people: (spaceId: string) =>
      spaceRequest<{ people: LibraryPerson[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/people`,
      ),
    createPerson: (spaceId: string, kind: "person" | "pet", name: string, itemIds: string[] = []) =>
      spaceRequest<LibraryPerson>(`/spaces/${encodeURIComponent(spaceId)}/library/people`, {
        method: "POST",
        body: JSON.stringify({ kind, name, item_ids: itemIds }),
      }),
    updatePerson: (
      spaceId: string,
      person: LibraryPerson,
      patch: Partial<Pick<LibraryPerson, "name" | "cover_item_id">>,
    ) =>
      spaceRequest<LibraryPerson>(
        `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(person.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: person.version,
            name: patch.name ?? person.name,
            cover_item_id: patch.cover_item_id ?? person.cover_item_id ?? "",
          }),
        },
      ),
    deletePerson: (spaceId: string, person: LibraryPerson) =>
      spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(person.id)}?version=${person.version}`,
        { method: "DELETE" },
      ),
    personItems: (spaceId: string, personId: string) =>
      spaceRequest<{ items: SpaceLibraryItem[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(personId)}/items`,
      ),
    addPersonItems: (spaceId: string, personId: string, itemIds: string[]) =>
      spaceRequest<LibraryPerson>(
        `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(personId)}/items`,
        { method: "POST", body: JSON.stringify({ item_ids: itemIds }) },
      ),
    removePersonItems: (spaceId: string, personId: string, itemIds: string[]) =>
      spaceRequest<LibraryPerson>(
        `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(personId)}/items`,
        { method: "DELETE", body: JSON.stringify({ item_ids: itemIds }) },
      ),
    mergePeople: (spaceId: string, source: LibraryPerson, target: LibraryPerson) =>
      spaceRequest<LibraryPerson>(`/spaces/${encodeURIComponent(spaceId)}/library/people/merge`, {
        method: "POST",
        body: JSON.stringify({
          source_id: source.id,
          target_id: target.id,
          source_version: source.version,
          target_version: target.version,
        }),
      }),
  };
}

import { spacesApi } from "../api/api";
import { errorText } from "@/shared/lib/format";
import type { SpacesStore } from "./spaces_store_types";
type SpacesSet = (
  partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>),
) => void;

export function createSpaceLifecycleActions(
  set: SpacesSet,
  get: () => SpacesStore,
): Pick<
  SpacesStore,
  | "createSpace"
  | "renameSpace"
  | "invite"
  | "respondInvite"
  | "removeMember"
  | "leaveSpace"
  | "transferOwner"
  | "deleteSpace"
> {
  return {
    createSpace: async (request) => {
      set({ error: null });
      try {
        const result = await spacesApi.create(request);
        await get().load({ force: true });
        return result;
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    renameSpace: async (spaceId, name) => {
      set({ error: null });
      try {
        const space = await spacesApi.rename(spaceId, name);
        set((state) => ({
          spaces: state.spaces.map((item) => (item.id === spaceId ? space : item)),
        }));
        return space;
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    invite: async (spaceId, email) => {
      set({ error: null });
      try {
        const invitation = await spacesApi.invite(spaceId, email);
        await Promise.all([get().loadMembers(spaceId), get().load({ force: true })]);
        return invitation.link ?? "";
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    respondInvite: async (inviteId, accept) => {
      set({ error: null });
      try {
        await spacesApi.respondInvite(inviteId, accept);
        await get().load({ force: true });
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    removeMember: async (spaceId, userId) => {
      set({ error: null });
      try {
        await spacesApi.removeMember(spaceId, userId);
        await Promise.all([get().loadMembers(spaceId), get().load({ force: true })]);
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    leaveSpace: async (spaceId) => {
      set({ error: null });
      try {
        await spacesApi.leave(spaceId);
        set((state) => ({
          spaces: state.spaces.filter((space) => space.id !== spaceId),
        }));
        await get().load({ force: true });
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    transferOwner: async (spaceId, userId) => {
      set({ error: null });
      try {
        await spacesApi.transfer(spaceId, userId);
        await Promise.all([get().loadMembers(spaceId), get().load({ force: true })]);
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    deleteSpace: async (spaceId, confirmation) => {
      set({ error: null });
      try {
        await spacesApi.delete(spaceId, confirmation);
        set((state) => {
          const spaces = state.spaces.filter((space) => space.id !== spaceId);
          const messagesBySpace = { ...state.messagesBySpace };
          delete messagesBySpace[spaceId];
          const nodesBySpace = { ...state.nodesBySpace };
          delete nodesBySpace[spaceId];
          const membersBySpace = { ...state.membersBySpace };
          delete membersBySpace[spaceId];
          const integrationsBySpace = { ...state.integrationsBySpace };
          delete integrationsBySpace[spaceId];
          return { spaces, messagesBySpace, nodesBySpace, membersBySpace, integrationsBySpace };
        });
        await get().load({ force: true });
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },
  };
}

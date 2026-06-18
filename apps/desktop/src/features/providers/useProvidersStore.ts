import { create } from "zustand";
import {
  providersConfigPaths,
  providersRefresh,
  providersSaveRemote,
  providersSelectRemote,
  providersSnapshot,
  providersTestRemote,
} from "../../api/misty";
import type { ProvidersSnapshot, RcloneConfigPaths, RemoteEditDraft } from "../../api/types";
import { errorText } from "../../shared/format";
import { configPriority, stableConfig, updateTokenField } from "./providerUtils";

interface ProvidersStore {
  providers: ProvidersSnapshot | null;
  draft: RemoteEditDraft | null;
  originalDraft: RemoteEditDraft | null;
  configPaths: RcloneConfigPaths | null;
  tokenVisible: boolean;
  loading: boolean;
  working: boolean;
  error: string | null;
  message: string | null;
  load: (refresh?: boolean) => Promise<void>;
  selectRemote: (name: string, guardDirty?: boolean) => Promise<void>;
  setDraftName: (name: string) => void;
  setConfigField: (key: string, value: string) => void;
  setTokenField: (key: string, value: string) => void;
  setTokenVisible: (visible: boolean) => void;
  saveRemote: () => Promise<void>;
  testConnection: () => Promise<void>;
  revealConfig: () => Promise<void>;
}

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  providers: null,
  draft: null,
  originalDraft: null,
  configPaths: null,
  tokenVisible: false,
  loading: true,
  working: false,
  error: null,
  message: null,

  load: async (refresh = false) => {
    set({ loading: true, error: null });
    try {
      const next = refresh ? await providersRefresh() : await providersSnapshot();
      set({ providers: next });
      if (!get().draft && next.remotes.length > 0) {
        await get().selectRemote(next.remotes[0].name, false);
      }
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ loading: false });
    }
  },

  selectRemote: async (name, guardDirty = true) => {
    if (guardDirty && isDirty(get()) && !window.confirm("Discard unsaved remote edits?")) {
      return;
    }
    set({ error: null, message: null, tokenVisible: false });
    try {
      const nextDraft = await providersSelectRemote(name);
      set({ draft: nextDraft, originalDraft: nextDraft });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  setDraftName: (name) => {
    const { draft } = get();
    if (!draft) return;
    set({ draft: { ...draft, name } });
  },

  setConfigField: (key, value) => {
    const { draft } = get();
    if (!draft || key === "type") return;
    set({ draft: { ...draft, config: { ...draft.config, [key]: value } } });
  },

  setTokenField: (key, value) => {
    const { draft } = get();
    if (!draft) return;
    get().setConfigField("token", updateTokenField(draft.config.token ?? "", key, value));
  },

  setTokenVisible: (tokenVisible) => set({ tokenVisible }),

  saveRemote: async () => {
    const { draft, originalDraft } = get();
    if (!draft || !originalDraft || !isValidRemoteName(draft)) return;
    set({ working: true, error: null, message: null });
    try {
      const saved = await providersSaveRemote({
        originalName: originalDraft.originalName,
        name: draft.name,
        parameters: draft.config,
      });
      set({
        draft: saved,
        originalDraft: saved,
        providers: await providersRefresh(),
        message: "Remote saved.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  testConnection: async () => {
    const { draft } = get();
    if (!draft) return;
    set({ working: true, error: null, message: null });
    try {
      const result = await providersTestRemote(draft.name);
      set({
        message: result.message,
        draft: result.aboutJson ? { ...draft, aboutJson: result.aboutJson, lastCheckedUnix: result.checkedUnix } : draft,
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  revealConfig: async () => {
    set({ working: true, error: null, message: null });
    try {
      const paths = await providersConfigPaths();
      set({
        configPaths: paths,
        message: paths.configPath ? `Config path: ${paths.configPath}` : "Config paths loaded.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },
}));

export function selectProviderDerived(state: ProvidersStore) {
  return {
    dirty: isDirty(state),
    validRemoteName: state.draft ? isValidRemoteName(state.draft) : false,
    configKeys: state.draft
      ? Object.keys(state.draft.config)
          .filter((key) => key !== "type")
          .sort((left, right) => configPriority(left) - configPriority(right) || left.localeCompare(right))
      : [],
    status: state.providers
      ? state.providers.health.ready
        ? `Ready${state.providers.health.version ? ` · ${state.providers.health.version}` : ""}`
        : state.providers.health.error || state.providers.error || "Provider service unavailable"
      : "Starting",
  };
}

function isDirty(state: Pick<ProvidersStore, "draft" | "originalDraft">): boolean {
  if (!state.draft || !state.originalDraft) return false;
  return (
    state.draft.name !== state.originalDraft.name ||
    stableConfig(state.draft.config) !== stableConfig(state.originalDraft.config)
  );
}

function isValidRemoteName(draft: RemoteEditDraft): boolean {
  const trimmed = draft.name.trim();
  return trimmed.length > 0 && !trimmed.includes(":") && !trimmed.includes("/") && !trimmed.includes("\\");
}

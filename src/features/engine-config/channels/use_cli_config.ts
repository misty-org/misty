// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import {
  channelsApi,
  type CcSwitchImportResult,
  type CcSwitchStatus,
  type EngineChannels,
  type OfficialConfigDraft,
} from "./api";
import type { EngineId } from "./engines";
import {
  PSEUDO_DISABLED,
  PSEUDO_LOCAL,
  notifyCliConfigChanged,
  providerEntries,
  stripConventionEnv,
  type ProviderEntry,
} from "./providers";
import type { ProviderFormValue } from "./use_provider_form";

type DialogState = { entry?: ProviderEntry } | null;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const syncedText = (result: CcSwitchImportResult) =>
  `Imported: ${result.added} added, ${result.updated} updated, ${result.removed} removed`;

export interface CliConfigState {
  sections: EngineChannels[] | null;
  engine: EngineId;
  error: string | null;
  notice: string | null;
  busy: boolean;
  dialog: DialogState;
  setDialog: Dispatch<SetStateAction<DialogState>>;
  pendingDelete: ProviderEntry | null;
  setPendingDelete: Dispatch<SetStateAction<ProviderEntry | null>>;
  officialEditing: boolean;
  setOfficialEditing: Dispatch<SetStateAction<boolean>>;
  saveOfficialConfig: (files: OfficialConfigDraft[]) => Promise<string | null>;
  ccStatus: CcSwitchStatus | null;
  currentId: string;
  enabled: boolean;
  entries: ProviderEntry[];
  officialActive: boolean;
  mutate: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  activate: (id: string) => void;
  saveProvider: (value: ProviderFormValue) => void;
  confirmDelete: () => void;
  syncCcSwitch: (target: string) => Promise<void>;
  importCcSwitchFile: () => Promise<void>;
  dismissCcSwitch: () => void;
}

const CHANNELS_KEY = "engine-config/channels";

export function useCliConfig(engine: EngineId): CliConfigState {
  const channels = useCachedResource<EngineChannels[]>(CHANNELS_KEY, channelsApi.list);
  const sections = channels.data ?? null;
  const setSections = channels.set;
  const [changeError, setError] = useState<string | null>(null);
  const error = changeError ?? (channels.error && !sections ? errorText(channels.error) : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<ProviderEntry | null>(null);
  const [officialEditing, setOfficialEditing] = useState(false);
  const [ccStatus, setCcStatus] = useState<CcSwitchStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    channelsApi
      .ccSwitchCheck()
      .then((status) => {
        if (!cancelled && status.installed) setCcStatus(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await fn();
        notifyCliConfigChanged();
        setSections(await channelsApi.list());
        setError(null);
        return result;
      } catch (e) {
        setError(errorText(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [setSections],
  );

  const section = sections?.find((item) => item.engine === engine);
  const currentId = section?.current || PSEUDO_LOCAL;
  const enabled = currentId !== PSEUDO_DISABLED;
  const entries = useMemo(() => providerEntries(engine, section), [engine, section]);

  const activate = (id: string) => {
    if (id !== currentId) void mutate(() => channelsApi.setCurrent(engine, id));
  };

  const saveProvider = (value: ProviderFormValue) => {
    const rawObj =
      dialog?.entry?.raw && typeof dialog.entry.raw === "object"
        ? (dialog.entry.raw as Record<string, unknown>)
        : {};
    let next: Record<string, unknown>;
    if (engine === "claude" || engine === "codex") {
      next = { ...rawObj };
      for (const key of ["name", "remark", "baseUrl", "apiKey", "model", "settingsConfig", "env"]) {
        delete next[key];
      }
    } else {
      next = dialog?.entry ? stripConventionEnv(engine, rawObj) : {};
    }
    const put = (key: string, val: string) => {
      const trimmed = val.trim();
      if (trimmed) next[key] = trimmed;
    };
    put("name", value.name);
    put("remark", value.remark);
    put("baseUrl", value.baseUrl);
    put("apiKey", value.apiKey);
    if (engine === "claude") {
      try {
        const parsed: unknown = JSON.parse(value.settingsJson || "{}");
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          next.settingsConfig = parsed;
        }
      } catch {}
    } else if (engine === "codex") {
      put("model", value.model);
      const sc: Record<string, unknown> = {};
      const prevSc = rawObj.settingsConfig;
      if (prevSc && typeof prevSc === "object") {
        for (const [k, v] of Object.entries(prevSc)) {
          if (k !== "config" && k !== "auth") sc[k] = v;
        }
      }
      if (value.configToml.trim()) sc.config = value.configToml.trim();
      if (value.authJson.trim()) {
        try {
          sc.auth = JSON.parse(value.authJson);
        } catch {}
      }
      if (Object.keys(sc).length > 0) next.settingsConfig = sc;
    } else {
      put("model", value.model);
    }
    const id = dialog?.entry?.id ?? crypto.randomUUID();
    setDialog(null);
    void mutate(() => channelsApi.upsert(engine, id, next));
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    void mutate(() => channelsApi.remove(engine, id));
  };

  const syncCcSwitch = async (target: string) => {
    const result = await mutate(() => channelsApi.ccSwitchImport(target));
    if (!result) return;
    setCcStatus((status) => (status ? { ...status, changed: false } : status));
    setNotice(syncedText(result));
  };

  const importCcSwitchFile = async () => {
    const result = await mutate(() => channelsApi.ccSwitchImportFile(engine));
    if (!result) return;
    setNotice(syncedText(result));
  };

  const dismissCcSwitch = () => {
    if (!ccStatus) return;
    void channelsApi.ccSwitchDismiss(ccStatus.hash).catch(() => {});
    setCcStatus({ ...ccStatus, changed: false });
  };

  const officialActive = currentId === PSEUDO_LOCAL;

  const saveOfficialConfig = useCallback(
    async (files: OfficialConfigDraft[]): Promise<string | null> => {
      setBusy(true);
      try {
        await channelsApi.officialWrite(engine, files);
        setOfficialEditing(false);
        return null;
      } catch (e) {
        return errorText(e);
      } finally {
        setBusy(false);
      }
    },
    [engine],
  );

  return {
    sections,
    engine,
    error,
    notice,
    busy,
    dialog,
    setDialog,
    pendingDelete,
    setPendingDelete,
    officialEditing,
    setOfficialEditing,
    saveOfficialConfig,
    ccStatus,
    currentId,
    enabled,
    entries,
    officialActive,
    mutate,
    activate,
    saveProvider,
    confirmDelete,
    syncCcSwitch,
    importCcSwitchFile,
    dismissCcSwitch,
  };
}

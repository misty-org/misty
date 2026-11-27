import { listen as listenEvent } from "@tauri-apps/api/event";
import { create } from "zustand";
import { useSettingsStore } from "@/features/settings";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { SPEECH_CHANGED } from "./speech";
import { voiceSettings } from "./voice_settings";
import { notify } from "@misty/ui";

export interface SpeechPackageView {
  url: string;
  sha256: string;
  size: number;
}

interface CatalogEntryView {
  id: string;
  name: string;
  maker: string;
  source: string;
  license: string;
  languages: string[];
  package: SpeechPackageView;
  disk_mb: number;
  memory_mb: number;
  installed: boolean;
  outdated: boolean;
  packageKey: string;
}

export interface HearingModelView extends CatalogEntryView {
  credit?: string;
  description: string;
  detects_language: boolean;
  family: string;
  accuracy: 1 | 2 | 3;
  speed: 1 | 2 | 3;
  words: boolean;
}

export interface Machine {
  memoryMb: number;
  cores: number;
  appleSilicon: boolean;
  diskFreeMb: number | null;
}

interface CatalogView {
  hearing: HearingModelView[];
  supportInstalled: boolean;
  machine: Machine;
  installing: string[];
}

export interface InstallProgress {
  received: number;
  total: number;
  phase: "downloading" | "unpacking";
}

interface InstallPayload {
  id: string;
  received?: number;
  total?: number;
  phase?: "unpacking" | "done" | "failed";
  error?: string;
}

export function personLanguages(language?: string): string[] {
  const settings = voiceSettings(useSettingsStore.getState().settings?.document);
  const system = (typeof navigator === "undefined" ? "en" : navigator.language || "en")
    .split(/[-_]/)[0]
    .toLowerCase();
  const main = language ?? settings.language;
  const first = main === "auto" ? system : main;
  const second = settings.secondLanguage === "none" ? undefined : settings.secondLanguage;
  return second && second !== first ? [first, second] : [first];
}

export function covers(entry: { languages: string[] }, languages: readonly string[]) {
  return entry.languages.includes("*") || languages.every((code) => entry.languages.includes(code));
}

const SLOW = 0.5;
const SLOW_KEY = "misty.speech.slow";

function measuredSlow(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SLOW_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function markSlow(id: string) {
  const slow = measuredSlow();
  slow.add(id);
  try {
    localStorage.setItem(SLOW_KEY, JSON.stringify([...slow]));
  } catch {}
}

const modest = (machine: Machine) =>
  !machine.appleSilicon && (machine.cores <= 4 || machine.memoryMb < 8_000);

export function rankHearing(
  models: readonly HearingModelView[],
  languages: readonly string[],
  machine: Machine,
): HearingModelView[] {
  const slow = measuredSlow();
  const fits = (model: HearingModelView) =>
    model.memory_mb * 1.5 <= machine.memoryMb &&
    (machine.diskFreeMb === null ||
      model.installed ||
      model.disk_mb + model.package.size / 1_000_000 <= machine.diskFreeMb);
  const quick = (model: HearingModelView) =>
    !slow.has(model.id) && (!modest(machine) || model.speed >= 2);
  const covering = models.filter((model) => covers(model, languages));
  const sized = covering.filter(fits);
  const chosen = sized.filter(quick);
  const pool = chosen.length ? chosen : sized.length ? sized : covering;
  return [...pool].sort(
    (a, b) =>
      Number(a.languages.includes("*")) - Number(b.languages.includes("*")) ||
      b.accuracy - a.accuracy ||
      b.speed - a.speed ||
      a.disk_mb - b.disk_mb,
  );
}

interface SpeechModelsState {
  catalog: CatalogView | null;
  error: string | null;
  progress: Record<string, InstallProgress>;
  failures: Record<string, string>;
  load(): Promise<void>;
  install(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

let listening = false;

export const useSpeechModels = create<SpeechModelsState>((set, get) => ({
  catalog: null,
  error: null,
  progress: {},
  failures: {},
  async load() {
    listenOnce(set, get);
    try {
      const catalog = await invoke<CatalogView>("speech_catalog");
      set({ catalog, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Speech models couldn't load." });
    }
  },
  async install(id) {
    listenOnce(set, get);
    set((state) => ({
      progress: { ...state.progress, [id]: { received: 0, total: 0, phase: "downloading" } },
      failures: omit(state.failures, id),
    }));
    try {
      await invoke("speech_install", { id });
      const ready = async () => {
        await get().load();
        const model = get().catalog?.hearing.find((item) => item.id === id);
        notify({ message: `${model?.name ?? "The hearing model"} is ready` });
      };
      void ready();
    } catch (error) {
      set((state) => ({
        failures: {
          ...state.failures,
          [id]: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      set((state) => ({ progress: omit(state.progress, id) }));
      await get().load();
      announce();
    }
  },
  async remove(id) {
    await invoke("speech_remove", { id });
    await get().load();
    announce();
  },
}));

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function announce() {
  window.dispatchEvent(new CustomEvent(SPEECH_CHANGED));
}

function listenOnce(
  set: (partial: (state: SpeechModelsState) => Partial<SpeechModelsState>) => void,
  _get: () => SpeechModelsState,
) {
  if (listening || !hasTauriInternals()) return;
  listening = true;
  void listenEvent<InstallPayload>("misty://speech-install", ({ payload }) => {
    if (payload.phase === "done" || payload.phase === "failed") return;
    set((state) => ({
      progress: {
        ...state.progress,
        [payload.id]: {
          received: payload.received ?? state.progress[payload.id]?.received ?? 0,
          total: payload.total ?? state.progress[payload.id]?.total ?? 0,
          phase: payload.phase === "unpacking" ? "unpacking" : "downloading",
        },
      },
    }));
  });
}

function setVoiceSetting(key: "hearing_model" | "speaking_voice", value: string) {
  useSettingsStore.getState().updateSetting("voice", key, value);
}

export function chooseMistyVoice(id: string) {
  setVoiceSetting("speaking_voice", id);
}

export function chooseHearing(id: string) {
  setVoiceSetting("hearing_model", id);
}

let picking: Promise<void> | null = null;
let again = false;

export function ensureSpeech(): Promise<void> {
  if (picking) {
    again = true;
    return picking;
  }
  picking = (async () => {
    try {
      const store = useSpeechModels.getState();
      if (!store.catalog) await store.load();
      const catalog = useSpeechModels.getState().catalog;
      if (!catalog) return;
      const settings = voiceSettings(useSettingsStore.getState().settings?.document);
      const languages = personLanguages();
      const picked = catalog.hearing.find((model) => model.id === settings.hearingModel);
      let hearing = picked && covers(picked, languages) ? picked : undefined;
      if (!hearing) {
        hearing = rankHearing(catalog.hearing, languages, catalog.machine)[0];
        if (hearing) setVoiceSetting("hearing_model", hearing.id);
      }
      let hearingId = hearing?.id;
      await apply(hearingId);
      if (hearing && (!hearing.installed || !catalog.supportInstalled)) {
        await useSpeechModels.getState().install(hearing.id);
        hearingId = (await checkSpeed(hearing.id, languages)) ?? hearingId;
      }
      await apply(hearingId);
    } finally {
      picking = null;
      if (again) {
        again = false;
        void ensureSpeech();
      }
    }
  })();
  return picking;
}

async function checkSpeed(id: string, languages: readonly string[]): Promise<string | undefined> {
  const seconds = await invoke<number>("speech_measure", { id }).catch(() => null);
  if (seconds === null || seconds <= SLOW) return undefined;
  markSlow(id);
  const catalog = useSpeechModels.getState().catalog;
  if (!catalog) return undefined;
  const next = rankHearing(catalog.hearing, languages, catalog.machine).find(
    (model) => model.id !== id,
  );
  if (!next) return undefined;
  setVoiceSetting("hearing_model", next.id);
  if (!next.installed) await useSpeechModels.getState().install(next.id);
  return next.id;
}

export async function apply(hearing?: string) {
  if (!hasTauriInternals()) return;
  const settings = voiceSettings(useSettingsStore.getState().settings?.document);
  await invoke("speech_use", {
    hearing: hearing || settings.hearingModel || null,
    voice: settings.voice || null,
    language:
      settings.language === "auto" || settings.secondLanguage !== "none" ? null : settings.language,
    rate: settings.speakingRate,
  }).catch(() => undefined);
  announce();
}

function speechKey(document: Record<string, unknown> | undefined) {
  const settings = voiceSettings(document);
  return [
    settings.language,
    settings.secondLanguage,
    settings.voice,
    settings.hearingModel,
    settings.speakingRate,
  ].join("|");
}

export function watchSpeechSetup(): () => void {
  let last = "";
  const check = () => {
    const document = useSettingsStore.getState().settings?.document;
    if (!document) return;
    const key = speechKey(document);
    if (key === last) return;
    last = key;
    void ensureSpeech();
  };
  check();
  return useSettingsStore.subscribe(check);
}

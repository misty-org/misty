import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useSettingsStore } from "@/features/settings";
import {
  chooseHearing,
  useSpeechModels,
  type HearingModelView,
  type InstallProgress,
} from "@/features/voice";
import { voiceSettings } from "@/features/voice/voice_settings";

import { ErrorState, useConfirmDelete } from "@misty/ui";

import { type BarAction } from "./explore_view";

export type SpeechEntry = HearingModelView;

export const accuracyWords = ["", "Fair", "Good", "Best"];
export const speedWords = ["", "Slower", "Fast", "Fastest"];
export const languageNames =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;
export const languageName = (code: string) => languageNames?.of(code) ?? code;
export const gigabytes = (megabytes: number) =>
  megabytes >= 1000 ? `${(megabytes / 1000).toFixed(1)} GB` : `${megabytes} MB`;
export const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function pillProgress(progress: InstallProgress | undefined, downloading: boolean) {
  if (!progress) return downloading ? { value: 0 } : undefined;
  if (progress.phase === "unpacking") return { value: 1 };
  return { value: progress.total ? progress.received / progress.total : 0 };
}

export function useSpeech() {
  const catalog = useSpeechModels((state) => state.catalog);
  const error = useSpeechModels((state) => state.error);
  const progress = useSpeechModels((state) => state.progress);
  const failures = useSpeechModels((state) => state.failures);
  const settingsDocument = useSettingsStore((state) => state.settings?.document);
  useEffect(() => {
    if (!useSpeechModels.getState().catalog) void useSpeechModels.getState().load();
  }, []);
  const settings = voiceSettings(settingsDocument);
  const stateOf = (entry: SpeechEntry) => {
    const coming = progress[entry.id] ?? progress[entry.packageKey];
    const downloading =
      Boolean(coming) ||
      Boolean(catalog?.installing.some((id) => id === entry.id || id === entry.packageKey));
    return { coming, downloading, failure: failures[entry.id] };
  };
  return { catalog, error, settings, stateOf };
}

export function SpeechFailed({ error }: { error: string }) {
  return (
    <ErrorState
      inline
      title="Speech models couldn't load"
      line={error}
      action={{
        label: "Try again",
        icon: RefreshCw,
        variant: "secondary",
        onClick: () => void useSpeechModels.getState().load(),
      }}
    />
  );
}

export function hearingAction(
  model: HearingModelView,
  current: string,
  downloading: boolean,
  manage: () => void,
  coming?: InstallProgress,
): BarAction {
  if (model.installed && model.id === current)
    return { label: "Manage", variant: "secondary", onClick: manage };
  if (model.installed)
    return { label: "Use", variant: "secondary", onClick: () => chooseHearing(model.id) };
  return {
    label: "Get",
    variant: "get",
    progress: pillProgress(coming, downloading),
    onClick: () => void useSpeechModels.getState().install(model.id),
  };
}

export function languagesLine(model: HearingModelView) {
  if (model.languages.includes("*")) return "Over 1,600 languages";
  if (model.languages.length === 1) return `${languageName(model.languages[0])} only`;
  return `${model.languages.length} languages`;
}

export function useRemove(entry: SpeechEntry, inUse: boolean) {
  const { catalog } = useSpeech();
  const { confirm, dialog } = useConfirmDelete();
  const shared = (catalog?.hearing ?? []).some(
    (other) => other.id !== entry.id && other.packageKey === entry.packageKey && other.installed,
  );
  const remove = () =>
    void confirm({
      title: `Remove ${entry.name}?`,
      what: `${entry.name} is deleted from this computer${
        shared ? ", with the models that came in the same download" : ""
      }. You can get it again here.`,
      confirmLabel: "Remove",
      onConfirm: () => useSpeechModels.getState().remove(entry.id),
    });
  return { remove: inUse ? null : remove, dialog };
}

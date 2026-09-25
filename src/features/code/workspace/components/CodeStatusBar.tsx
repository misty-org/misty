import { useShallow } from "zustand/react/shallow";
import { selectEditorPreferences, useSettingsStore } from "@/features/settings";
import { useShortcutTitle } from "@/features/shortcuts";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { useEditorEphemeralStore } from "../store/useEditorEphemeralStore";
import { createCodeStatusBar } from "./createCodeStatusBar";
export const CodeStatusBar = createCodeStatusBar({
  store: useCodingWorkspaceStore,
  editorStore: useEditorEphemeralStore,
  useShortcutTitle,
  usePreferences: () =>
    useSettingsStore(useShallow((state) => selectEditorPreferences(state.settings?.document))),
  updatePreference: (key, value) => {
    void useSettingsStore.getState().updateSetting("editor", key, value);
  },
});

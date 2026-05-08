import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_ANTHROPIC_URL,
  DEFAULT_OPENAI_COMPAT_URL,
  DEFAULT_SETTINGS,
  type AiSettings,
  type ProviderId,
} from "./providers";

interface AiSettingsState extends AiSettings {
  hasKey: boolean;
  setProvider: (providerId: ProviderId) => void;
  setBaseUrl: (baseUrl: string) => void;
  setModel: (model: string) => void;
  setHasKey: (hasKey: boolean) => void;
}

export const useAiSettings = create<AiSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      hasKey: false,
      setProvider: (providerId) =>
        set(() => ({
          providerId,
          baseUrl:
            providerId === "anthropic" ? DEFAULT_ANTHROPIC_URL : DEFAULT_OPENAI_COMPAT_URL,
        })),
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setModel: (model) => set({ model }),
      setHasKey: (hasKey) => set({ hasKey }),
    }),
    {
      name: "misty:coding-ai:v1",
      partialize: ({ providerId, baseUrl, model }) => ({ providerId, baseUrl, model }),
    },
  ),
);

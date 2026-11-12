import { DesktopSettingsSection as Section } from "@/features/settings";
import { useNotice } from "@/shared/ui";
import { useState } from "react";
import { ModelKeyRow } from "./ModelKeyRow";
import { ModelDropdownRow, ModelTextRow, useModelSetting } from "./ModelChoiceRows";
import { useProviderModels, type AddedKey } from "./modelAccounts";
import { useSavedModelKeys } from "./modelKeys";
import { ConnectedAppsKeySection, WebSearchSection } from "./WebSearchSection";
import {
  defaultAgentModel,
  modelProviders,
  modelSuggestions,
  providerById,
  qualifiedModel,
  reasoningLevels,
  videoModels,
  voiceProviders,
} from "./modelProviders";

/**
 * Settings › Models. Engines do the agents' thinking; these are the raw models Misty calls on the
 * person's own keys for the work that isn't an engine's (Tutor, reading the screen, notes, video,
 * voice). A key from any provider is pasted here (its provider is found from the key) and goes to
 * the keychain through the native app; the model choices are device settings, and each model
 * names its provider (`anthropic/claude-haiku-5-5`). A web search key is kept the same way
 * (WebSearchSection).
 */
const unshown = "It can’t be shown again once saved.";

export function ModelsSection() {
  const keys = useSavedModelKeys();
  const provider = useModelSetting("models.provider");
  const main = useModelSetting("models.agent_model");
  const [listRevision, setListRevision] = useState(0);
  const selected = providerById(provider.value) ?? modelProviders[0]!;
  const ready = Boolean(selected.keyOptional || keys.saved?.includes(selected.id));
  const listed = useProviderModels(selected.id, ready, listRevision);
  const suggest = (role: "agent" | "fast" | "embedding") =>
    modelSuggestions(selected, role, listed);
  const qualify = (value: string) => qualifiedModel(value, selected.id);
  const savedLabels = modelProviders
    .filter((item) => keys.saved?.includes(item.id))
    .map((item) => item.label);
  useNotice(keys.unreadable, {
    message: "Saved keys couldn't be read from the keychain. Restart Misty and try again.",
    tone: "error",
  });
  // A new key's provider becomes the one shown, and gives the main model one when it has none.
  const adopt = (added: AddedKey) => {
    if (added.provider !== provider.value) provider.set(added.provider);
    setListRevision((value) => value + 1);
    const first = defaultAgentModel(added.provider, added.models);
    if (first && !main.value) main.set(first);
  };
  return (
    <>
      <Section
        title="Provider"
        description="Keys stay in this computer’s keychain and go only to the provider."
      >
        <ModelDropdownRow
          id="models.provider"
          label="Provider"
          description={
            savedLabels.length
              ? `The provider whose key and models you are editing. Keys saved for ${savedLabels.join(", ")}.`
              : "The provider whose key and models you are editing."
          }
          options={modelProviders.map((item) => ({ value: item.id, label: item.label }))}
        />
        <ModelKeyRow
          label="API key"
          keyName={`${selected.label} key`}
          description={
            selected.keyOptional
              ? `${selected.label} works without a key unless it asks for one.`
              : selected.keyPage
                ? `Paste a key from ${selected.keyPage.replace(/^https:\/\//, "")}. ${unshown}`
                : `Paste a key from any provider; Misty finds which one it’s for. ${unshown}`
          }
          providerId={selected.id}
          keys={keys}
          onSave={async (key) => adopt(await keys.add(key, selected.id))}
        />
        {selected.baseUrlSetting ? (
          <ModelTextRow
            id={selected.baseUrlSetting}
            label="Base URL"
            description="This computer calls this address, so a server on it or your network works."
            placeholder={
              selected.id === "ollama" ? "http://127.0.0.1:11434/v1" : "http://127.0.0.1:8000/v1"
            }
          />
        ) : null}
      </Section>
      <Section
        title="Choices"
        description="Write a model as provider/model. A name without a provider uses the provider above."
      >
        <ModelTextRow
          id="models.agent_model"
          label="Main model"
          description="Reads the screen for screen control and Tutor's pointer, and writes notes from recordings."
          placeholder={suggest("agent")[0] ?? `${selected.id}/model`}
          suggestions={suggest("agent")}
          normalize={qualify}
        />
        <ModelTextRow
          id="models.fast_model"
          label="Fast model"
          description={
            "Tutor's live conversation, chat titles and summaries. " +
            "Optional; the main model does these when empty."
          }
          placeholder="Same as main model"
          suggestions={suggest("fast")}
          normalize={qualify}
        />
        <ModelTextRow
          id="models.embedding_model"
          label="Embedding model"
          description="Searches memory and the library. Optional; that search is off when empty."
          placeholder="Off"
          suggestions={suggest("embedding")}
          normalize={qualify}
        />
        <ModelTextRow
          id="models.video_model"
          label="Video model"
          description="Films the scenes of Tutor's video overviews, on your Google key. Optional; scenes show drawings when empty."
          placeholder="Off"
          suggestions={videoModels}
          normalize={(value) => qualifiedModel(value, "google")}
        />
        <ModelDropdownRow
          id="models.reasoning"
          label="Reasoning effort"
          description="How long these models think before answering. Higher is slower and costs more."
          options={reasoningLevels}
        />
      </Section>
      <WebSearchSection keys={keys} />
      <ConnectedAppsKeySection keys={keys} />
      <Section
        title="Voice keys"
        description="Optional keys for reading answers aloud and for dictation."
      >
        {voiceProviders.map((voice) => (
          <div key={voice.id}>
            <ModelKeyRow
              label={`${voice.label} key`}
              description={
                voice.role === "speech"
                  ? "Reads answers aloud."
                  : "Transcribes dictation and voice messages."
              }
              providerId={voice.id}
              keys={keys}
            />
            <ModelTextRow
              id={voice.role === "speech" ? "models.speech_model" : "models.transcription_model"}
              label={voice.role === "speech" ? "Speech model" : "Transcription model"}
              description={`Used when the ${voice.label} key is saved, or another provider you name here has one.`}
              normalize={(value) => qualifiedModel(value, voice.id)}
            />
            {voice.role === "speech" ? (
              <ModelTextRow
                id="models.speech_voice"
                label="ElevenLabs voice ID"
                description="The voice that reads answers aloud. Free plans need one of your own."
                normalize={(value) => value.trim()}
              />
            ) : null}
          </div>
        ))}
      </Section>
    </>
  );
}

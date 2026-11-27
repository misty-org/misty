import { ExternalLink, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { listen, type HearingModelView, type Listening } from "@/features/voice";
import { openExternalLink } from "@/shared/platform/open_external_link";

import {
  Button,
  CatalogNames,
  MenuItem,
  notify,
  SettingsRow,
  SettingsSection,
  StoreInfo,
  StoreSheet,
  StoreSheetSection,
  Text,
} from "@misty/ui";
import { failureText } from "./explore_index";

import { ActionButton } from "./ListingRows";

import { MakerTile, pluginMaker } from "./PluginMaker";

import {
  accuracyWords,
  gigabytes,
  hearingAction,
  languageName,
  speedWords,
  useRemove,
  useSpeech,
} from "./ExploreSpeechParts";

export function SpeechSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { catalog } = useSpeech();
  const model = catalog?.hearing.find((one) => one.id === id);
  return model ? <HearingSheet model={model} onClose={onClose} /> : null;
}

function HearingSheet({ model, onClose }: { model: HearingModelView; onClose: () => void }) {
  const { settings, stateOf } = useSpeech();
  const current = settings.hearingModel === model.id;
  const { coming, downloading, failure } = stateOf(model);
  const action = hearingAction(model, settings.hearingModel, downloading, coming);
  const { remove, dialog } = useRemove(model, current);
  const everyLanguage = model.languages.includes("*");
  return (
    <StoreSheet
      open
      onOpenChange={(open) => !open && onClose()}
      logo={
        <MakerTile
          maker={pluginMaker({ author: model.maker, link: model.source })}
          name={model.name}
          size="sheet"
        />
      }
      title={model.name}
      maker={model.maker}
      action={<ActionButton action={action} size="md" label={model.name} />}
      menu={
        <MenuItem
          icon={ExternalLink}
          label="Open website"
          onSelect={() => void openExternalLink(model.source)}
        />
      }
      facts={[
        {
          label: "Languages",
          value: everyLanguage ? "1,600+" : String(model.languages.length),
        },
        { label: "Accuracy", value: accuracyWords[model.accuracy] },
        { label: "Speed", value: speedWords[model.speed] },
        { label: "Size", value: gigabytes(model.disk_mb) },
        { label: "License", value: model.license },
      ]}
    >
      {model.description || failure ? (
        <Text as="p" size="body" wrap className="m-0">
          {failure ?? model.description}
        </Text>
      ) : null}
      <StoreSheetSection title="Languages">
        {everyLanguage ? (
          <Text size="meta" tone="muted" wrap>
            Over 1,600 languages
          </Text>
        ) : (
          <CatalogNames names={model.languages.map(languageName)} />
        )}
      </StoreSheetSection>
      {model.installed ? (
        <SettingsSection title="On this computer">
          <SettingsRow
            label={current ? "In use" : "Downloaded"}
            description={`For dictation, voice chat, calls and Tutor, ${gigabytes(model.memory_mb)} of memory while hearing`}
          />
        </SettingsSection>
      ) : null}
      {current && model.installed ? <TryHearing /> : null}
      <StoreSheetSection title="Information">
        <StoreInfo
          items={[
            { label: "Made by", value: model.maker },
            { label: "License", value: model.license },
            {
              label: "Finds the language",
              value: model.detects_language ? "Yes" : "No, set it in Settings",
            },
            { label: "Runs on", value: "sherpa-onnx, on this computer" },
            ...(model.credit ? [{ label: "Credit", value: model.credit }] : []),
          ]}
        />
      </StoreSheetSection>
      {model.installed && remove ? (
        <div>
          <Button variant="danger" onClick={remove}>
            Remove
          </Button>
        </div>
      ) : null}
      {dialog}
    </StoreSheet>
  );
}

function TryHearing() {
  const [heard, setHeard] = useState("");
  const [on, setOn] = useState(false);
  const session = useRef<Listening | null>(null);
  useEffect(() => () => void session.current?.stop(), []);
  const toggle = async () => {
    if (session.current) {
      const done = session.current;
      session.current = null;
      setOn(false);
      await done.stop().catch(() => undefined);
      return;
    }
    try {
      setHeard("");
      setOn(true);
      session.current = await listen(({ text, error }) => {
        if (error) notify({ message: error, tone: "error" });
        setHeard(text);
      });
    } catch (reason) {
      setOn(false);
      notify({ message: failureText(reason, "The microphone couldn't start."), tone: "error" });
    }
  };
  return (
    <SettingsSection title="Try it">
      <SettingsRow label={heard || "Say a sentence"}>
        <Button size="sm" icon={on ? Square : Mic} onClick={() => void toggle()}>
          {on ? "Stop" : "Listen"}
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

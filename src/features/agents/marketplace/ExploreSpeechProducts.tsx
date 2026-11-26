import { ExternalLink, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { chooseHearing, listen, type HearingModelView, type Listening } from "@/features/voice";
import { openExternalLink } from "@/shared/platform/open_external_link";

import {
  Button,
  EmptyState,
  MenuItem,
  notify,
  ProductInfo,
  ProductPage,
  ProductSection,
  SettingsRow,
  SettingsSection,
  Switch,
} from "@misty/ui";
import { failureText } from "./explore_index";

import { useBarAction, useExploreNav } from "./explore_view";

import { ActionButton } from "./ListingRows";

import { MakerTile, pluginMaker } from "./PluginMaker";

import {
  accuracyWords,
  gigabytes,
  hearingAction,
  languageName,
  speedWords,
  SpeechFailed,
  useRemove,
  useSpeech,
} from "./ExploreSpeechParts";

export function SpeechProduct({ id }: { id: string }) {
  const { catalog, error } = useSpeech();
  if (!catalog) return error ? <SpeechFailed error={error} /> : null;
  const model = catalog.hearing.find((one) => one.id === id);
  return model ? (
    <HearingProduct model={model} />
  ) : (
    <EmptyState
      inline
      title="This model isn't listed any more"
      line="Misty's registry no longer has it."
    />
  );
}

function HearingProduct({ model }: { model: HearingModelView }) {
  const nav = useExploreNav();
  const { settings, stateOf } = useSpeech();
  const current = settings.hearingModel === model.id;
  const { coming, downloading } = stateOf(model);
  const action = hearingAction(
    model,
    settings.hearingModel,
    downloading,
    () => nav.manage({ kind: "hearing", id: model.id }),
    coming,
  );
  useBarAction(action, model.name);
  return (
    <ProductPage
      logo={
        <MakerTile
          maker={pluginMaker({ author: model.maker, link: model.source })}
          name={model.name}
          size="hero"
        />
      }
      title={model.name}
      line={model.description}
      maker={model.maker}
      onMaker={() => void openExternalLink(model.source)}
      action={<ActionButton action={action} size="md" label={model.name} />}
      menu={
        <MenuItem
          icon={ExternalLink}
          label="Open website"
          onSelect={() => void openExternalLink(model.source)}
        />
      }
      onHeroOut={nav.setPinned}
      facts={[
        {
          label: "Languages",
          value: model.languages.includes("*") ? "1,600+" : String(model.languages.length),
          detail: model.detects_language ? "Finds the language" : "Set in Settings",
        },
        { label: "Accuracy", value: accuracyWords[model.accuracy] },
        { label: "Speed", value: speedWords[model.speed] },
        { label: "Download", value: gigabytes(model.disk_mb) },
        { label: "Memory", value: gigabytes(model.memory_mb), detail: "While hearing" },
        { label: "Runs on", value: "sherpa-onnx", detail: "This computer" },
      ]}
    >
      {current && model.installed ? <TryHearing /> : null}
      <ProductSection title="Information">
        <ProductInfo
          items={[
            { label: "Made by", value: model.maker },
            { label: "License", value: model.license },
            {
              label: "Languages",
              value: model.languages.includes("*")
                ? "Over 1,600"
                : model.languages.map(languageName).join(", "),
            },
            ...(model.credit ? [{ label: "Credit", value: model.credit }] : []),
          ]}
        />
      </ProductSection>
    </ProductPage>
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
    <ProductSection title="Try it">
      <SettingsSection>
        <SettingsRow label={heard || "Say a sentence"}>
          <Button size="sm" icon={on ? Square : Mic} onClick={() => void toggle()}>
            {on ? "Stop" : "Listen"}
          </Button>
        </SettingsRow>
      </SettingsSection>
    </ProductSection>
  );
}

export function SpeechManage({ id }: { id: string }) {
  const { catalog } = useSpeech();
  const model = catalog?.hearing.find((one) => one.id === id);
  if (!model?.installed) return null;
  return <HearingManage model={model} />;
}

function HearingManage({ model }: { model: HearingModelView }) {
  const { settings } = useSpeech();
  const current = settings.hearingModel === model.id;
  const { remove, dialog } = useRemove(model, current);
  return (
    <>
      <SettingsSection title={model.name}>
        <SettingsRow label="Hearing model" description="For dictation, voice chat, calls and Tutor">
          <Switch
            checked={current}
            disabled={current}
            onCheckedChange={(on) => on && chooseHearing(model.id)}
            aria-label="Use this hearing model"
          />
        </SettingsRow>
        {remove ? (
          <SettingsRow
            label="Remove from this computer"
            description={`Frees ${gigabytes(model.disk_mb)}`}
          >
            <Button variant="danger" size="sm" onClick={remove}>
              Remove
            </Button>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {dialog}
    </>
  );
}

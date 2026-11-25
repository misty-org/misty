import { openSettings } from "@/features/settings";
import { personLanguages, rankHearing, type HearingModelView } from "@/features/voice";
import {
  Button,
  SettingsRow,
  SettingsSection,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
  Text,
} from "@misty/ui";
import { useExploreNav } from "./explore_view";
import { ActionButton } from "./ListingRows";

import { MakerTile, pluginMaker } from "./PluginMaker";

import {
  accuracyWords,
  gigabytes,
  hearingAction,
  languageName,
  languagesLine,
  progressLine,
  SpeechFailed,
  useSpeech,
} from "./ExploreSpeechParts";

function HearingItem({ model, current }: { model: HearingModelView; current: string }) {
  const nav = useExploreNav();
  const { stateOf } = useSpeech();
  const { coming, downloading, failure } = stateOf(model);
  const open = () => nav.open({ kind: "hearing", id: model.id });
  const manage = () => nav.manage({ kind: "hearing", id: model.id });
  return (
    <ShelfItem
      logo={
        <MakerTile
          maker={pluginMaker({ author: model.maker, link: model.source })}
          name={model.name}
        />
      }
      title={model.name}
      line={
        coming
          ? progressLine(coming)
          : (failure ??
            `${languagesLine(model)}, ${accuracyWords[model.accuracy].toLowerCase()} accuracy, ${gigabytes(model.disk_mb)}`)
      }
      action={<ActionButton action={hearingAction(model, current, downloading, manage)} />}
      onOpen={() => open()}
    />
  );
}

export function SpeechPage() {
  const { catalog, error, settings } = useSpeech();
  if (!catalog)
    return error ? (
      <SpeechFailed error={error} />
    ) : (
      <>
        <ShelfSkeleton label="Hearing models" items={3} />
      </>
    );
  const languages = personLanguages();
  const current = catalog.hearing.find((model) => model.id === settings.hearingModel);
  const ranked = [
    ...(current ? [current] : []),
    ...rankHearing(catalog.hearing, languages, catalog.machine).filter(
      (model) => model.id !== current?.id,
    ),
  ];
  const hearing = [...ranked, ...catalog.hearing.filter((model) => !ranked.includes(model))];
  const hearingFamilies = [...new Set(catalog.hearing.map((model) => model.name.split(" ")[0]))];
  const said = (codes: string[]) => codes.map(languageName).join(" and ");
  return (
    <>
      {current ? (
        <SettingsSection title="Hearing now">
          <SettingsRow
            label={current.name}
            description={`Picked for ${said(languages)}, your languages in Settings`}
          >
            <Button size="sm" onClick={() => openSettings("voice")}>
              Change
            </Button>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      <Shelf title="Hearing models">
        {hearing.map((model) => (
          <HearingItem key={model.id} model={model} current={settings.hearingModel} />
        ))}
      </Shelf>
      <SettingsSection title="What Misty runs">
        <SettingsRow label="Speech runtime">
          <Text size="meta" tone="muted">
            sherpa-onnx, on this computer
          </Text>
        </SettingsRow>
        <SettingsRow label="Hearing">
          <Text size="meta" tone="muted">
            {hearingFamilies.join(", ")}
          </Text>
        </SettingsRow>
        <SettingsRow label="Voices">
          <Text size="meta" tone="muted">
            Voicebox, on this computer
          </Text>
        </SettingsRow>
        <SettingsRow label="This computer">
          <Text size="meta" tone="muted">
            {`${Math.round(catalog.machine.memoryMb / 1024)} GB of memory`}
          </Text>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

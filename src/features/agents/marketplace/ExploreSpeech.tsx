import { openSettings } from "@/features/settings";
import {
  personLanguages,
  rankHearing,
  useVoicebox,
  useVoiceboxProgress,
  VOICEBOX_APP_ID,
  type HearingModelView,
  type VoiceboxState,
} from "@/features/voice";
import {
  AppLogoImage,
  Button,
  StoreCard,
  StoreCards,
  StoreSection,
  StoreSkeleton,
  Text,
} from "@misty/ui";
import { AppLogo, megabytes, useAppAction } from "./ExploreApps";
import { exploreApps, type ExploreCatalogApp, type ExploreInstalledApps } from "./explore_apps";
import { useExploreNav } from "./explore_view";
import { ActionButton } from "./ListingRows";
import { MakerTile, pluginMaker } from "./PluginMaker";
import {
  accuracyWords,
  gigabytes,
  hearingAction,
  languageName,
  languagesLine,
  SpeechFailed,
  useSpeech,
} from "./ExploreSpeechParts";

export function HearingCard({ model, current }: { model: HearingModelView; current: string }) {
  const nav = useExploreNav();
  const { stateOf } = useSpeech();
  const { coming, downloading, failure } = stateOf(model);
  const inUse = model.installed && model.id === current;
  return (
    <StoreCard
      logo={
        <MakerTile
          maker={pluginMaker({ author: model.maker, link: model.source })}
          name={model.name}
        />
      }
      title={model.name}
      state={inUse ? "on" : undefined}
      line={
        failure ??
        (inUse
          ? `In use, ${gigabytes(model.disk_mb)}`
          : `${languagesLine(model)}, ${accuracyWords[model.accuracy].toLowerCase()} accuracy, ${gigabytes(model.disk_mb)}`)
      }
      action={
        <ActionButton
          action={hearingAction(model, current, downloading, coming)}
          label={model.name}
        />
      }
      onOpen={() => nav.open({ kind: "hearing", id: model.id })}
    />
  );
}

function VoiceboxCard({
  apps,
  app,
  voicebox,
}: {
  apps: ExploreInstalledApps;
  app: ExploreCatalogApp;
  voicebox: VoiceboxState | null;
}) {
  const nav = useExploreNav();
  const serving = useVoiceboxProgress();
  const { action, dialog } = useAppAction(apps, app);
  const installed = voicebox?.installed ?? apps.versionOf(app.id) !== undefined;
  const shown = serving
    ? {
        label: "Get",
        variant: "get" as const,
        progress: { value: serving.total ? serving.received / serving.total : 0 },
        onClick: () => undefined,
      }
    : action?.label === "Open"
      ? null
      : action;
  const line =
    voicebox && !voicebox.runsHere
      ? "Doesn't run on this computer"
      : installed
        ? `In use, ${megabytes(app.size)}`
        : `${app.description ?? "Speaks for Misty"}, ${megabytes(app.size)}`;
  return (
    <>
      <StoreCard
        logo={<AppLogo app={app} size="item" />}
        title={app.name}
        state={installed && voicebox?.runsHere !== false ? "on" : undefined}
        line={line}
        action={
          voicebox?.runsHere === false ? null : <ActionButton action={shown} label={app.name} />
        }
        onOpen={() => nav.open({ kind: "apps", id: app.id })}
      />
      {dialog}
    </>
  );
}

function Voices({ spaceId }: { spaceId: string }) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  const voicebox = useVoicebox();
  const app = apps.listed.find((one) => one.id === VOICEBOX_APP_ID);
  if (!apps.loaded && !apps.error) return <StoreSkeleton label="Voices" look="cards" items={1} />;
  if (!app && !voicebox?.installed) return null;
  return (
    <StoreSection title="Voices">
      <StoreCards label="Voices">
        {app ? (
          <VoiceboxCard apps={apps} app={app} voicebox={voicebox} />
        ) : (
          <StoreCard
            logo={<AppLogoImage name="Voicebox" size="item" />}
            title="Voicebox"
            state="on"
            line="In use"
          />
        )}
      </StoreCards>
    </StoreSection>
  );
}

export function SpeechPage({ spaceId }: { spaceId: string }) {
  const { catalog, error, settings } = useSpeech();
  if (!catalog)
    return error ? (
      <SpeechFailed error={error} />
    ) : (
      <StoreSkeleton label="Hearing" look="cards" items={4} />
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
  const said = languages.map(languageName).join(" and ");
  return (
    <>
      <StoreSection
        title="Hearing"
        detail={said ? `Picked for ${said}` : undefined}
        action={
          <Button size="sm" onClick={() => openSettings("voice")}>
            Languages
          </Button>
        }
      >
        <StoreCards label="Hearing models">
          {hearing.map((model) => (
            <HearingCard key={model.id} model={model} current={settings.hearingModel} />
          ))}
        </StoreCards>
      </StoreSection>
      <Voices spaceId={spaceId} />
      <Text as="p" size="meta" tone="muted" wrap className="m-0">
        Speech runs on this computer. Nothing you say leaves it.
      </Text>
    </>
  );
}

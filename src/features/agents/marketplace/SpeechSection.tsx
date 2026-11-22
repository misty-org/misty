/**
 * Explore › Speech: the open speech models of Misty's catalog, as two shelves. Hearing: the model in
 * use first, then the others that hear the person's languages and run well on this computer
 * (`rankHearing`), the rest of the catalog under See all. Voices: those that speak the person's
 * languages, each heard with its play button once it's here, marked where Misty or an agent uses
 * it. Something here but not in use has Remove in its ⋯, as in Settings › Voice. Downloads show
 * how far they've come in the item's line; the button just waits.
 */
import { ExternalLink, RefreshCw, Trash2, Volume2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useSettingsStore } from "@/features/settings";
import {
  chooseHearing,
  chooseMistyVoice,
  personLanguages,
  previewVoice,
  rankHearing,
  useSpeechModels,
  voicesFor,
  type HearingModelView,
  type InstallProgress,
  type VoiceView,
} from "@/features/voice";
import { voiceSettings } from "@/features/voice/voiceSettings";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  CatalogDone,
  ErrorState,
  EmptyState,
  IconButton,
  MenuItem,
  notify,
  Shelf,
  ShelfItem,
  StoreDetail,
  StoreDetailSection,
  Text,
  useConfirmDelete,
} from "@misty/ui";
import { voiceLine } from "../personal/AgentVoicePicker";
import { voiceProgress } from "../personal/agentVoice";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { MarketShelf, MarketShelvesSkeleton } from "./MarketShelf";
import { MakerTile, pluginMaker } from "./PluginMaker";

export type SpeechEntry = HearingModelView | VoiceView;

/** What a voice says when it's tried, in the language it speaks. */
const samples: Record<string, string> = {
  en: "Hi, I'm {name}. This is how I sound.",
  es: "Hola, soy {name}. Así sueno.",
  fr: "Bonjour, je suis {name}. Voici ma voix.",
  de: "Hallo, ich bin {name}. So klinge ich.",
  it: "Ciao, sono {name}. Ecco come suono.",
  pt: "Olá, eu sou {name}. É assim que eu soo.",
};
const sampleFor = (voice: VoiceView) =>
  (samples[voice.languages.find((code) => samples[code]) ?? "en"] ?? samples.en).replace(
    "{name}",
    voice.name,
  );

const matches = (entry: SpeechEntry, words: string) =>
  !words ||
  `${entry.name} ${entry.maker} ${"description" in entry ? entry.description : ""}`
    .toLowerCase()
    .includes(words);

/** A download as its line says it: "Downloading 40%", then "Unpacking". */
export function progressLine(progress: InstallProgress) {
  if (progress.phase === "unpacking") return "Unpacking";
  return progress.total
    ? `Downloading ${Math.round((progress.received / progress.total) * 100)}%`
    : "Downloading";
}

/** The speech store's view of one entry: whether it's coming, and why it last failed. */
function useEntryState() {
  const catalog = useSpeechModels((state) => state.catalog);
  const progress = useSpeechModels((state) => state.progress);
  const failures = useSpeechModels((state) => state.failures);
  return (entry: SpeechEntry) => {
    const coming = voiceProgress(progress, entry);
    const downloading =
      Boolean(coming) ||
      Boolean(catalog?.installing.some((id) => id === entry.id || id === entry.packageKey));
    return { coming, downloading, failure: failures[entry.id] };
  };
}

export function SpeechSection({ query }: { query: string }) {
  const catalog = useSpeechModels((state) => state.catalog);
  const loadError = useSpeechModels((state) => state.error);
  const document = useSettingsStore((state) => state.settings?.document);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const { confirm, dialog } = useConfirmDelete();
  useEffect(() => {
    void useSpeechModels.getState().load();
  }, []);

  if (!catalog)
    return loadError ? (
      <ErrorState
        inline
        title="Speech models couldn't load"
        line={loadError}
        action={{
          label: "Try again",
          icon: RefreshCw,
          onClick: () => void useSpeechModels.getState().load(),
        }}
      />
    ) : (
      <MarketShelvesSkeleton label="Speech" />
    );

  const settings = voiceSettings(document);
  const languages = personLanguages();
  const words = query.trim().toLowerCase();

  // Who speaks in each voice: Misty's own speech, then each agent that picked one.
  const speakers = new Map<string, string[]>();
  const speaks = (voice: string, who: string) => {
    if (voice) speakers.set(voice, [...(speakers.get(voice) ?? []), who]);
  };
  speaks(settings.voice, "Misty");
  for (const agent of agents) if (agent.voice) speaks(agent.voice, agent.name);

  // What may go: on this computer, not in use, and sharing no download with something in use.
  const inUse = new Set<string>([settings.hearingModel, ...speakers.keys()]);
  const all: SpeechEntry[] = [...catalog.hearing, ...catalog.voices];
  const removable = (entry: SpeechEntry) =>
    entry.installed &&
    !inUse.has(entry.id) &&
    !all.some((other) => other.packageKey === entry.packageKey && inUse.has(other.id));
  const remove = (entry: SpeechEntry) => {
    const shared = all.some(
      (other) => other.id !== entry.id && other.packageKey === entry.packageKey && other.installed,
    );
    void confirm({
      title: `Remove ${entry.name}?`,
      what: `${entry.name} is deleted from this computer${
        shared ? ", with the voices that came in the same download" : ""
      }. You can get it again here.`,
      confirmLabel: "Remove",
      onConfirm: () => useSpeechModels.getState().remove(entry.id),
    });
  };

  const current = catalog.hearing.find((model) => model.id === settings.hearingModel);
  const picks = [
    ...(current ? [current] : []),
    ...rankHearing(catalog.hearing, languages, catalog.machine).filter(
      (model) => model.id !== current?.id,
    ),
  ];
  const others = catalog.hearing.filter((model) => !picks.includes(model));
  const hearing = picks.filter((model) => matches(model, words));
  const moreHearing = others.filter((model) => matches(model, words));

  const offered = voicesFor(catalog.voices, languages).filter((voice) => matches(voice, words));
  const voices = [
    ...offered.filter((voice) => speakers.has(voice.id)),
    ...offered.filter((voice) => !speakers.has(voice.id)),
  ];

  if (!hearing.length && !moreHearing.length && !voices.length)
    return <EmptyState inline title="No speech models found" line="Try other words." />;

  return (
    <>
      {hearing.length || moreHearing.length ? (
        <HearingShelf
          key={words}
          models={hearing}
          more={moreHearing}
          current={current?.id}
          removable={removable}
          onRemove={remove}
        />
      ) : null}
      {voices.length ? (
        <MarketShelf
          key={`voices:${words}`}
          title="Voices"
          items={voices}
          render={(voice) => (
            <VoiceItem
              key={voice.id}
              voice={voice}
              speakers={speakers.get(voice.id) ?? []}
              mistyVoice={settings.voice === voice.id}
              removable={removable(voice)}
              onRemove={() => remove(voice)}
            />
          )}
        />
      ) : null}
      {dialog}
    </>
  );
}

function HearingShelf({
  models,
  more,
  current,
  removable,
  onRemove,
}: {
  models: HearingModelView[];
  more: HearingModelView[];
  current: string | undefined;
  removable: (entry: SpeechEntry) => boolean;
  onRemove: (entry: SpeechEntry) => void;
}) {
  // A search that only matches the rest of the catalog shows it at once.
  const [open, setOpen] = useState(!models.length);
  const shown = open ? [...models, ...more] : models;
  return (
    <Shelf
      title="Hearing"
      action={
        more.length && models.length ? (
          <Button variant="quiet" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? "Show fewer" : "See all"}
          </Button>
        ) : undefined
      }
    >
      {shown.map((model) => (
        <HearingItem
          key={model.id}
          model={model}
          inUse={model.id === current}
          removable={removable(model)}
          onRemove={() => onRemove(model)}
        />
      ))}
    </Shelf>
  );
}

function HearingItem({
  model,
  inUse,
  removable,
  onRemove,
}: {
  model: HearingModelView;
  inUse: boolean;
  removable: boolean;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const stateOf = useEntryState();
  const { coming, downloading, failure } = stateOf(model);
  const line = coming ? progressLine(coming) : (failure ?? model.description);
  const logo = (
    <MakerTile maker={pluginMaker({ author: model.maker, link: model.source })} name={model.name} />
  );

  const action = (filled: boolean): ReactNode => {
    if (inUse && model.installed) return <CatalogDone label="In use" />;
    if (model.installed)
      return (
        <Button size={filled ? undefined : "sm"} onClick={() => chooseHearing(model.id)}>
          Use
        </Button>
      );
    return (
      <Button
        variant={filled ? "get-filled" : "get"}
        size={filled ? undefined : "sm"}
        disabled={downloading}
        onClick={() => void useSpeechModels.getState().install(model.id)}
      >
        Get
      </Button>
    );
  };
  const menu = <EntryMenu entry={model} removable={removable} onRemove={onRemove} />;
  const anyLanguage = model.languages.includes("*");

  return (
    <>
      <ShelfItem
        logo={logo}
        title={model.name}
        line={line}
        action={action(false)}
        menu={menu}
        onOpen={() => setOpen(true)}
      />
      <StoreDetail
        open={open}
        onOpenChange={setOpen}
        logo={logo}
        title={model.name}
        line={line}
        action={action(true)}
        menu={menu}
        facts={[
          { label: "Maker", value: model.maker },
          { label: "License", value: model.license },
          {
            label: "Size",
            value: String(Math.max(1, Math.round(model.package.size / 1_000_000))),
            detail: "MB",
          },
          {
            label: "Languages",
            value: anyLanguage ? "Any" : String(model.languages.length),
            detail: anyLanguage
              ? undefined
              : model.languages.length === 1
                ? "language"
                : "languages",
          },
        ]}
      >
        {model.credit ? (
          <StoreDetailSection title="Credit">
            <Text size="page" wrap>
              {model.credit}
            </Text>
          </StoreDetailSection>
        ) : null}
      </StoreDetail>
    </>
  );
}

function VoiceItem({
  voice,
  speakers,
  mistyVoice,
  removable,
  onRemove,
}: {
  voice: VoiceView;
  /** Who speaks in it: Misty, then agents by name. */
  speakers: string[];
  mistyVoice: boolean;
  removable: boolean;
  onRemove: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const stateOf = useEntryState();
  const { coming, downloading, failure } = stateOf(voice);
  const said = voiceLine(voice);
  const used = speakers.length ? `${said}, used by ${listed(speakers)}` : said;
  const line = coming && !voice.installed ? progressLine(coming) : (failure ?? used);
  const hear = () => {
    setPlaying(true);
    previewVoice(voice.id, sampleFor(voice))
      .catch((reason: unknown) => notify({ message: String(reason), tone: "error" }))
      .finally(() => setPlaying(false));
  };
  // One action: a voice on this computer is heard; who uses it is said in its line.
  const action = voice.installed ? (
    <IconButton label={`Hear ${voice.name}`} disabled={playing} onClick={hear}>
      <Volume2 />
    </IconButton>
  ) : (
    <Button
      variant="get"
      size="sm"
      disabled={downloading}
      onClick={() => void useSpeechModels.getState().install(voice.id)}
    >
      Get
    </Button>
  );
  return (
    <ShelfItem
      title={voice.name}
      line={line}
      action={action}
      menu={
        <EntryMenu entry={voice} removable={removable} onRemove={onRemove}>
          {voice.installed && !mistyVoice ? (
            <MenuItem
              icon={Volume2}
              label="Use for Misty"
              onSelect={() => chooseMistyVoice(voice.id)}
            />
          ) : null}
        </EntryMenu>
      }
    />
  );
}

/** "Misty", "Misty and Ada", "Misty, Ada and Sam". */
function listed(names: string[]) {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** An entry's ⋯: its own actions, its maker's page, then Remove when it may go. */
function EntryMenu({
  entry,
  removable,
  onRemove,
  children,
}: {
  entry: SpeechEntry;
  removable: boolean;
  onRemove: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      {children}
      <MenuItem
        icon={ExternalLink}
        label="Open website"
        onSelect={() => void openExternalLink(entry.source)}
      />
      {removable ? <MenuItem icon={Trash2} label="Remove" danger onSelect={onRemove} /> : null}
    </>
  );
}

import { FileText, Globe, Mic, NotebookText, Type, type LucideIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useNow } from "@/shared/hooks/useNow";
import {
  ItemCard,
  OverflowFadeText,
  Pressable,
  Spinner,
  Surface,
  Text,
  Tooltip,
  cn,
} from "@/shared/ui";
import { shortAgo } from "../page/useChatStatuses";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import { useTeamMembers } from "../virtual/teamMembers";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { agentsAtWork, workWords } from "./notebookAgents";
import { hold, release, useOthersMaking } from "./notebookLive";
import { PersonAvatar } from "./notebook/LivePeople";
import { personTone } from "./personTone";
import { useTutorStore } from "./tutorStore";
import type { Guide, Notebook, NotebookSource, TutorJob } from "./tutorTypes";

/** What a thing made in the Create pane is called, for "2 quizzes" and "making a quiz". */
const nouns: Record<Guide["kind"] | TutorJob["kind"], string> = {
  guide: "report",
  quiz: "quiz",
  overview: "audio overview",
  mindmap: "mind map",
  slides: "slide deck",
  infographic: "infographic",
  video: "video overview",
  deck: "flashcard deck",
  research: "source search",
  brief: "overview",
  note: "note",
  summary: "summary",
};
const plural = (noun: string) => (noun.endsWith("z") ? `${noun}zes` : `${noun}s`);
const withArticle = (noun: string) => `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;

const sourceIcons: Record<NotebookSource["kind"], LucideIcon> = {
  link: Globe,
  file: FileText,
  recording: Mic,
  text: Type,
};

interface CardFacts {
  /** "12 sources · 2 quizzes · 1m". */
  meta: string;
  /** Who's doing what in it now: a person's agent, at work. */
  doing?: { name: string; words: string };
  /** Who made it: their face and name. */
  by?: { userId: string; name: string };
  /** Who else has added to it, for the faces at its foot. */
  workedOn: string[];
  /** Who has it open now. */
  here: { userId: string; name: string }[];
}

/**
 * What a notebook's card and row say: its sources, what's been made from them and when, who made
 * it or is making something in it now, who worked on it and who has it open. While someone has
 * it open, its room is held, so what they're making shows.
 */
function useCardFacts(notebook: Notebook): CardFacts {
  const now = useNow();
  const gateway = spacesGateway.maybe();
  const spaceId = notebook.space?.spaceId;
  const self = gateway?.me();
  const me = self?.userId;
  const nameOf = (userId?: string) =>
    !userId
      ? "Someone"
      : userId === me
        ? "You"
        : spaceId && gateway
          ? gateway.memberName(spaceId, userId)
          : "Someone";
  const members = useTeamMembers((state) => state.members);
  const here = members
    .filter((member) => member.place === "lab" && member.notebookDoc === notebook.space?.docId)
    .map((member) => ({ userId: member.userId, name: member.name }));
  const someoneHere = here.length > 0;
  useEffect(() => {
    if (!someoneHere || !notebook.space) return;
    let kept = false;
    let gone = false;
    void hold(notebook.id).then((found) => {
      kept = Boolean(found);
      if (gone && kept) release(notebook.id);
    });
    return () => {
      gone = true;
      if (kept) release(notebook.id);
    };
  }, [someoneHere, notebook.id, notebook.space]);
  const othersMaking = useOthersMaking(notebook.id);
  const jobs = useTutorStore((state) => state.jobs);
  const profiles = usePersonalAgentsStore((state) => state.agents);
  const decks = useTutorStore((state) => state.decks);
  const guides = useTutorStore((state) => state.guides);

  // Agents are collaborators too: this person's own, at work here, or a teammate's.
  const mine = agentsAtWork(Object.values(jobs), notebook.id, profiles)[0];
  const theirs = othersMaking[0];
  const doing = mine
    ? { name: mine.name, words: workWords(mine) }
    : theirs
      ? {
          name: theirs.agent ? `${nameOf(theirs.by)}'s ${theirs.agent.name}` : nameOf(theirs.by),
          words: `is making ${withArticle(nouns[theirs.kind])}`,
        }
      : undefined;

  const made = [
    ...Object.values(decks)
      .filter((deck) => deck.notebookId === notebook.id)
      .map((deck) => ({ ...deck, kind: "deck" as const })),
    ...Object.values(guides).filter((guide) => guide.notebookId === notebook.id),
  ];
  const kinds = new Set(made.map((item) => item.kind));
  const madeWords = !made.length
    ? ""
    : kinds.size === 1
      ? `${made.length} ${made.length === 1 ? nouns[made[0]!.kind] : plural(nouns[made[0]!.kind])}`
      : `${made.length} made`;
  const sources = `${notebook.sources.length} ${notebook.sources.length === 1 ? "source" : "sources"}`;
  const meta = [sources, madeWords, shortAgo(notebook.updatedAt, now)].filter(Boolean).join(" · ");

  const maker = notebook.createdBy ?? me;
  const by =
    maker && spaceId && gateway
      ? {
          userId: maker,
          name: maker === me && self ? self.name : gateway.memberName(spaceId, maker),
        }
      : undefined;
  const workedOn = [
    ...new Set(
      [
        notebook.createdBy,
        ...notebook.sources.map((source) => source.addedBy),
        ...notebook.notes.map((note) => note.authorId),
        ...made.map((item) => item.by),
      ].filter((userId): userId is string => Boolean(userId)),
    ),
  ].filter((userId) => userId !== by?.userId);
  return { meta, doing, by, workedOn, here };
}

/** The faces of the people who worked on a notebook. */
function WorkedOn({ spaceId, people }: { spaceId?: string; people: string[] }) {
  const gateway = spacesGateway.maybe();
  if (!people.length || !spaceId || !gateway) return null;
  const self = gateway.me();
  return (
    <span className="ml-auto flex flex-none items-center -space-x-1">
      {people.slice(0, 3).map((userId) => {
        const name =
          userId === self?.userId ? self.name : gateway.memberName(spaceId, userId);
        return (
          <Tooltip key={userId} content={name}>
            <span className="inline-flex">
              <PersonAvatar
                spaceId={spaceId}
                person={{ id: userId, name, tone: personTone(userId) }}
                size="xs"
              />
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}

/** "Sam is making a quiz" with its spinner, or who made it: their face and name. */
function Doing({ spaceId, facts }: { spaceId?: string; facts: CardFacts }) {
  if (!facts.doing) {
    const { by } = facts;
    if (!by) return null;
    return (
      <>
        <PersonAvatar
          spaceId={spaceId}
          person={{ id: by.userId, name: by.name, tone: personTone(by.userId) }}
          size="xs"
        />
        <OverflowFadeText>{by.name}</OverflowFadeText>
      </>
    );
  }
  const { name, words } = facts.doing;
  return (
    <>
      <Spinner size="sm" label="Making" />
      <OverflowFadeText>{`${name} ${words}`}</OverflowFadeText>
    </>
  );
}

/** A preview of the notebook's sources as a small stack, then how many more there are. */
function SourceStack({ notebook }: { notebook: Notebook }) {
  const shown = notebook.sources.slice(0, 3);
  const more = notebook.sources.length - shown.length;
  // With no sources yet, the cover shows the notebook's mark, so it isn't an empty box.
  if (!shown.length)
    return (
      <Text bare tone="muted" className="grid size-full place-items-center [&_svg]:size-6">
        <NotebookText aria-hidden />
      </Text>
    );
  return (
    // Centered on the cover, as a few pages fanned on a desk; set into the cover's fill.
    <span className="flex size-full items-center justify-center gap-1.5 p-4">
      {shown.map((source, index) => {
        const Icon = sourceIcons[source.kind];
        return (
          <Surface
            key={source.id}
            as="span"
            tone="page"
            edge="hairline"
            radius="md"
            className={cn(
              "grid h-12 w-9 place-items-start p-1.5",
              index === 1 && "-rotate-3",
              index === 2 && "rotate-3",
            )}
          >
            <Text bare tone="muted" className="inline-flex">
              <Icon aria-hidden />
            </Text>
          </Surface>
        );
      })}
      {more > 0 ? (
        <Text bare size="caption" tone="muted" className="pl-0.5">
          +{more}
        </Text>
      ) : null}
    </span>
  );
}

/** "Sam is here" over the cover, while someone has the notebook open. */
function HerePill({ spaceId, here }: { spaceId?: string; here: CardFacts["here"] }) {
  const first = here[0];
  if (!first) return null;
  const words =
    here.length > 1
      ? `${first.name} and ${here.length - 1} more are here`
      : `${first.name} is here`;
  return (
    <Surface
      as="span"
      tone="card"
      radius="full"
      className="flex h-6 items-center gap-1.5 pr-2 pl-1"
    >
      <PersonAvatar
        spaceId={spaceId}
        person={{ id: first.userId, name: first.name, tone: personTone(first.userId) }}
        size="xs"
      />
      <Text bare size="caption" tone="default">
        {words}
      </Text>
    </Surface>
  );
}

const notebookGlyph = (notebook: Notebook) =>
  notebook.emoji ? (
    <Text bare aria-hidden="true">
      {notebook.emoji}
    </Text>
  ) : (
    <Text bare tone="muted" className="inline-flex">
      <NotebookText aria-hidden />
    </Text>
  );

/** A notebook as the Space's own item card. */
export function NotebookCard({
  notebook,
  onOpen,
  children,
}: {
  notebook: Notebook;
  onOpen(): void;
  /** Its menu, over the card. */
  children?: ReactNode;
}) {
  const facts = useCardFacts(notebook);
  const spaceId = notebook.space?.spaceId;
  return (
    <ItemCard
      label={`Notebook: ${notebook.title}`}
      onClick={onOpen}
      cover={<SourceStack notebook={notebook} />}
      coverBadge={<HerePill spaceId={spaceId} here={facts.here} />}
      glyph={notebookGlyph(notebook)}
      title={notebook.title}
      meta={<OverflowFadeText>{facts.meta}</OverflowFadeText>}
      footer={
        <>
          <Doing spaceId={spaceId} facts={facts} />
          <WorkedOn spaceId={spaceId} people={facts.workedOn} />
        </>
      }
    >
      {children}
    </ItemCard>
  );
}

/** A notebook as a row of the list view: the same facts as its card. */
export function NotebookRow({
  notebook,
  className,
  onOpen,
  children,
}: {
  notebook: Notebook;
  className: string;
  onOpen(): void;
  children?: ReactNode;
}) {
  const facts = useCardFacts(notebook);
  const spaceId = notebook.space?.spaceId;
  return (
    <div className="relative" role="listitem">
      <Surface
        as={Pressable}
        tone="none"
        edge="hairline"
        wash="control"
        className={className}
        onClick={onOpen}
      >
        {notebookGlyph(notebook)}
        <span className="flex min-w-0 flex-col">
          <Text tone="bright">{notebook.title}</Text>
          <Text bare size="caption" tone="muted" className="flex min-w-0 items-center gap-1.5">
            <Doing spaceId={spaceId} facts={facts} />
          </Text>
        </span>
        <Text bare size="caption" tone="muted" className="flex-none">
          {facts.meta}
        </Text>
        <WorkedOn
          spaceId={spaceId}
          people={facts.here.length ? facts.here.map((person) => person.userId) : facts.workedOn}
        />
        <span />
      </Surface>
      {children}
    </div>
  );
}

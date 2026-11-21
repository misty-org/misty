import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowUp, Plus, RotateCcw } from "lucide-react";
import { Button, IconButton, Pressable, Skeleton, Surface, Text, Textarea } from "@misty/ui";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import type { TutorActions } from "../TutorPage";
import type { Notebook } from "../tutorTypes";
import { middleScrollClass, paneClass } from "./panes";
import { agentLabel, paneOf, workWords, type NotebookAgent } from "../notebookAgents";
import { setPresence, type Person } from "../notebookPresence";
import { askInThread, useMyThread, useSharedThreads, useThread } from "../notebookThread";
import { AgentFace } from "./LivePeople";
import { useOthersInSpace } from "./NotebookPeople";
import { ThreadBar, ThreadTurns } from "./ThreadView";

export { answerForNotes, citeLinks, mathMarkdown } from "./citations";

/** The overview under the cover: body text with room between its lines. */
const briefClass = "mt-2 flex flex-col gap-2.5 leading-[1.7]";

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The middle of a notebook: its cover (emoji, name, how many sources, and the overview with
 * questions to start from), then the person's questions and the default engine's answers, then the
 * box to ask in. The questions are a Space note of the person's own (notebookThread.ts), private
 * until they share it; a teammate's shared thread can be opened here and watched live. An
 * answer's [n] opens the source it was numbered for.
 */
export function ChatPanel({
  notebook,
  briefing,
  onCite,
  onAdd,
  onBrief,
  onError,
  people = [],
  agents = [],
}: {
  notebook: Notebook;
  /** The others in the notebook: whose AI is answering them now shows under the chat. */
  people?: Person[];
  /** The agents at work in it: what each is doing shows under the chat. */
  agents?: NotebookAgent[];
  /** No longer read: the Lab's work runs on the default engine. */
  actions?: TutorActions;
  /** The overview is being written. */
  briefing: boolean;
  /** Opens a cited source: by its number now, or by its id for an answer that kept them. */
  onCite(cited: number | string): void;
  onAdd(): void;
  onBrief(): void;
  onError(message: string): void;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const mine = useMyThread(notebook);
  const sharedThreads = useSharedThreads(notebook);
  const [viewing, setViewing] = useState<{ userId: string; docId: string }>();
  const theirs = useThread(notebook.space?.spaceId, viewing?.docId);
  // A teammate's thread that stopped being shared closes.
  useEffect(() => {
    if (viewing && theirs.unreachable) setViewing(undefined);
  }, [viewing, theirs.unreachable]);
  const turns = viewing ? theirs.turns : mine.turns;
  const last = mine.turns[mine.turns.length - 1];
  // While this person's engine answers, the others see them asking; never what they asked.
  const answering = asking || last?.state === "asking" || last?.state === "answering";
  useEffect(() => {
    setPresence(notebook.id, { asking: answering });
  }, [notebook.id, answering]);
  useEffect(() => () => setPresence(notebook.id, { asking: false }), [notebook.id]);
  const others = useOthersInSpace(notebook.space?.spaceId);
  const lastLength = turns[turns.length - 1]?.answer.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, lastLength]);
  const included = notebook.sources.filter((source) => source.context !== "off").length;

  const ask = async (text: string) => {
    if (!text.trim() || asking) return;
    setAsking(true);
    setQuestion("");
    setViewing(undefined);
    try {
      await askInThread(notebook, { question: text });
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAsking(false);
    }
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    void ask(question.trim());
  };
  const cite = (event: MouseEvent) => {
    const link = (event.target as HTMLElement).closest("a");
    const href = link?.getAttribute("href") ?? "";
    const byId = /#tutor-source-id-(.+)$/.exec(href);
    const byNumber = /#tutor-source-(\d+)$/.exec(href);
    if (!byId && !byNumber) return;
    event.preventDefault();
    onCite(byId ? byId[1]! : Number(byNumber![1]));
  };

  return (
    <section className={`${paneClass} flex-1`} aria-label="Chat">
      <div className={middleScrollClass} onClickCapture={cite}>
        <div className="flex flex-col gap-2.5">
          <Text bare size="display" className="leading-none" aria-hidden="true">
            {notebook.emoji ?? "📓"}
          </Text>
          <Text
            as="h1"
            wrap
            size="display"
            weight="semibold"
            tone="bright"
            className="leading-[1.2] tracking-[-0.02em]"
          >
            {notebook.title}
          </Text>
          <Text wrap size="meta" tone="muted">
            {notebook.sources.length} {notebook.sources.length === 1 ? "source" : "sources"}, made{" "}
            {dateOf(notebook.createdAt)}
          </Text>
          {notebook.brief ? (
            <Text as="div" bare size="body" tone="default" className={briefClass}>
              <MistyMarkdown>{notebook.brief.summary}</MistyMarkdown>
              {notebook.brief.topics.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {notebook.brief.topics.map((topic) => (
                    <Surface
                      key={topic}
                      as={Pressable}
                      tone="none"
                      edge="hairline"
                      radius="md"
                      wash="card"
                      className="px-3 py-1"
                      onClick={() => void ask(`Explain ${topic}, from the sources.`)}
                    >
                      <Text bare size="caption" tone="default">
                        {topic}
                      </Text>
                    </Surface>
                  ))}
                </div>
              ) : null}
            </Text>
          ) : briefing ? (
            <Text
              as="div"
              bare
              size="body"
              tone="default"
              className={briefClass}
              aria-hidden="true"
            >
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-[92%]" />
              <Skeleton className="h-3.5 w-[85%]" />
              <Skeleton className="h-3.5 w-[60%]" />
              {/* The overview's topic chips, which it ends with. */}
              <div className="flex flex-wrap gap-1.5">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-6.5 w-20 rounded-md" />
                ))}
              </div>
            </Text>
          ) : notebook.sources.length ? (
            <Button variant="quiet" onClick={onBrief} icon={RotateCcw}>
              Write the overview
            </Button>
          ) : (
            <div className="mt-3">
              <Button onClick={onAdd} icon={Plus}>
                Add sources
              </Button>
            </div>
          )}
        </div>

        <ThreadBar
          notebook={notebook}
          shared={sharedThreads}
          viewing={viewing}
          onView={setViewing}
          visibility={mine.visibility}
          onShare={(next) => void mine.share(next).catch(() => undefined)}
          onNew={() => void mine.startNew().catch(() => undefined)}
          hasTurns={mine.turns.length > 0}
        />
        {turns.length ? (
          <div className="flex flex-col gap-3.5 px-0.5 py-1">
            <ThreadTurns
              notebook={notebook}
              turns={turns}
              readOnly={Boolean(viewing)}
              offerNotes={others}
            />
          </div>
        ) : notebook.brief?.questions.length ? (
          <div className="flex flex-col gap-2">
            {notebook.brief.questions.map((item) => (
              <Surface
                key={item}
                as={Pressable}
                tone="none"
                edge="hairline"
                radius="xl"
                wash="control"
                className="px-3.5 py-2.5 text-left"
                onClick={() => void ask(item)}
              >
                <Text bare size="control" tone="default">
                  {item}
                </Text>
              </Surface>
            ))}
          </div>
        ) : null}
        {people
          .filter((person) => person.lab.asking)
          .map((person) => (
            <Text
              key={person.id}
              bare
              size="caption"
              tone="muted"
              className="flex-none misty-shimmer"
            >
              {person.name} is asking their AI…
            </Text>
          ))}
        {/* Work on sources shows in Sources and making in Create; the rest shows here. */}
        {agents
          .filter((agent) => !paneOf(agent.work))
          .map((agent) => (
            <Text
              key={agent.key}
              bare
              size="caption"
              tone="muted"
              className="flex flex-none items-center gap-2 misty-shimmer"
            >
              <AgentFace agent={agent} />
              {`${agentLabel(agent)} ${workWords(agent)}…`}
            </Text>
          ))}
        <div ref={end} />
      </div>

      <Surface
        as="form"
        tone="card"
        edge="field"
        radius="xl"
        className="mx-auto mb-3.5 flex w-[min(--spacing(190),calc(100%-var(--spacing)*7))] items-end gap-2 py-2 pr-2 pl-4"
        onSubmit={submit}
        data-tour="notebook-ask"
      >
        <Textarea
          variant="composer"
          rows={1}
          className="max-h-50 min-h-0 flex-1 py-1.5 text-control [field-sizing:content]"
          aria-label="Ask about your sources"
          placeholder={mine.turns.length ? "Ask a follow-up" : "Ask a question about your sources"}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Text bare size="caption" tone="muted" className="pb-2.5 whitespace-nowrap">
          {included} {included === 1 ? "source" : "sources"}
        </Text>
        {/* The quiet button's pressed fill, so the send button reads as part of the box. */}
        <IconButton
          label="Ask"
          type="submit"
          data-active="true"
          disabled={!question.trim() || asking}
        >
          <ArrowUp />
        </IconButton>
      </Surface>
    </section>
  );
}

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowUp, ExternalLink, Plus, RotateCcw, SquarePen } from "lucide-react";
import {
  Button,
  citationChipsClass,
  cn,
  IconButton,
  Pressable,
  Skeleton,
  Surface,
  Text,
  Textarea,
} from "@/shared/ui";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import type { TutorActions } from "../TutorPage";
import { askPrompt } from "../tutorPrompts";
import { startRun } from "../tutorRuns";
import { questionContext } from "../tutorSearch";
import { useTutorStore } from "../tutorStore";
import type { Notebook } from "../tutorTypes";
import { middleScrollClass, paneClass } from "./panes";

/** LaTeX written as \[ … \] or \( … \) becomes $$ … $$, which Misty's Markdown draws as math. */
export function mathMarkdown(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_whole, math: string) => `$$${math.trim()}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_whole, math: string) => `$$${math.trim()}$$`);
}

/** "[2]" in an answer becomes a link that opens source 2; one already a link stays as it is. */
export function citeLinks(answer: string, sources: number): string {
  return mathMarkdown(answer).replace(/\[(\d{1,3})\](?!\()/g, (whole, number: string) => {
    const index = Number(number);
    return index >= 1 && index <= sources ? `[[${index}]](#tutor-source-${index})` : whole;
  });
}

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
 * The middle of a notebook: its cover (emoji, name, how many sources, and the agent's overview with
 * questions to start from), then the conversation, then the box to ask in. An answer's [n] opens
 * source n; questions show as the person wrote them, not with the sources their turns carry.
 */
export function ChatPanel({
  notebook,
  actions,
  briefing,
  onCite,
  onAdd,
  onBrief,
  onError,
}: {
  notebook: Notebook;
  actions: TutorActions;
  /** The overview is being written. */
  briefing: boolean;
  onCite(index: number): void;
  onAdd(): void;
  onBrief(): void;
  onError(message: string): void;
}) {
  const store = useTutorStore.getState();
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const thread = notebook.thread;
  const conversation = useMistyStore((state) =>
    thread ? state.conversations.find((chat) => chat.id === thread.conversationId) : undefined,
  );
  const messages = conversation?.messages ?? [];
  const lastLength = messages[messages.length - 1]?.content.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, lastLength]);
  const included = notebook.sources.filter((source) => source.context !== "off").length;

  const ask = async (text: string) => {
    if (!text.trim() || asking) return;
    setAsking(true);
    try {
      const picked = await questionContext(notebook, text);
      const run = await startRun({
        agentId: actions.agentId,
        title: text.slice(0, 80),
        prompt: askPrompt(notebook, text, picked),
        mode: "act",
        background: false,
        stay: true,
        conversationId: conversation ? thread?.conversationId : undefined,
      });
      if (run.error) return onError(run.error);
      if (!run.started) return onError("Another turn is working. Ask again when it finishes.");
      setQuestion("");
      const same = thread?.conversationId === run.conversationId;
      store.updateNotebook(notebook.id, (current) => ({
        ...current,
        thread: {
          conversationId: run.conversationId,
          questions: [...(same ? (current.thread?.questions ?? []) : []), text],
        },
        chats: current.chats.includes(run.conversationId)
          ? current.chats
          : [run.conversationId, ...current.chats].slice(0, 50),
      }));
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
    const match = /#tutor-source-(\d+)$/.exec(link?.getAttribute("href") ?? "");
    if (!match) return;
    event.preventDefault();
    onCite(Number(match[1]));
  };

  let asked = 0;
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
            {notebook.sources.length} {notebook.sources.length === 1 ? "source" : "sources"} ·{" "}
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

        {messages.length ? (
          <div className="flex flex-col gap-3.5 px-0.5 py-1">
            <div className="flex justify-end gap-0.5">
              <IconButton
                label="Open as a chat"
                onClick={() =>
                  conversation &&
                  actions.onChat(conversation.agentId ?? actions.agentId, conversation.id)
                }
              >
                <ExternalLink />
              </IconButton>
              <IconButton
                label="New conversation"
                onClick={() =>
                  store.updateNotebook(notebook.id, (current) => ({
                    ...current,
                    thread: undefined,
                  }))
                }
              >
                <SquarePen />
              </IconButton>
            </div>
            {messages.map((message) => {
              if (message.role === "user") {
                const shown = thread?.questions[asked] ?? message.content.split("Question: ").pop();
                asked += 1;
                return (
                  <Surface
                    as="p"
                    key={message.id}
                    tone="well"
                    radius="xl"
                    className="max-w-[85%] self-end px-3 py-2 whitespace-pre-wrap"
                  >
                    <Text bare size="control" tone="bright">
                      {shown}
                    </Text>
                  </Surface>
                );
              }
              const working = message.state === "pending" || message.state === "streaming";
              return (
                <Text
                  bare
                  as="div"
                  key={message.id}
                  size="control"
                  tone="default"
                  className={cn("leading-[1.65]", citationChipsClass)}
                >
                  {message.content ? (
                    <MistyMarkdown>
                      {citeLinks(message.content, notebook.sources.length)}
                    </MistyMarkdown>
                  ) : null}
                  {working && !message.content ? (
                    <Text bare size="caption" tone="muted" className="flex-none misty-shimmer">
                      Reading the sources
                    </Text>
                  ) : null}
                  {message.state === "failed" ? (
                    <Text bare size="caption" tone="muted" className="flex-none">
                      This answer stopped before it finished.
                    </Text>
                  ) : null}
                </Text>
              );
            })}
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
        <div ref={end} />
      </div>

      <Surface
        as="form"
        tone="card"
        edge="field"
        radius="xl"
        className="mx-auto mb-3.5 flex w-[min(760px,calc(100%-28px))] items-end gap-2 py-2 pr-2 pl-4"
        onSubmit={submit}
        data-tour="notebook-ask"
      >
        <Textarea
          variant="composer"
          rows={1}
          className="max-h-50 min-h-0 flex-1 py-1.5 text-control [field-sizing:content]"
          aria-label="Ask about your sources"
          placeholder={messages.length ? "Ask a follow-up" : "Ask a question about your sources"}
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

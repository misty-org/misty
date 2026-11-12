import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowUp, ExternalLink, Plus, RotateCcw, SquarePen } from "lucide-react";
import { Button, IconButton, Pressable, Skeleton, Textarea } from "@/shared/ui";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import type { TutorActions } from "../TutorPage";
import { askPrompt } from "../tutorPrompts";
import { startRun } from "../tutorRuns";
import { questionContext } from "../tutorSearch";
import { useTutorStore } from "../tutorStore";
import type { Notebook } from "../tutorTypes";

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
    <section className="tutor-pane tutor-chat-pane" aria-label="Chat">
      <div className="tutor-chat-scroll" onClickCapture={cite}>
        <div className="tutor-cover">
          <span className="tutor-cover-emoji" aria-hidden="true">
            {notebook.emoji ?? "📓"}
          </span>
          <h1 className="tutor-cover-title">{notebook.title}</h1>
          <p className="tutor-cover-meta">
            {notebook.sources.length} {notebook.sources.length === 1 ? "source" : "sources"} ·{" "}
            {dateOf(notebook.createdAt)}
          </p>
          {notebook.brief ? (
            <div className="tutor-cover-brief">
              <MistyMarkdown>{notebook.brief.summary}</MistyMarkdown>
              {notebook.brief.topics.length ? (
                <div className="tutor-cover-topics">
                  {notebook.brief.topics.map((topic) => (
                    <Pressable
                      key={topic}
                      className="tutor-chip"
                      onClick={() => void ask(`Explain ${topic}, from the sources.`)}
                    >
                      {topic}
                    </Pressable>
                  ))}
                </div>
              ) : null}
            </div>
          ) : briefing ? (
            <div className="tutor-cover-brief" aria-hidden="true">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-[92%]" />
              <Skeleton className="h-3.5 w-[85%]" />
              <Skeleton className="h-3.5 w-[60%]" />
            </div>
          ) : notebook.sources.length ? (
            <Button variant="quiet" onClick={onBrief} icon={RotateCcw}>
              Write the overview
            </Button>
          ) : (
            <div className="tutor-cover-start">
              <Button onClick={onAdd} icon={Plus}>
                Add sources
              </Button>
            </div>
          )}
        </div>

        {messages.length ? (
          <div className="tutor-chat-turns">
            <div className="tutor-chat-tools">
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
                  <p key={message.id} className="tutor-chat-question">
                    {shown}
                  </p>
                );
              }
              const working = message.state === "pending" || message.state === "streaming";
              return (
                <div key={message.id} className="tutor-chat-answer">
                  {message.content ? (
                    <MistyMarkdown>
                      {citeLinks(message.content, notebook.sources.length)}
                    </MistyMarkdown>
                  ) : null}
                  {working && !message.content ? (
                    <span className="tutor-card-detail misty-shimmer">Reading the sources</span>
                  ) : null}
                  {message.state === "failed" ? (
                    <span className="tutor-card-detail">
                      This answer stopped before it finished.
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : notebook.brief?.questions.length ? (
          <div className="tutor-suggestions">
            {notebook.brief.questions.map((item) => (
              <Pressable key={item} className="tutor-suggestion" onClick={() => void ask(item)}>
                {item}
              </Pressable>
            ))}
          </div>
        ) : null}
        <div ref={end} />
      </div>

      <form className="tutor-composer" onSubmit={submit}>
        <Textarea
          variant="composer"
          rows={1}
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
        <span className="tutor-composer-count">
          {included} {included === 1 ? "source" : "sources"}
        </span>
        <IconButton
          label="Ask"
          type="submit"
          className="tutor-composer-send"
          disabled={!question.trim() || asking}
        >
          <ArrowUp />
        </IconButton>
      </form>
    </section>
  );
}

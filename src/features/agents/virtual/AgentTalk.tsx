import { ArrowUp, Mic, Settings, Shirt, Square, X } from "lucide-react";
import { AgentRecordRow } from "./AgentRecordRow";
import type { AgentRecord } from "./studioProgress";
import { useEffect, useRef, useState } from "react";
import { listen, useSpeechSupport, type Listening } from "@/features/voice";
import {
  ActionBar,
  Button,
  cn,
  CodeBlock,
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  iconBarItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
  Surface,
  Text,
  Textarea,
} from "@/shared/ui";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { visibleConversationContent } from "../conversations/view/conversationTurns";
import {
  actionQuestionHasDetails,
  actionQuestionText,
  answerActionQuestion,
  useActionQuestions,
} from "../island/actionQuestions";
import { AgentAvatar } from "../personal/AgentAvatar";
import { AgentHomeSpaceLine } from "../personal/AgentSpaceField";
import { MistyMarkdown } from "../runs/markdown/MistyMarkdown";
import type { Actor } from "./studio/behaviour";
import {
  chatsOf,
  chooseChat,
  isAnswering,
  studioChatOf,
  startFresh,
  stopAnswering,
  talkTo,
  useStudioTalk,
} from "./studioTalk";
import type { StudioAgent } from "./useStudioAgents";
import type { StudioResult } from "./studioResults";
import { studioInputClass } from "./StudioBox";
import { AskTeammate } from "./AskTeammate";
import { talkPanelClass } from "./talkPanel";
import { useTeammateAgents } from "./teammates";

const stateWords = { working: "Working", "needs-you": "Needs you", resting: "Free" } as const;
/** The dot before the state's words: green at work, amber waiting on the person. */
const stateDot = { working: "green", "needs-you": "amber", resting: undefined } as const;
/** How many of the latest messages the panel shows; the chat page has the rest. */
const SHOWN = 8;

/** An agent's questions waiting for its person, answered right here: nothing runs until they are. */
export function Questions(props: { agentId: string; name: string }) {
  const all = useActionQuestions((state) => state.items);
  const questions = all.filter((question) => question.agentId === props.agentId);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!questions.length) return null;
  const answer = (id: string, allow: boolean) => {
    setBusy(id);
    setError("");
    void answerActionQuestion(id, allow)
      .catch(() => setError("That question already closed. Nothing was done."))
      .finally(() => setBusy(""));
  };
  return (
    <div className="grid gap-2">
      {questions.map((question) => (
        <Surface
          key={question.id}
          artWash="amber"
          radius="xl"
          className="grid gap-2 p-2.5"
          role="group"
        >
          <Text wrap size="meta" tone="bright">
            {actionQuestionText(question, props.name)}
          </Text>
          {actionQuestionHasDetails(question) ? (
            <CodeBlock
              code={question.control}
              wrap
              copy={false}
              className="max-h-30 overflow-auto"
            />
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="primary"
              className="flex-1"
              disabled={busy === question.id}
              onClick={() => answer(question.id, true)}
            >
              Allow
            </Button>
            <Button
              className="flex-1"
              disabled={busy === question.id}
              onClick={() => answer(question.id, false)}
            >
              Deny
            </Button>
          </div>
        </Surface>
      ))}
      {error ? (
        <Text wrap size="caption" tone="muted" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * A finished task's result waiting on the agent's desk: what the task was and, when the chat below
 * isn't the one it finished in, what it handed back. Collecting it takes it off the desk.
 */
function ResultCard(props: { result: StudioResult; inChat: boolean; onCollect(): void }) {
  const { result } = props;
  return (
    <Surface
      artWash="green"
      radius="xl"
      className="grid gap-2 p-2.5"
      role="group"
      aria-label="Result"
    >
      {result.task ? (
        <Text size="meta" tone="bright" lines={2}>
          {result.task}
        </Text>
      ) : null}
      {result.text && !props.inChat ? (
        <Text
          bare
          as="div"
          size="meta"
          tone="bright"
          className="max-h-40 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]"
        >
          <MistyMarkdown>{result.text}</MistyMarkdown>
        </Text>
      ) : null}
      <Button variant="primary" onClick={props.onCollect}>
        Collect
      </Button>
    </Surface>
  );
}

/** The most of an agent's chats the switcher lists; older ones are on the chat page. */
const LISTED = 20;

/**
 * Which of the agent's chats the panel talks in: a new one, or any of its recent ones. An agent
 * can be on several at once, and the ones it is still answering in are marked.
 */
function ChatSwitcher(props: {
  agentId: string;
  chat: GlobalAiConversation | undefined;
  conversations: readonly GlobalAiConversation[];
  onPicked(): void;
}) {
  const own = chatsOf(props.conversations, props.agentId).slice(0, LISTED);
  return (
    <DropdownMenu>
      <MenuTrigger
        label={props.chat ? props.chat.title || "Untitled chat" : "New chat"}
        justify="start"
        className="-mt-1"
      />
      <DropdownMenuContent align="start" className="max-h-90 max-w-80 overflow-y-auto">
        <MenuRadioGroup
          value={props.chat?.id ?? "new"}
          onValueChange={(id) => {
            if (id === "new") startFresh(props.agentId);
            else chooseChat(props.agentId, id);
            props.onPicked();
          }}
        >
          <MenuRadioItem value="new" label="New chat" />
          {own.length ? <MenuSeparator /> : null}
          {own.map((chat) => (
            <MenuRadioItem
              key={chat.id}
              value={chat.id}
              label={chat.title || "Untitled chat"}
              // A row's state sits at its right end: a spinner while the agent answers in it.
              state={
                isAnswering(props.conversations, chat.id) ? (
                  <Spinner size="sm" label="Answering" />
                ) : undefined
              }
            />
          ))}
        </MenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Talking to the agent that was picked, without leaving the studio: what it is doing, anything it
 * is waiting on its person for, the latest of the chat it is talked to in, and a box to say
 * something. What is said goes into that chat (`studioTalk.ts`). A teammate's agent can be looked
 * at but not asked, so its panel has no box: an agent takes requests only from its own person.
 */
export function AgentTalk(props: {
  actor: Actor;
  name: string;
  /** The person's own agent behind the figure; a visitor has none. */
  item?: StudioAgent;
  /** Changes when the person walks up to the agent, which puts the cursor in the box. */
  focus: number;
  onOpenChat(agentId: string, conversationId: string): void;
  /** Opens the panel to change its name, role, look and desk. */
  onCustomize?(): void;
  /** Opens the agent's settings: its engine, model and instructions. */
  onSettings?(): void;
  onClose(): void;
  /** Its record in the studio: level, tasks done, streaks. */
  record?: AgentRecord;
  /** A finished task's result waiting on its desk. */
  result?: StudioResult;
  /** Takes the waiting result off its desk. */
  onCollect?(): void;
}) {
  const { actor, item, name } = props;
  const agent = item?.agent;
  const conversations = useMistyStore((state) => state.conversations);
  const followed = useMistyStore((state) =>
    state.working ? state.invocationConversationId : undefined,
  );
  const chats = useStudioTalk((state) => state.chats);
  const fresh = useStudioTalk((state) => state.fresh);
  const chat = agent
    ? studioChatOf(agent.id, item?.conversationId ?? "", conversations, { chats, fresh })
    : undefined;
  const answering = Boolean(chat && isAnswering(conversations, chat.id));
  // While the chat page follows this run, a message steers it, as it would there.
  const steerable = answering && followed === chat?.id;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const shown = chat?.messages.slice(-SHOWN) ?? [];
  const last = shown[shown.length - 1];

  useEffect(() => {
    if (props.focus) input.current?.focus();
  }, [props.focus]);
  useEffect(() => {
    const box = scroll.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [last?.id, last?.content]);

  const send = async (text = draft, spoken = false) => {
    if (!agent || sending || !text.trim()) return;
    setSending(true);
    setError("");
    try {
      await talkTo(agent, text, chat?.id, spoken);
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };
  // What it waits on is in the chat its run is in.
  const open = () => agent && props.onOpenChat(agent.id, item?.conversationId || chat?.id || "");

  // The microphone: what is said shows in the box as it's heard, and goes to the agent once the
  // person stops, to be answered aloud. Recognized on this computer, with no key.
  const speech = useSpeechSupport();
  const [hearing, setHearing] = useState<Listening | null>(null);
  const heard = useRef<Listening | null>(null);
  const typed = useRef("");
  useEffect(() => () => void heard.current?.stop().catch(() => undefined), []);
  const withTyped = (said: string) => [typed.current.trim(), said.trim()].filter(Boolean).join(" ");
  const toggleMic = async () => {
    const listening = heard.current;
    if (listening) {
      heard.current = null;
      setHearing(null);
      const said = await listening.stop().catch(() => "");
      const text = withTyped(said);
      setDraft(text);
      if (said.trim()) void send(text, true);
      return;
    }
    typed.current = draft;
    setError("");
    try {
      const started = await listen((now) => {
        if (now.error) setError(now.error);
        else setDraft(withTyped(now.text));
      });
      heard.current = started;
      setHearing(started);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const now =
    actor.state === "working"
      ? [actor.doing || "Working", actor.task].filter(Boolean).join(" · ")
      : "";
  // A visiting agent is asked for through its person, who decides whether to pass it on.
  const visitor = useTeammateAgents((state) =>
    actor.guest ? state.agents.find((mate) => `guest:${mate.key}` === actor.id) : undefined,
  );

  return (
    <Surface
      as="section"
      tone="scene-panel"
      radius="2xl"
      className={talkPanelClass}
      data-state={actor.state}
      aria-label={`Talk to ${name}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <header className="flex min-h-6 items-center gap-2">
        <AgentAvatar agent={agent} compact />
        <Text as="h3" tone="bright" className="text-sm font-medium">
          {actor.guest ? `${name} · ${actor.owner}` : name}
        </Text>
        <Text
          bare
          size="caption"
          tone="muted"
          className="inline-flex flex-none items-center gap-1.5"
          data-state={actor.state}
        >
          <Surface
            as="span"
            tone="active"
            art={stateDot[actor.state]}
            radius="full"
            className="size-2"
            aria-hidden="true"
          />
          {stateWords[actor.state]}
        </Text>
        <ActionBar
          label={`${name} actions`}
          size="sm"
          width="content"
          className="ml-auto"
          items={
            agent
              ? [
                  ...(props.onCustomize
                    ? [
                        iconBarItem({
                          id: "customize",
                          icon: Shirt,
                          label: "Customize",
                          size: "sm",
                          priority: 1,
                          onSelect: props.onCustomize,
                        }),
                      ]
                    : []),
                  ...(props.onSettings
                    ? [
                        iconBarItem({
                          id: "settings",
                          icon: Settings,
                          label: `${name} settings`,
                          size: "sm",
                          priority: 1,
                          onSelect: props.onSettings,
                        }),
                      ]
                    : []),
                ]
              : []
          }
          end={
            <IconButton label="Close" size="sm" onClick={props.onClose}>
              <X aria-hidden="true" />
            </IconButton>
          }
        />
      </header>
      {/* The one Space this agent works and saves in, whichever Space the window shows. */}
      {agent ? <AgentHomeSpaceLine agent={agent} /> : null}
      {agent ? <AgentRecordRow record={props.record} /> : null}
      {agent ? (
        <ChatSwitcher
          agentId={agent.id}
          chat={chat}
          conversations={conversations}
          onPicked={() => input.current?.focus()}
        />
      ) : null}
      {now || actor.clash ? (
        <Surface tone="faint" radius="lg" className="grid gap-1 px-2.5 py-2">
          {now ? (
            <Text as="p" size="caption" tone="default" lines={2}>
              {now}
            </Text>
          ) : null}
          {actor.clash ? (
            <Text as="p" size="caption" tone="waiting" lines={2} data-clash="true">
              {actor.clash}
            </Text>
          ) : null}
        </Surface>
      ) : null}
      {visitor ? (
        <AskTeammate
          member={{ userId: visitor.userId, name: visitor.owner }}
          agents={[visitor]}
          focus={props.focus}
        />
      ) : null}
      {agent ? <Questions agentId={agent.id} name={name} /> : null}
      {agent && props.result && props.onCollect ? (
        <ResultCard
          result={props.result}
          inChat={Boolean(chat && chat.id === props.result.conversationId)}
          onCollect={props.onCollect}
        />
      ) : null}
      {agent && actor.state === "needs-you" && !answering ? (
        <Button onClick={open}>Answer in chat</Button>
      ) : null}
      {shown.length ? (
        <div
          className="flex min-h-0 flex-auto flex-col gap-2 overflow-y-auto overscroll-contain"
          ref={scroll}
          aria-live="polite"
        >
          {shown.map((message) => {
            // As the chat page shows it: Tutor's tags and private context left out.
            const text = visibleConversationContent(message.content, message.role);
            const coming = message.state === "pending" || message.state === "streaming";
            if (!text && !coming) return null;
            const user = message.role === "user";
            return (
              <Surface
                key={message.id}
                tone={user ? "well" : "none"}
                radius="xl"
                className={cn("max-w-[88%] py-2", user ? "self-end px-2.5" : "self-start px-0.5")}
                data-role={message.role}
                data-state={message.state}
              >
                <Text
                  bare
                  as="div"
                  size="meta"
                  tone={message.state === "failed" ? "muted" : "bright"}
                  className={cn(
                    "[overflow-wrap:anywhere]",
                    user ? "whitespace-pre-wrap" : "whitespace-normal",
                  )}
                >
                  {!text ? (
                    <Text
                      bare
                      tone="muted"
                      className="inline-flex gap-1 py-1.5"
                      aria-label={`${name} is answering`}
                    >
                      {["", "[animation-delay:0.15s]", "[animation-delay:0.3s]"].map((delay) => (
                        <i
                          key={delay}
                          className={cn(
                            "size-1.5 rounded-full bg-current",
                            "animate-[misty-dot-blink_1.1s_ease-in-out_infinite]",
                            "motion-reduce:animate-none motion-reduce:opacity-60",
                            delay,
                          )}
                        />
                      ))}
                    </Text>
                  ) : message.role === "assistant" ? (
                    <MistyMarkdown>{text}</MistyMarkdown>
                  ) : (
                    text
                  )}
                </Text>
              </Surface>
            );
          })}
        </div>
      ) : null}
      {error ? (
        <Text wrap size="caption" tone="muted" role="alert">
          {error}
        </Text>
      ) : null}
      {agent ? (
        <Surface
          as="form"
          tone="faint"
          edge="field"
          radius="xl"
          className="flex items-end gap-1.5 py-1.5 pr-1.5 pl-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            ref={input}
            variant="composer"
            rows={1}
            className={studioInputClass}
            value={draft}
            maxLength={8000}
            disabled={!agent.enabled || (answering && !steerable)}
            placeholder={answering && !steerable ? `${name} is answering…` : `Ask ${name}…`}
            aria-label={`Message ${name}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void send();
            }}
          />
          {answering && !steerable && chat ? (
            <IconButton
              label="Stop"
              type="button"
              onClick={() =>
                void stopAnswering(chat.id).catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : String(reason)),
                )
              }
            >
              <Square aria-hidden="true" />
            </IconButton>
          ) : (
            <>
              {speech?.recognition && agent.enabled ? (
                <IconButton
                  label={hearing ? "Stop and send" : "Speak"}
                  type="button"
                  aria-pressed={Boolean(hearing)}
                  disabled={sending}
                  onClick={() => void toggleMic()}
                >
                  {hearing ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
                </IconButton>
              ) : null}
              {hearing ? null : (
                <IconButton label="Send" type="submit" disabled={sending || !draft.trim()}>
                  <ArrowUp aria-hidden="true" />
                </IconButton>
              )}
            </>
          )}
        </Surface>
      ) : null}
    </Surface>
  );
}

import { ArrowUp, MessageSquare, Settings, Shirt, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { studioInputClass } from "./StudioBox";

const stateWords = { working: "Working", "needs-you": "Needs you", resting: "Free" } as const;
/** The dot before the state's words: green at work, amber waiting on the person. */
const stateDot = { working: "green", "needs-you": "amber", resting: undefined } as const;
/** How many of the latest messages the panel shows; the chat page has the rest. */
const SHOWN = 8;

/** An agent's questions waiting for its person, answered right here: nothing runs until they are. */
function Questions(props: { agentId: string; name: string }) {
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

  const send = async () => {
    if (!agent || sending || !draft.trim()) return;
    setSending(true);
    setError("");
    try {
      await talkTo(agent, draft, chat?.id);
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };
  const open = () => agent && props.onOpenChat(agent.id, chat?.id ?? item?.conversationId ?? "");
  const now =
    actor.state === "working"
      ? [actor.doing || "Working", actor.task].filter(Boolean).join(" · ")
      : "";

  return (
    <Surface
      as="section"
      tone="scene-panel"
      radius="2xl"
      className={cn(
        // Docked on the right under the bar; on a narrow window, along the bottom instead.
        "absolute top-3 right-[calc(0.75rem+var(--window-chrome-right,0px))] z-[var(--stack-overlay)]",
        "flex max-h-[calc(100%-6rem)] w-90 max-w-[calc(100%-1.5rem)] flex-col gap-2.5 p-3",
        "max-[720px]:inset-x-3 max-[720px]:top-auto max-[720px]:bottom-4 max-[720px]:max-h-[60%]",
        "max-[720px]:w-auto max-[720px]:max-w-none",
      )}
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
                  iconBarItem({
                    id: "open",
                    icon: MessageSquare,
                    label: "Open chat",
                    size: "sm",
                    priority: 2,
                    onSelect: open,
                  }),
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
      {agent ? (
        <ChatSwitcher
          agentId={agent.id}
          chat={chat}
          conversations={conversations}
          onPicked={() => input.current?.focus()}
        />
      ) : null}
      {now ? (
        <Surface tone="faint" radius="lg" className="px-2.5 py-2">
          <Text as="p" size="caption" tone="default" lines={2}>
            {now}
          </Text>
        </Surface>
      ) : null}
      {agent ? <Questions agentId={agent.id} name={name} /> : null}
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
            <IconButton label="Send" type="submit" disabled={sending || !draft.trim()}>
              <ArrowUp aria-hidden="true" />
            </IconButton>
          )}
        </Surface>
      ) : null}
    </Surface>
  );
}

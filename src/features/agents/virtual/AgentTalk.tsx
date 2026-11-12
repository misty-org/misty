import { ArrowUp, MessageSquare, Shirt, Square, SquarePen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
  Textarea,
  OverflowFadeText,
} from "@/shared/ui";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import { useMistyStore } from "../conversations/state/useMistyStore";
import {
  actionQuestionHasDetails,
  actionQuestionText,
  answerActionQuestion,
  useActionQuestions,
} from "../island/actionQuestions";
import { AgentAvatar } from "../personal/AgentAvatar";
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

const stateWords = { working: "Working", "needs-you": "Needs you", resting: "Free" } as const;
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
        <div key={question.id} className="virtual-studio-talk-ask" role="group">
          <p>{actionQuestionText(question, props.name)}</p>
          {actionQuestionHasDetails(question) ? <pre>{question.control}</pre> : null}
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
        </div>
      ))}
      {error ? (
        <p className="virtual-studio-talk-error" role="alert">
          {error}
        </p>
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
        className="virtual-studio-talk-chat"
      />
      <DropdownMenuContent align="start" className="virtual-studio-talk-chats">
        <MenuRadioGroup
          value={props.chat?.id ?? "new"}
          onValueChange={(id) => {
            if (id === "new") startFresh(props.agentId);
            else chooseChat(props.agentId, id);
            props.onPicked();
          }}
        >
          <MenuRadioItem icon={SquarePen} value="new" label="New chat" />
          {own.length ? <MenuSeparator /> : null}
          {own.map((chat) => (
            <MenuRadioItem
              key={chat.id}
              value={chat.id}
              icon={
                isAnswering(props.conversations, chat.id) ? (
                  <Spinner size="sm" label="Answering" />
                ) : (
                  MessageSquare
                )
              }
              label={chat.title || "Untitled chat"}
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
    <section
      className="virtual-studio-talk"
      data-state={actor.state}
      aria-label={`Talk to ${name}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <header className="virtual-studio-talk-head">
        <AgentAvatar agent={agent} compact />
        <OverflowFadeText as="h3" className="text-sm font-medium text-cream-bright">
          {actor.guest ? `${name} · ${actor.owner}` : name}
        </OverflowFadeText>
        <span className="virtual-studio-state" data-state={actor.state}>
          {stateWords[actor.state]}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          {agent ? (
            <>
              {props.onCustomize ? (
                <IconButton label="Customize" size="sm" onClick={props.onCustomize}>
                  <Shirt aria-hidden="true" />
                </IconButton>
              ) : null}
              <IconButton label="Open chat" size="sm" onClick={open}>
                <MessageSquare aria-hidden="true" />
              </IconButton>
            </>
          ) : null}
          <IconButton label="Close" size="sm" onClick={props.onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </span>
      </header>
      {agent ? (
        <ChatSwitcher
          agentId={agent.id}
          chat={chat}
          conversations={conversations}
          onPicked={() => input.current?.focus()}
        />
      ) : null}
      {now ? <p className="virtual-studio-talk-now">{now}</p> : null}
      {agent ? <Questions agentId={agent.id} name={name} /> : null}
      {agent && actor.state === "needs-you" && !answering ? (
        <Button onClick={open}>Answer in chat</Button>
      ) : null}
      {shown.length ? (
        <div className="virtual-studio-talk-log" ref={scroll} aria-live="polite">
          {shown.map((message) => (
            <div
              key={message.id}
              className="virtual-studio-talk-message"
              data-role={message.role}
              data-state={message.state}
            >
              {message.role === "assistant" && !message.content ? (
                <span className="virtual-studio-talk-typing" aria-label={`${name} is answering`}>
                  <i />
                  <i />
                  <i />
                </span>
              ) : message.role === "assistant" ? (
                <MistyMarkdown>{message.content}</MistyMarkdown>
              ) : (
                message.content
              )}
            </div>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="virtual-studio-talk-error" role="alert">
          {error}
        </p>
      ) : null}
      {agent ? (
        <form
          className="virtual-studio-talk-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            ref={input}
            variant="composer"
            rows={1}
            className="virtual-studio-talk-input"
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
              size="sm"
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
            <IconButton label="Send" size="sm" type="submit" disabled={sending || !draft.trim()}>
              <ArrowUp aria-hidden="true" />
            </IconButton>
          )}
        </form>
      ) : null}
    </section>
  );
}

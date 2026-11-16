import { ArrowUp, MessageSquare, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ActionBar,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  iconBarItem,
  MenuItem,
  Skeleton,
  Surface,
  Text,
  Textarea,
} from "@/shared/ui";
import { draftRequestForAgent } from "../conversations/ask/draftRequest";
import { agentAccountId } from "../personal/agentAccount";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import { AskTeammate } from "./AskTeammate";
import { PersonAvatar } from "./StudioHud";
import { studioInputClass } from "./StudioBox";
import { talkFieldClass, talkPanelClass } from "./talkPanel";
import { useStudioRequests, type StudioRequest } from "./teamMembers";
import { useTeammateAgents } from "./teammates";

type Message = { id: string; mine: boolean; text: string; at: string };

/** How many of the latest direct messages the panel shows; the chat has the rest. */
const SHOWN = 6;

/**
 * Walked up to a member: who they are and where in Misty they are, what their agents are doing,
 * the requests they sent you, your last few direct messages with a box to send another, and a box
 * that asks one of their agents through them.
 */
export function MemberTalk(props: {
  spaceId: string;
  member: { userId: string; name: string; picture?: string; where: string };
  focus: number;
  onClose(): void;
}) {
  const { spaceId, member } = props;
  const navigate = useNavigate();
  const everyAgent = useTeammateAgents((state) => state.agents);
  const everyRequest = useStudioRequests((state) => state.requests);
  const agents = useMemo(
    () => everyAgent.filter((mate) => mate.userId === member.userId),
    [everyAgent, member.userId],
  );
  const requests = useMemo(
    () => everyRequest.filter((request) => request.fromUserId === member.userId),
    [everyRequest, member.userId],
  );
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  const reload = useCallback(async () => {
    try {
      const found = await spacesGateway.get().directMessages(spaceId, member.userId, SHOWN);
      setConversationId(found.conversationId);
      setMessages(found.messages);
    } catch (reason) {
      setMessages((known) => known ?? []);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [spaceId, member.userId]);
  useEffect(() => void reload(), [reload]);
  // A message from them, or sent from the chat, shows here as it arrives.
  useEffect(() => {
    let timer = 0;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string; space_id?: string }>).detail;
      if ((detail?.spaceId ?? detail?.space_id) !== spaceId) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 400);
    };
    window.addEventListener("misty:space-message-event", changed);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("misty:space-message-event", changed);
    };
  }, [reload, spaceId]);
  useEffect(() => {
    if (props.focus) input.current?.focus();
  }, [props.focus]);

  const send = async () => {
    const text = draft.trim();
    if (sending || !text) return;
    setSending(true);
    setError("");
    try {
      const sent = await spacesGateway.get().sendDirectMessage(spaceId, member.userId, text);
      setConversationId(sent.conversationId);
      setDraft("");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };
  const openChat = () =>
    conversationId &&
    navigate(
      `/spaces/${encodeURIComponent(spaceId)}/chat?conversation=${encodeURIComponent(conversationId)}`,
    );

  return (
    <Surface
      as="section"
      tone="scene-panel"
      radius="2xl"
      className={talkPanelClass}
      aria-label={`Talk to ${member.name}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <header className="flex min-h-6 items-center gap-2">
        <PersonAvatar name={member.name} picture={member.picture} />
        <div className="min-w-0">
          <Text as="h3" tone="bright" className="text-sm font-medium">
            {member.name}
          </Text>
          {member.where ? (
            <Text bare as="p" size="caption" tone="muted" lines={1}>
              {member.where}
            </Text>
          ) : null}
        </div>
        <ActionBar
          label={`${member.name} actions`}
          size="sm"
          width="content"
          className="ml-auto"
          items={[
            iconBarItem({
              id: "open",
              icon: MessageSquare,
              label: "Open chat",
              size: "sm",
              priority: 2,
              onSelect: openChat,
            }),
          ]}
          end={
            <IconButton label="Close" size="sm" onClick={props.onClose}>
              <X aria-hidden="true" />
            </IconButton>
          }
        />
      </header>
      {agents.length ? (
        <Surface tone="faint" radius="lg" className="grid gap-1 px-2.5 py-2">
          {agents.map((mate) => (
            <Text key={mate.key} as="p" size="caption" tone="default" lines={1}>
              {mate.name} ·{" "}
              {mate.doing || (mate.state === "needs-you" ? `Needs ${member.name}` : "Free")}
            </Text>
          ))}
        </Surface>
      ) : null}
      {requests.map((request) => (
        <Request key={request.id} request={request} onError={setError} />
      ))}
      <div className="flex min-h-0 flex-auto flex-col gap-2 overflow-y-auto overscroll-contain">
        {messages === null
          ? [0, 1].map((index) => (
              <Skeleton
                key={index}
                className={cn("h-8 w-3/5 rounded-xl", index ? "self-end" : "self-start")}
              />
            ))
          : messages.map((message) => (
              <Surface
                key={message.id}
                tone={message.mine ? "well" : "none"}
                radius="xl"
                className={cn(
                  "max-w-[88%] py-2",
                  message.mine ? "self-end px-2.5" : "self-start px-0.5",
                )}
              >
                <Text bare as="div" size="meta" tone="bright" className="whitespace-pre-wrap">
                  {message.text}
                </Text>
              </Surface>
            ))}
      </div>
      {error ? (
        <Text wrap size="caption" tone="muted" role="alert">
          {error}
        </Text>
      ) : null}
      <Surface
        as="form"
        tone="faint"
        edge="field"
        radius="xl"
        className={talkFieldClass}
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
          maxLength={4000}
          placeholder={`Message ${member.name}`}
          aria-label={`Message ${member.name}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void send();
          }}
        />
        <IconButton label="Send" type="submit" disabled={sending || !draft.trim()}>
          <ArrowUp aria-hidden="true" />
        </IconButton>
      </Surface>
      {agents.length ? <AskTeammate member={member} agents={agents} /> : null}
    </Surface>
  );
}

/**
 * A request the member sent for one of this person's agents. Giving it puts the words in that
 * agent's composer, unsent, so it becomes the person's own request only when they send it.
 */
function Request(props: { request: StudioRequest; onError(message: string): void }) {
  const { request } = props;
  const all = usePersonalAgentsStore((state) => state.agents);
  useEffect(() => {
    const store = usePersonalAgentsStore.getState();
    const account = agentAccountId();
    if (store.accountId !== account || !store.agents.length) void store.load(account);
  }, []);
  const enabled = all.filter((agent) => agent.enabled);
  const asked = enabled.find((agent) => agent.id === request.agentId);
  const mine = asked ? [asked, ...enabled.filter((agent) => agent !== asked)] : enabled;
  const give = (agentId: string) => {
    const problem = draftRequestForAgent(agentId, request.text);
    if (problem) props.onError(problem);
    else request.done();
  };
  return (
    <Surface tone="faint" radius="lg" className="grid gap-2 px-2.5 py-2">
      <Text as="p" size="caption" tone="default" lines={4} className="whitespace-pre-wrap">
        {request.text}
      </Text>
      <div className="flex min-w-0 items-center gap-2">
        {asked || mine.length < 2 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!mine.length}
            onClick={() => mine[0] && give(mine[0].id)}
          >
            {asked ? `Give to ${asked.name}` : "Give to my agent"}
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="secondary" size="sm">
                Give to my agent
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" data-misty-layer-portal>
              {mine.map((agent) => (
                <MenuItem key={agent.id} label={agent.name} onSelect={() => give(agent.id)} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button type="button" variant="quiet" size="sm" onClick={request.done}>
          Dismiss
        </Button>
      </div>
    </Surface>
  );
}

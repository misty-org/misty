import { ArrowUp } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, SuggestionItem, SuggestionList, Textarea } from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
import { mentionsIn } from "./studioNames";
import { huddle, studioChatOf, talkTo, useStudioTalk } from "./studioTalk";
import { useMistyStore } from "../conversations/state/useMistyStore";
import type { StudioAgent } from "./useStudioAgents";

/** The most agents one message gives a task to at once. */
const MOST_AT_ONCE = 4;

/** The `@name` being typed at the cursor, if any: where it starts and what is typed of it so far. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > 40) return null;
  return { start: at, query };
}

/**
 * One box for the whole studio: `@` an agent and say what you want, and it goes to that agent's
 * chat; `@` several and they all take it on together at the meeting table. What it was given shows
 * in its talk panel, which opens.
 */
export function StudioBox(props: {
  agents: StudioAgent[];
  names: Map<string, string>;
  onTalking(agentId: string): void;
}) {
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const typing = mentionAt(draft, caret);
  const query = typing?.query.toLowerCase() ?? "";
  const offered = typing
    ? props.agents.filter(({ agent }) =>
        (props.names.get(agent.id) ?? agent.name).toLowerCase().startsWith(query),
      )
    : [];
  const chosen = offered[Math.min(pick, offered.length - 1)];

  const choose = (agent: AgentProfile) => {
    if (!typing) return;
    const name = props.names.get(agent.id) ?? agent.name;
    const next = `${draft.slice(0, typing.start)}@${name} ${draft.slice(caret)}`;
    const at = typing.start + name.length + 2;
    setDraft(next);
    setCaret(at);
    setPick(0);
    requestAnimationFrame(() => input.current?.setSelectionRange(at, at));
  };

  const send = async () => {
    if (sending || !draft.trim()) return;
    const { ids, message } = mentionsIn(props.names, draft);
    const targets = ids
      .map((id) => props.agents.find((item) => item.agent.id === id))
      .filter((item): item is StudioAgent => Boolean(item));
    if (!targets.length) return setError("Start with @ and the name of an agent.");
    if (!message) return setError("Say what you'd like after the name.");
    if (targets.length > MOST_AT_ONCE)
      return setError(`Up to ${MOST_AT_ONCE} agents can take on one task together.`);
    setSending(true);
    setError("");
    try {
      if (targets.length === 1) {
        const [{ agent, conversationId }] = targets as [StudioAgent];
        const chat = studioChatOf(
          agent.id,
          conversationId,
          useMistyStore.getState().conversations,
          useStudioTalk.getState(),
        );
        await talkTo(agent, message, chat?.id);
      } else {
        await huddle(
          targets.map(({ agent }) => ({ agent, name: props.names.get(agent.id) ?? agent.name })),
          message,
        );
      }
      props.onTalking(targets[0]!.agent.id);
      setDraft("");
      setCaret(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="virtual-studio-box"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {offered.length ? (
        <SuggestionList className="virtual-studio-box-mentions" aria-label="Agents">
          {offered.map((item) => (
            <SuggestionItem
              key={item.agent.id}
              selected={item === chosen}
              onPointerDown={() => choose(item.agent)}
            >
              <AgentAvatar agent={item.agent} compact />
              <span className="min-w-0 flex-1 truncate">
                {props.names.get(item.agent.id) ?? item.agent.name}
              </span>
              {item.agent.role ? (
                <span className="max-w-[45%] truncate text-xs text-cream-muted">
                  {item.agent.role}
                </span>
              ) : null}
            </SuggestionItem>
          ))}
        </SuggestionList>
      ) : null}
      {error ? (
        <p className="virtual-studio-box-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="virtual-studio-box-field">
        <Textarea
          ref={input}
          variant="composer"
          rows={1}
          className="virtual-studio-talk-input"
          value={draft}
          maxLength={8000}
          placeholder="Message an agent with @"
          aria-label="Talk to the studio"
          role="combobox"
          aria-expanded={offered.length > 0}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart);
            setPick(0);
            setError("");
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (offered.length) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setPick((known) => (known + step + offered.length) % offered.length);
                return;
              }
              if ((event.key === "Enter" || event.key === "Tab") && chosen) {
                event.preventDefault();
                choose(chosen.agent);
                return;
              }
            }
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void send();
          }}
        />
        <IconButton label="Send" size="xs" type="submit" disabled={sending || !draft.trim()}>
          <ArrowUp aria-hidden="true" />
        </IconButton>
      </div>
    </form>
  );
}

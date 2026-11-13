import { ArrowUp } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, SuggestionItem, SuggestionList, Text, Textarea } from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
import { mentionsIn } from "./studioNames";
import { huddle, studioChatOf, talkTo, useStudioTalk } from "./studioTalk";
import { useMistyStore } from "../conversations/state/useMistyStore";
import type { StudioAgent } from "./useStudioAgents";

/** The message box's own text: one line that grows with what is typed, up to five. */
export const studioInputClass =
  "field-sizing-content max-h-30 min-h-6 flex-1 py-0.5 text-meta leading-5";

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
      className="relative grid gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {offered.length ? (
        // Above the box, at least wide enough for an agent's name and engine, never cut by the dock.
        <SuggestionList
          className="absolute bottom-[calc(100%+0.875rem)] -left-1 z-[var(--stack-overlay-raised)] max-h-60 w-[calc(100%+0.5rem)] min-w-65 overflow-y-auto"
          aria-label="Agents"
        >
          {offered.map((item) => (
            <SuggestionItem
              key={item.agent.id}
              selected={item === chosen}
              icon={<AgentAvatar agent={item.agent} compact />}
              label={props.names.get(item.agent.id) ?? item.agent.name}
              detail={item.agent.role || undefined}
              onPointerDown={() => choose(item.agent)}
            />
          ))}
        </SuggestionList>
      ) : null}
      {error ? (
        <Text wrap size="caption" tone="muted" className="px-2 pt-1" role="alert">
          {error}
        </Text>
      ) : null}
      <div className="flex items-end gap-1.5 py-1 pr-1 pl-2">
        <Textarea
          ref={input}
          variant="composer"
          rows={1}
          className={studioInputClass}
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
        <IconButton label="Send" type="submit" disabled={sending || !draft.trim()}>
          <ArrowUp aria-hidden="true" />
        </IconButton>
      </div>
    </form>
  );
}

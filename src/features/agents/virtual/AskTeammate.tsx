import { ArrowUp, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  Surface,
  Text,
  Textarea,
} from "@/shared/ui";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import { studioInputClass } from "./StudioBox";
import { talkFieldClass } from "./talkPanel";
import type { TeammateAgent } from "./teammates";

/**
 * Asks for one of a member's agents, through the member: the words go to them as a request, and
 * they decide whether to hand it to that agent. An agent only ever takes requests from its own
 * person, so nothing here reaches it directly.
 */
export function AskTeammate(props: {
  member: { userId: string; name: string };
  agents: TeammateAgent[];
  focus?: number;
}) {
  const [agentKey, setAgentKey] = useState(props.agents[0]?.key ?? "");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const agent = props.agents.find((mate) => mate.key === agentKey) ?? props.agents[0];
  useEffect(() => {
    if (props.focus) input.current?.focus();
  }, [props.focus]);
  if (!agent) return null;

  const send = async () => {
    const space = spacesGateway.maybe()?.windowSpace();
    const text = draft.trim();
    if (!space || sending || !text) return;
    setSending(true);
    setSaid("");
    try {
      await spacesGateway
        .get()
        .askMembersAgent(
          space.id,
          props.member.userId,
          { id: agent.agentId, name: agent.name },
          text,
        );
      setDraft("");
      setSaid(`Sent to ${props.member.name}`);
    } catch (reason) {
      setSaid(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-1">
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
          placeholder={`Ask ${agent.name} through ${props.member.name}…`}
          aria-label={`Ask ${props.member.name}'s agent ${agent.name}`}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaid("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void send();
          }}
        />
        {props.agents.length > 1 ? (
          <DropdownMenu>
            <MenuTrigger label={agent.name} />
            <DropdownMenuContent align="end" data-misty-layer-portal>
              <MenuRadioGroup value={agent.key} onValueChange={setAgentKey}>
                {props.agents.map((mate) => (
                  <MenuRadioItem key={mate.key} value={mate.key} label={mate.name} />
                ))}
              </MenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <IconButton label="Send" type="submit" disabled={sending || !draft.trim()}>
          <ArrowUp aria-hidden="true" />
        </IconButton>
      </Surface>
      {said ? (
        <Text
          bare
          size="caption"
          tone="muted"
          className="flex items-center gap-1.5 px-1"
          role="status"
        >
          {said.startsWith("Sent to") ? <Check aria-hidden="true" /> : null}
          {said}
        </Text>
      ) : null}
    </div>
  );
}

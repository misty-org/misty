import { useEffect, useRef, useState, type ReactNode } from "react";
import { RoomEvent, type Participant, type Room } from "livekit-client";
import { Mic, Volume2 } from "lucide-react";
import {
  appIcons,
  Button,
  ComposerStatusRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  notify,
} from "@misty/ui";
import { agentCallTurn, callAgents } from "@/features/agents";
import { listen, say, type Listening } from "@/features/voice";
import type { AgentProfile } from "@/shared/schemas";
import type { ActiveCall } from "./callStore";

/**
 * The person's own agents in a call. The person picks one and talks to it; what they say is heard by
 * this computer's speech recognition alone (never the others in the call) and goes into the agent's
 * thread, and its answer is spoken in everyone's own system voice. The answer travels on the call's
 * data channel encrypted with the call's key, so neither the server nor LiveKit can read it.
 */

/** The data channel topic an agent's spoken answers travel on. */
const answerTopic = "misty.agent-say";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function callCipher(key: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function sealAnswer(key: Uint8Array<ArrayBuffer>, answer: { agent: string; text: string }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await callCipher(key),
      encoder.encode(JSON.stringify(answer)),
    ),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv, 0);
  out.set(sealed, iv.length);
  return out;
}

async function openAnswer(key: Uint8Array<ArrayBuffer>, payload: Uint8Array) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: payload.slice(0, 12) },
    await callCipher(key),
    payload.slice(12),
  );
  const answer = JSON.parse(decoder.decode(plain)) as { agent?: unknown; text?: unknown };
  if (typeof answer.agent !== "string" || typeof answer.text !== "string") throw new Error("not an answer");
  return { agent: answer.agent.slice(0, 80), text: answer.text.slice(0, 4000) };
}

type Phase =
  | { kind: "idle" }
  | { kind: "listening"; agent: AgentProfile; listening: Listening }
  | { kind: "thinking"; agent: AgentProfile };

/**
 * The call card's part for agents: `rows` (listening, thinking, speaking) go above the card's
 * controls, and `trigger` (Talk to an agent) among them.
 */
export function useCallAgent({
  room,
  call,
  nameOf,
}: {
  room: Room | null;
  call: ActiveCall;
  /** Whose agent spoke, by the participant who sent its answer. */
  nameOf(userId: string): string;
}): { rows: ReactNode; trigger: ReactNode } {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [spoken, setSpoken] = useState<{ agent: string; owner: string } | null>(null);
  const key = call.key;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const nameOfRef = useRef(nameOf);
  nameOfRef.current = nameOf;

  // Answers from anyone's agent in the call (this person's too, sent to everyone), spoken here.
  useEffect(() => {
    if (!room) return;
    const received = (
      payload: Uint8Array,
      participant?: Participant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== answerTopic) return;
      void openAnswer(key, payload)
        .then((answer) => {
          const owner = participant ? nameOfRef.current(participant.identity) : "Someone";
          setSpoken({ agent: answer.agent, owner });
          return say(answer.text).finally(() => setSpoken(null));
        })
        .catch(() => undefined);
    };
    room.on(RoomEvent.DataReceived, received);
    return () => {
      room.off(RoomEvent.DataReceived, received);
    };
  }, [room, key]);

  // Leaving the call stops any listening.
  useEffect(
    () => () => {
      const current = phaseRef.current;
      if (current.kind === "listening") void current.listening.stop().catch(() => undefined);
    },
    [],
  );

  const start = async (agent: AgentProfile) => {
    if (phase.kind !== "idle") return;
    try {
      const listening = await listen(() => undefined);
      setPhase({ kind: "listening", agent, listening });
    } catch {
      notify({ message: "The microphone couldn’t listen for your agent.", tone: "error" });
    }
  };

  const send = async () => {
    if (phase.kind !== "listening" || !room) return;
    const { agent, listening } = phase;
    const said = (await listening.stop().catch(() => "")).trim();
    if (!said) {
      setPhase({ kind: "idle" });
      notify({ message: `${agent.name} didn’t hear anything.` });
      return;
    }
    setPhase({ kind: "thinking", agent });
    try {
      const text = (await agentCallTurn(agent, said)).trim();
      if (text) {
        const sealed = await sealAnswer(key, { agent: agent.name, text });
        await room.localParticipant.publishData(sealed, { reliable: true, topic: answerTopic });
        setSpoken({ agent: agent.name, owner: "You" });
        await say(text).finally(() => setSpoken(null));
      }
    } catch (reason) {
      notify({
        message: reason instanceof Error ? reason.message : `${agent.name} couldn’t answer.`,
        tone: "error",
      });
    } finally {
      setPhase({ kind: "idle" });
    }
  };

  const cancel = () => {
    if (phase.kind === "listening") void phase.listening.stop().catch(() => undefined);
    setPhase({ kind: "idle" });
  };

  const agents = callAgents();
  const AgentsIcon = appIcons.agents;
  const rows = (
    <>
      {phase.kind === "listening" ? (
        <ComposerStatusRow
          icon={Mic}
          label="Listening"
          actions={
            <>
              <Button variant="quiet" onClick={cancel}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={() => void send()}>
                Send
              </Button>
            </>
          }
        >
          {`Talk to ${phase.agent.name}`}
        </ComposerStatusRow>
      ) : phase.kind === "thinking" ? (
        <ComposerStatusRow icon={AgentsIcon} label="Thinking">
          {phase.agent.name}
        </ComposerStatusRow>
      ) : null}
      {spoken ? (
        <ComposerStatusRow icon={Volume2} label="Speaking">
          {spoken.owner === "You" ? spoken.agent : `${spoken.agent}, ${spoken.owner}’s agent`}
        </ComposerStatusRow>
      ) : null}
    </>
  );
  const trigger = agents.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label="Talk to an agent"
              disabled={call.state !== "live" || phase.kind !== "idle"}
            >
              <AgentsIcon />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" aria-label="Your agents">
            {agents.map((agent) => (
              <MenuItem key={agent.id} label={agent.name} onSelect={() => void start(agent)} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
  ) : null;
  return { rows, trigger };
}

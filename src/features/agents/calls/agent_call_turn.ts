import type { AgentProfile } from "@/shared/schemas";
import { runtimeAiApi } from "@/features/agents/agents_runtime";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { SpokenSentences, spokenParts } from "../tutor/cursor/companion_sentences";
import { handOff, handoffAgents } from "../tutor/cursor/tutor_handoff";
import { uploadMistyImage } from "../conversations/composer/misty_image_attachments";

const answerWaitMs = 10 * 60 * 1000;

export function callAgents(): AgentProfile[] {
  return handoffAgents();
}

export interface CallFrame {
  picture: Blob;
  of: "screen" | "camera";
}

export interface CallTurn {
  finished: Promise<void>;
  stop(): void;
}

interface CallTurnOptions {
  asker?: string;
  conversationId?: string;
  frames?: CallFrame[];
  onSentence(sentence: string): void;
}

export function agentCallTurn(
  agent: AgentProfile,
  said: string,
  options: CallTurnOptions,
): CallTurn {
  const { asker, frames = [] } = options;
  const who = asker ? `${asker} (someone in the call with your person)` : "Your person";
  const seen = frames.length
    ? ` ${frames.length > 1 ? "The pictures with this are" : "The picture with this is"} what they showed you as they said it: ${frames
        .map((frame) => (frame.of === "screen" ? "their shared screen" : "their camera"))
        .join(" and ")}.`
    : "";
  return callTurn(
    agent,
    {
      instruction:
        `(${who} said this to you aloud in a voice call, and is listening for you. ` +
        `Answer at once: first say in one short sentence what you'll do. ` +
        `If it takes work, write one short spoken line before each step you take ("Opening the file now.", ` +
        `"Still searching, nearly there."), so they hear you're still going, then say what you did in a few short ` +
        `spoken sentences. Plain speech only: no lists, links, code or formatting.${seen})\n\n${said}`,
      shown: said,
    },
    options,
  );
}

export function agentCallGreeting(
  agent: AgentProfile,
  where: "alone" | "group",
  options: Omit<CallTurnOptions, "asker" | "frames">,
): CallTurn {
  return callTurn(
    agent,
    where === "alone"
      ? {
          instruction:
            "(Your person just called you, and you've picked up the voice call. " +
            "Greet them in one short spoken sentence, as yourself, then wait for them to talk. " +
            "No lists, links or code.)",
          shown: "Started a call",
        }
      : {
          instruction:
            "(Your person just brought you into a voice call with other people. " +
            "Say hello to everyone in one short spoken sentence, as yourself, then wait to be asked. " +
            "No lists, links or code.)",
          shown: `Brought ${agent.name} into a call`,
        },
    options,
  );
}

function settled(stopped: () => boolean): Promise<void> {
  if (!useMistyStore.getState().working) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useMistyStore.subscribe((state) => {
      if (state.working && !stopped()) return;
      unsubscribe();
      resolve();
    });
  });
}

function callTurn(
  agent: AgentProfile,
  prompt: { instruction: string; shown: string },
  { asker, conversationId, frames = [], onSentence }: CallTurnOptions,
): CallTurn {
  let stopped = false;
  let invocation: string | undefined;
  let halt = () => {};
  const finished = (async () => {
    await settled(() => stopped);
    if (stopped) return;
    const attachments = await Promise.all(
      frames.map((frame, index) => {
        const name = `${frame.of === "screen" ? "Screen" : "Camera"} ${index + 1}.jpg`;
        const type = frame.picture.type || "image/jpeg";
        return uploadMistyImage(new File([frame.picture], name, { type }), { conversationId });
      }),
    );
    const started = await handOff({
      agent,
      instruction: prompt.instruction,
      shown: prompt.shown,
      key: `call-${crypto.randomUUID()}`,
      turn: Date.now(),
      interactionMode: "team",
      screens: [],
      ...(asker ? { permissionMode: "ask" as const } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(attachments.length ? { attachments } : {}),
    });
    invocation = started.invocationId;
    if (stopped) {
      void runtimeAiApi.cancelInvocation(invocation).catch(() => undefined);
      return;
    }
    const sentences = new SpokenSentences((sentence) => {
      if (!stopped) onSentence(sentence);
    });
    let steps = 0;
    await new Promise<void>((resolve, reject) => {
      const answer = () => {
        if (stopped) return finish();
        const conversation = useMistyStore
          .getState()
          .conversations.find((candidate) => candidate.id === started.conversationId);
        const reply = conversation?.messages.find(
          (message) =>
            message.role === "assistant" && message.invocationId === started.invocationId,
        );
        if (!reply) return;
        const text = spokenParts(reply.content).text;
        if (reply.state === "completed") {
          sentences.finish(text);
          return finish();
        }
        if (reply.state === "failed" || reply.state === "canceled")
          return finish(new Error(`${agent.name} couldn’t finish that.`));
        const taken = reply.progress?.length ?? 0;
        if (taken > steps) {
          steps = taken;
          return sentences.finish(text);
        }
        sentences.update(text);
      };
      const finish = (error?: Error) => {
        window.clearTimeout(timer);
        unsubscribe();
        if (error && !stopped) reject(error);
        else resolve();
      };
      halt = () => finish();
      const unsubscribe = useMistyStore.subscribe(() => answer());
      const timer = window.setTimeout(
        () => finish(new Error(`${agent.name} took too long.`)),
        answerWaitMs,
      );
      answer();
    });
  })();
  return {
    finished,
    stop() {
      if (stopped) return;
      stopped = true;
      if (invocation) void runtimeAiApi.cancelInvocation(invocation).catch(() => undefined);
      halt();
    },
  };
}

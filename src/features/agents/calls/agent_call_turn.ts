import type { AgentProfile } from "@/shared/schemas";
import { runtimeAiApi } from "@/features/agents/agents_runtime";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { SpokenSentences, spokenParts } from "../tutor/cursor/companion_sentences";
import { handOff, handoffAgents } from "../tutor/cursor/tutor_handoff";

const answerWaitMs = 10 * 60 * 1000;

export function callAgents(): AgentProfile[] {
  return handoffAgents();
}

export interface CallTurn {
  finished: Promise<void>;
  stop(): void;
}

export function agentCallTurn(
  agent: AgentProfile,
  said: string,
  { asker, onSentence }: { asker?: string; onSentence(sentence: string): void },
): CallTurn {
  let stopped = false;
  let invocation: string | undefined;
  let halt = () => {};
  const who = asker ? `${asker} (someone in the call with your person)` : "Your person";
  const finished = (async () => {
    const started = await handOff({
      agent,
      instruction:
        `(${who} said this to you aloud in a voice call. First say in one short sentence what you'll do. ` +
        `If it takes work, do it, then say what you did in a few short spoken sentences. ` +
        `No lists, links or code.)\n\n${said}`,
      key: `call-${crypto.randomUUID()}`,
      turn: Date.now(),
      interactionMode: "team",
      screens: [],
      ...(asker ? { permissionMode: "ask" as const } : {}),
    });
    invocation = started.invocationId;
    if (stopped) {
      void runtimeAiApi.cancelInvocation(invocation).catch(() => undefined);
      return;
    }
    const sentences = new SpokenSentences((sentence) => {
      if (!stopped) onSentence(sentence);
    });
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

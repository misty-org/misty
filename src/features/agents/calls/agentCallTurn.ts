import type { AgentProfile } from "@/shared/schemas";
import { runtimeAiApi } from "@/features/agents/AgentsRuntime";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { SpokenSentences, spokenParts } from "../tutor/cursor/companionSentences";
import { handOff, handoffAgents } from "../tutor/cursor/tutorHandoff";

/**
 * An agent answering in a call: what someone in the call said to it goes into the agent's own thread
 * as a turn, run on this computer, on the agent's engine and its person's sign-in. The person's own
 * turns run under the agent's own mode; a turn someone else asked for runs in the engine's asking
 * mode, so anything that needs permission asks the agent's person first. The answer comes back a
 * sentence at a time as the engine writes it, to be spoken in the call. Nothing of it runs on the
 * server.
 */

/** How long a call waits for an agent to finish what it was asked. */
const answerWaitMs = 10 * 60 * 1000;

/** The agents a person can bring into a call: the ones the sidebar lists as direct messages. */
export function callAgents(): AgentProfile[] {
  return handoffAgents();
}

export interface CallTurn {
  /** Settles once the answer is finished, or the turn was stopped. */
  finished: Promise<void>;
  /** Stops the turn: the run is cancelled and no more sentences come. */
  stop(): void;
}

/**
 * Asks `agent` what was said to it in a call. `asker` is who said it when it wasn't the agent's own
 * person. Each sentence of the answer goes to `onSentence` as soon as it has been written.
 */
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

import type { AgentProfile } from "@/shared/schemas";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { handOff, handoffAgents } from "../tutor/cursor/tutorHandoff";

/**
 * An agent answering its person in a call: what they said goes into the agent's own thread as a turn,
 * on the agent's engine under its own mode (so anything it does asks first in an asking mode, as
 * always), and the reply's text comes back to be spoken in the call. The agent hears only its own
 * person, through this computer's speech recognition; nothing of it runs on the server.
 */

/** How long a call waits for an agent's spoken answer. */
const answerWaitMs = 3 * 60 * 1000;

/** The agents a person can bring into a call: the ones the sidebar lists as direct messages. */
export function callAgents(): AgentProfile[] {
  return handoffAgents();
}

/** Asks `agent` what its person said in a call, and resolves with the text of its answer. */
export async function agentCallTurn(agent: AgentProfile, said: string): Promise<string> {
  const { invocationId, conversationId } = await handOff({
    agent,
    instruction: `(Said to you aloud in a voice call; answer in a few short spoken sentences, with no lists or code.)\n\n${said}`,
    key: `call-${crypto.randomUUID()}`,
    turn: Date.now(),
    interactionMode: "team",
    screens: [],
  });
  return new Promise<string>((resolve, reject) => {
    const answer = () => {
      const conversation = useMistyStore
        .getState()
        .conversations.find((candidate) => candidate.id === conversationId);
      const reply = conversation?.messages.find(
        (message) => message.role === "assistant" && message.invocationId === invocationId,
      );
      if (!reply) return false;
      if (reply.state === "completed") {
        finish(undefined, reply.content);
        return true;
      }
      if (reply.state === "failed" || reply.state === "canceled") {
        finish(new Error(`${agent.name} couldn’t answer.`));
        return true;
      }
      return false;
    };
    const finish = (error?: Error, text = "") => {
      window.clearTimeout(timer);
      stop();
      if (error) reject(error);
      else resolve(text);
    };
    const stop = useMistyStore.subscribe(() => void answer());
    const timer = window.setTimeout(() => finish(new Error(`${agent.name} took too long to answer.`)), answerWaitMs);
    answer();
  });
}

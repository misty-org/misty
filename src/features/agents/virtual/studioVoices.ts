import { useEffect } from "react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { say, speechSupport, stopSaying, type SystemVoice } from "@/features/voice";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { visibleConversationContent } from "../conversations/view/conversationTurns";
import { hashOf } from "./studio/look";
import { spokenReplies } from "./studioTalk";

/**
 * Each agent's voice in the studio: one of this computer's own voices, with no key. An agent the
 * person hasn't given one gets its own from the voices in their language, picked from its id, so
 * every agent sounds like itself and not like the next. The choice is this computer's, as its
 * voices are.
 */
export const useStudioVoices = createDeviceSetting<Record<string, string>>({
  scope: "agents/studio-voices",
  defaults: {},
  normalize: (stored) =>
    Object.fromEntries(
      Object.entries((stored ?? {}) as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1]),
      ),
    ),
});

/** The voices that speak the person's language, else all of them. */
function nearVoices(voices: readonly SystemVoice[]): readonly SystemVoice[] {
  const language = (navigator.language || "en").slice(0, 2).toLowerCase();
  const near = voices.filter((voice) => voice.language.toLowerCase().startsWith(language));
  return near.length ? near : voices;
}

/** The voice an agent speaks in: the one picked for it, else its own from its id. */
export function voiceOf(
  agentId: string,
  voices: readonly SystemVoice[],
  picked: Record<string, string>,
): SystemVoice | undefined {
  const chosen = voices.find((voice) => voice.id === picked[agentId]);
  if (chosen) return chosen;
  const near = nearVoices(voices);
  return near.length ? near[hashOf(agentId) % near.length] : undefined;
}

/** Gives an agent a voice, or back its own with "". */
export function pickVoice(agentId: string, voiceId: string) {
  const known = { ...useStudioVoices.getState().value };
  if (voiceId) known[agentId] = voiceId;
  else delete known[agentId];
  useStudioVoices.getState().set(known);
}

/** The most of a reply read aloud: past this it is cut at the end of a sentence. */
const MOST_SPOKEN = 700;

/** A reply as it sounds: no code, links or markdown marks, and not too long to listen to. */
export function spokenText(reply: string): string {
  const plain = reply
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= MOST_SPOKEN) return plain;
  const cut = plain.slice(0, MOST_SPOKEN);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > MOST_SPOKEN / 3 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/**
 * While the studio is open, an agent asked something aloud answers aloud once its reply is done,
 * in its own voice. Leaving the studio stops it talking, and replies still coming aren't read.
 */
export function useSpokenReplies() {
  useEffect(() => {
    const check = () => {
      if (!spokenReplies.size) return;
      const { conversations } = useMistyStore.getState();
      for (const chat of conversations) {
        for (const message of chat.messages) {
          if (!spokenReplies.has(message.id)) continue;
          if (message.state === "pending" || message.state === "streaming") continue;
          spokenReplies.delete(message.id);
          if (message.state === "failed") continue;
          const text = spokenText(visibleConversationContent(message.content, message.role));
          if (!text || !chat.agentId) continue;
          const agentId = chat.agentId;
          void speechSupport().then((support) => {
            const voice = voiceOf(agentId, support.voices, useStudioVoices.getState().value);
            return say(text, voice?.id);
          });
        }
      }
    };
    const stop = useMistyStore.subscribe(check);
    return () => {
      stop();
      spokenReplies.clear();
      void stopSaying();
    };
  }, []);
}

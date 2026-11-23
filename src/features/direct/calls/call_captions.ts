import { notify } from "@misty/ui";
import { hear, type HearingSession } from "@/features/voice";
import { tapVoice } from "./agent_hearing";

const INPUT = "caption";

export function captionVoice(track: MediaStreamTrack, say: (text: string) => void): () => void {
  let stopped = false;
  let session: HearingSession | undefined;
  let untap: (() => void) | undefined;
  void (async () => {
    try {
      const open = await hear((event) => {
        if (!stopped && event.kind === "heard" && event.text.trim()) say(event.text);
      });
      session = open;
      if (stopped) return void open.stop().catch(() => undefined);
      const stop = await tapVoice(track, (pcm) => open.push(INPUT, pcm));
      if (stopped) {
        stop();
        return;
      }
      untap = stop;
    } catch {
      if (!stopped) notify({ message: "Captions of your voice couldn’t start.", tone: "error" });
    }
  })();
  return () => {
    stopped = true;
    untap?.();
    void session?.stop().catch(() => undefined);
  };
}

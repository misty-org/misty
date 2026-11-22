import workletUrl from "./agentHearingWorklet.ts?worker&url";

function base64Of(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/**
 * Taps one person's voice in the call, the track the call already carries (cleaned of the call's
 * other voices by its echo cancelling): every ~100ms of it goes to `onPcm` as 16 kHz mono PCM16,
 * base64, the way a hearing session takes it (`hear` in `@/features/voice`). Resolves to the
 * function that stops it.
 */
export async function tapVoice(
  track: MediaStreamTrack,
  onPcm: (pcm: string) => void,
): Promise<() => void> {
  const context = new AudioContext({ sampleRate: 16_000 });
  let stopped = false;
  try {
    await context.audioWorklet.addModule(workletUrl);
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(context, "misty-agent-hearing", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    // Nothing is played: a silent gain keeps the node pulled.
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(node).connect(silent).connect(context.destination);
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!stopped) onPcm(base64Of(event.data));
    };
    await context.resume();
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
  return () => {
    if (stopped) return;
    stopped = true;
    void context.close().catch(() => undefined);
  };
}

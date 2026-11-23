import { Channel, invoke } from "@tauri-apps/api/core";
import { AudioPresets, Track, type LocalTrackPublication, type Room } from "livekit-client";
import workletUrl from "./screen_audio_worklet.ts?worker&url";

const MOST_RESTARTS = 5;

export async function shareScreenAudio(
  room: Room,
  onStopped: () => void,
): Promise<() => Promise<void>> {
  const context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
  const audio = new Channel<ArrayBuffer>();
  const ended = new Channel<string>();
  let node: AudioWorkletNode | undefined;
  let track: MediaStreamTrack | undefined;
  let publication: LocalTrackPublication | undefined;
  let stopped = false;
  let restarts = 0;

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    audio.onmessage = () => undefined;
    await invoke("voice_share_audio_stop").catch(() => undefined);
    if (publication?.track)
      await room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
    track?.stop();
    node?.disconnect();
    await context.close().catch(() => undefined);
  };
  const start = () => invoke("voice_share_audio_start", { audio, ended });
  ended.onmessage = () => {
    if (stopped) return;
    restarts += 1;
    const giveUp = () => void stop().finally(onStopped);
    if (restarts > MOST_RESTARTS) return giveUp();
    start().catch(giveUp);
  };

  try {
    await context.audioWorklet.addModule(workletUrl);
    node = new AudioWorkletNode(context, "misty-screen-audio", {
      numberOfInputs: 0,
      outputChannelCount: [2],
    });
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 2;
    node.connect(destination);
    const port = node.port;
    audio.onmessage = (chunk) => port.postMessage(chunk, [chunk]);
    await start();
    await context.resume();
    [track] = destination.stream.getAudioTracks();
    publication = await room.localParticipant.publishTrack(track, {
      source: Track.Source.ScreenShareAudio,
      audioPreset: AudioPresets.musicHighQualityStereo,
      forceStereo: true,
      dtx: false,
      red: false,
    });
    if (stopped) {
      await room.localParticipant.unpublishTrack(publication.track ?? track).catch(() => undefined);
      throw new Error("The screen's sound stopped.");
    }
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}

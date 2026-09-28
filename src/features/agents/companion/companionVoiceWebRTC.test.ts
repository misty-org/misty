import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompanionVoiceWebRTC } from "./companionVoiceWebRTC";

class FixturePeer {
  static latest: FixturePeer;
  connectionState = "new";
  localDescription?: { sdp: string };
  onconnectionstatechange?: () => void;
  ontrack?: (event: object) => void;
  remoteTrack = { stop: vi.fn() };
  sender = { replaceTrack: vi.fn(async () => {}) };
  addTrack = vi.fn(() => this.sender);
  createDataChannel = vi.fn();
  createOffer = async () => ({ type: "offer", sdp: "v=0 offer" });
  setLocalDescription = async (value: { sdp: string }) => {
    this.localDescription = value;
  };
  setRemoteDescription = vi.fn(async () => {});
  getReceivers = () => [{ track: this.remoteTrack }];
  getStats = async () => new Map();
  close = vi.fn();
  constructor() {
    FixturePeer.latest = this;
  }
}
class FixtureAudioContext {
  static latest: FixtureAudioContext;
  state = "running";
  currentTime = 0;
  track = { stop: vi.fn() };
  destination = { stream: { getAudioTracks: () => [this.track], getTracks: () => [this.track] } };
  source = {
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: undefined as undefined | (() => void),
  };
  samples?: Float32Array;
  constructor() {
    FixtureAudioContext.latest = this;
  }
  createMediaStreamDestination = () => this.destination;
  resume = async () => {};
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createBuffer(_channels: number, count: number, rate: number) {
    this.samples = new Float32Array(count);
    return { duration: count / rate, getChannelData: () => this.samples };
  }
  createBufferSource = () => this.source;
}
class FixtureSpeaker {
  static latest: FixtureSpeaker;
  srcObject: unknown;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor() {
    FixtureSpeaker.latest = this;
  }
}
let voice: CompanionVoiceWebRTC;
beforeEach(() => {
  vi.stubGlobal("RTCPeerConnection", FixturePeer);
  vi.stubGlobal("AudioContext", FixtureAudioContext);
  vi.stubGlobal("Audio", FixtureSpeaker);
});
afterEach(() => {
  voice?.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("routes signed native PCM into an audio sender and attaches remote media to the speaker", async () => {
  voice = new CompanionVoiceWebRTC(vi.fn());
  expect(await voice.offer()).toBe("v=0 offer");
  const peer = FixturePeer.latest,
    context = FixtureAudioContext.latest;
  expect(peer.addTrack).toHaveBeenCalledWith(context.track, context.destination.stream);
  const connected = voice.answer("v=0 answer");
  peer.connectionState = "connected";
  peer.onconnectionstatechange?.();
  await connected;
  voice.append(btoa(String.fromCharCode(0, 0, 255, 127, 0, 128, 255, 255)));
  expect(Array.from(context.samples!)).toEqual([0, 32767 / 32768, -1, -1 / 32768]);
  expect(context.source.connect).toHaveBeenCalledWith(context.destination);
  const stream = { fixtureRemoteAudio: true };
  peer.ontrack?.({ streams: [stream], track: peer.remoteTrack });
  expect(FixtureSpeaker.latest.srcObject).toBe(stream);
  expect(FixtureSpeaker.latest.play).toHaveBeenCalledOnce();
  context.currentTime = 2;
  await voice.finishInput();
  expect(peer.sender.replaceTrack).toHaveBeenCalledWith(null);
  expect(peer.close).not.toHaveBeenCalled();
  voice.close();
  expect(context.track.stop).toHaveBeenCalledOnce();
  expect(peer.remoteTrack.stop).toHaveBeenCalledOnce();
  expect(FixtureSpeaker.latest.pause).toHaveBeenCalledOnce();
});

it("cancels queued microphone samples immediately on interruption", async () => {
  voice = new CompanionVoiceWebRTC(vi.fn());
  await voice.offer();
  voice.append("AAAAAA==");
  const drain = voice.finishInput();
  voice.close();
  await expect(drain).rejects.toThrow("cancelled");
  expect(FixtureAudioContext.latest.source.stop).toHaveBeenCalledOnce();
  expect(FixturePeer.latest.sender.replaceTrack).not.toHaveBeenCalled();
});

it("reports a bounded ICE failure for the owner to select the relay fallback", async () => {
  vi.useFakeTimers();
  const error = vi.fn();
  voice = new CompanionVoiceWebRTC(error);
  await voice.offer();
  const connected = voice.answer("v=0 answer");
  const rejected = expect(connected).rejects.toThrow("could not connect");
  await vi.advanceTimersByTimeAsync(12_000);
  await rejected;
  expect(error).toHaveBeenCalledOnce();
});

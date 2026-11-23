import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionQuality,
  LocalAudioTrack,
  createAudioAnalyser,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
  isE2EESupported,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { notify } from "@misty/ui";
import { directApi } from "../api";
import { useCallStore, type ActiveCall } from "./call_store";
import { playCallSound } from "./call_sounds";
import { CallKeyProvider, startKeyRotation } from "./key_rotation";
import { shareScreenAudio } from "./screen_audio";
import {
  canPickSpeaker,
  rememberSpeaker,
  savedCallAudio,
  savedCallDevice,
  savedNoiseReduction,
  type CallDeviceKind,
} from "./call_devices";
import { CallSignals, type CallCaption, type CallReaction, type SignalsView } from "./call_signals";
import { applyNoiseReduction } from "./noise_reduction";
import { captionVoice } from "./call_captions";

export interface CallPerson {
  id: string;
  name: string;
  self: boolean;
  speaking: boolean;
  micOn: boolean;
  camera?: Track;
  screen?: Track;
  sharing: boolean;
  watching: boolean;
  weak: boolean;
  hand: boolean;
  handPlace?: number;
  deafened: boolean;
  reaction?: CallReaction;
  volume: number;
  audio: Track[];
}

export interface CallControls {
  room: Room | null;
  people: CallPerson[];
  micOn: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  reconnecting: boolean;
  deafened: boolean;
  handUp: boolean;
  noiseReduction: boolean;
  silentMic: boolean;
  captionsOn: boolean;
  captions: readonly CallCaption[];
  offerLowerHand: boolean;
  toggleDeafen(): void;
  toggleHand(): void;
  toggleCaptions(): void;
  lowerHandOf(personId: string): void;
  moderate(personId: string, action: "mute" | "remove"): void;
  react(emoji: string): void;
  setNoiseReduction(on: boolean): void;
  setVolume(personId: string, volume: number): void;
  activeDevice(kind: CallDeviceKind): string;
  pickDevice(kind: CallDeviceKind, deviceId: string): void;
  toggleMic(): void;
  toggleCamera(): void;
  toggleScreen(): void;
  watch(personId: string, on: boolean): void;
  leave(): void;
}

const screenSources: Track.Source[] = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio];

function trackOf(participant: Participant, source: Track.Source, self: boolean) {
  const publication = participant.getTrackPublication(source);
  if (!publication?.track || publication.isMuted) return undefined;
  return self || publication.isEncrypted ? publication.track : undefined;
}

export const AGENT_VOICE_PREFIX = "agent-voice:";

function agentVoices(participant: Participant): Track[] {
  return [...participant.trackPublications.values()]
    .filter(
      (publication) =>
        publication.kind === Track.Kind.Audio &&
        publication.trackName.startsWith(AGENT_VOICE_PREFIX) &&
        !publication.isMuted &&
        publication.isEncrypted,
    )
    .map((publication) => publication.track)
    .filter((track): track is Track => Boolean(track));
}

const noSignals: SignalsView = {
  hands: new Map(),
  deaf: new Set(),
  reactions: new Map(),
  captionsWanted: new Set(),
  captions: [],
};

function handPlaces(hands: ReadonlyMap<string, number>): Map<string, number> {
  const order = [...hands].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return new Map(order.map(([identity], index) => [identity, index + 1]));
}

function personOf(
  participant: Participant,
  self: boolean,
  watching: boolean,
  signals: SignalsView,
  volume: number,
  places: ReadonlyMap<string, number>,
): CallPerson {
  const shared = participant.getTrackPublication(Track.Source.ScreenShare);
  const audio = self
    ? []
    : [
        ...[Track.Source.Microphone, Track.Source.ScreenShareAudio]
          .map((source) => trackOf(participant, source, false))
          .filter((track): track is Track => Boolean(track)),
        ...agentVoices(participant),
      ];
  return {
    id: participant.identity,
    name: participant.name || participant.identity,
    self,
    speaking: participant.isSpeaking,
    micOn: participant.isMicrophoneEnabled,
    camera: trackOf(participant, Track.Source.Camera, self),
    screen: trackOf(participant, Track.Source.ScreenShare, self),
    sharing: Boolean(shared && !shared.isMuted),
    watching: self || watching,
    weak:
      participant.connectionQuality === ConnectionQuality.Poor ||
      participant.connectionQuality === ConnectionQuality.Lost,
    hand: signals.hands.has(participant.identity),
    handPlace: places.size > 1 ? places.get(participant.identity) : undefined,
    deafened: signals.deaf.has(participant.identity),
    reaction: signals.reactions.get(participant.identity),
    volume,
    audio,
  };
}

function subscribe(publication: RemoteTrackPublication, watched: boolean) {
  const screen = screenSources.includes(publication.source);
  publication.setSubscribed(!screen || watched);
}

const ALONE_WARNING_MS = 4 * 60_000;
const RECONNECT_GRACE_MS = 4000;
const RECOVER_AFTER_MS = 10_000;
const LOWER_HAND_AFTER_MS = 3000;

function receiveQuality(room: Room, quality: VideoQuality) {
  for (const person of room.remoteParticipants.values())
    for (const publication of person.trackPublications.values())
      if (publication.kind === Track.Kind.Video) publication.setVideoQuality(quality);
}

function encryptionOn(room: Room): Promise<boolean> {
  if (room.isE2EEEnabled) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (on: boolean) => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantEncryptionStatusChanged, changed);
      resolve(on);
    };
    const changed = (enabled: boolean, participant?: Participant) => {
      if (enabled && participant?.identity === room.localParticipant.identity) done(true);
    };
    const timer = setTimeout(() => done(room.isE2EEEnabled), 10_000);
    room.on(RoomEvent.ParticipantEncryptionStatusChanged, changed);
  });
}

export function useLiveKitCall(call: ActiveCall, maxPeople: number): CallControls {
  const [room, setRoom] = useState<Room | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [signals, setSignals] = useState<CallSignals | null>(null);
  const [volumes, setVolumes] = useState<ReadonlyMap<string, number>>(new Map());
  const [silentMic, setSilentMic] = useState(false);
  const [offerLowerHand, setOfferLowerHand] = useState(false);
  const noiseReduction = savedNoiseReduction((state) => state.value);
  const micBeforeDeafen = useRef(false);
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((n) => n + 1), []);
  const { room: roomName, key, video } = call;
  const startMuted = Boolean(call.muted);
  const watching = useRef(new Set<string>());
  const screenAudio = useRef<Promise<(() => Promise<void>) | undefined> | undefined>(undefined);
  const stopScreenAudio = useCallback(async () => {
    const stopping = screenAudio.current;
    screenAudio.current = undefined;
    const stop = await stopping;
    await stop?.();
  }, []);

  useEffect(() => {
    if (!isE2EESupported()) {
      useCallStore.getState().leave();
      return;
    }
    const watched = watching.current;
    let cancelled = false;
    const worker = new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), {
      type: "module",
    });
    const keyProvider = new CallKeyProvider();
    let stopRotation: (() => void) | undefined;
    let live = false;
    let aloneTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let recoverTimer: ReturnType<typeof setTimeout> | undefined;
    let steppedDown = false;
    const qualityChanged = (quality: ConnectionQuality, participant: Participant) => {
      bump();
      if (participant.identity !== room.localParticipant.identity) return;
      const poor = quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost;
      if (poor) {
        clearTimeout(recoverTimer);
        recoverTimer = undefined;
        if (!steppedDown) {
          steppedDown = true;
          receiveQuality(room, VideoQuality.LOW);
        }
      } else if (steppedDown && !recoverTimer) {
        recoverTimer = setTimeout(() => {
          recoverTimer = undefined;
          steppedDown = false;
          receiveQuality(room, VideoQuality.HIGH);
        }, RECOVER_AFTER_MS);
      }
    };
    const watchAlone = () => {
      const alone = live && room.remoteParticipants.size === 0;
      if (!alone) {
        clearTimeout(aloneTimer);
        aloneTimer = undefined;
      } else if (!aloneTimer) {
        aloneTimer = setTimeout(() => {
          if (!cancelled)
            notify({ message: "You’re the only one here. The call ends in a minute." });
        }, ALONE_WARNING_MS);
      }
    };
    const chosen = (kind: CallDeviceKind) => savedCallDevice[kind].getState().value || undefined;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      e2ee: { keyProvider, worker },
      audioCaptureDefaults: {
        deviceId: chosen("audioinput"),
        noiseSuppression: savedNoiseReduction.getState().value,
        echoCancellation: true,
        autoGainControl: true,
      },
      videoCaptureDefaults: { deviceId: chosen("videoinput") },
      audioOutput: { deviceId: chosen("audiooutput") },
    });
    setRoom(room);
    const signalling = new CallSignals(room, key, {
      changed: bump,
      lowered: () => notify({ message: "A moderator lowered your hand." }),
      muted: () => {
        savedCallAudio.getState().set((current) => ({ ...current, muted: true }));
        notify({ message: "A moderator muted you." });
      },
    });
    setSignals(signalling);
    const fail = (message: string) => {
      if (cancelled) return;
      notify({ message, tone: "error" });
      useCallStore.getState().leave();
    };
    const onJoined = () => {
      useCallStore.getState().setAnswered();
      if (live) playCallSound("personJoined");
      watchAlone();
      bump();
    };
    const onLeft = () => {
      if (live) playCallSound("personLeft");
      watchAlone();
      bump();
    };
    room
      .on(RoomEvent.ParticipantConnected, onJoined)
      .on(RoomEvent.ParticipantDisconnected, onLeft)
      .on(
        RoomEvent.TrackPublished,
        (publication: RemoteTrackPublication, person: RemoteParticipant) => {
          subscribe(publication, watching.current.has(person.identity));
          if (steppedDown && publication.kind === Track.Kind.Video)
            publication.setVideoQuality(VideoQuality.LOW);
          bump();
        },
      )
      .on(
        RoomEvent.TrackUnpublished,
        (publication: RemoteTrackPublication, person: RemoteParticipant) => {
          if (publication.source === Track.Source.ScreenShare)
            watching.current.delete(person.identity);
          bump();
        },
      )
      .on(RoomEvent.TrackSubscribed, bump)
      .on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, (publication: LocalTrackPublication) => {
        const track = publication.track;
        if (publication.source === Track.Source.Microphone && track instanceof LocalAudioTrack)
          void applyNoiseReduction(track, savedNoiseReduction.getState().value).catch(() =>
            notify({ message: "Noise reduction couldn’t start.", tone: "error" }),
          );
        bump();
      })
      .on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
        if (publication.source === Track.Source.ScreenShare) void stopScreenAudio();
        bump();
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        useCallStore.getState().setSpeaking(speakers.map((speaker) => speaker.identity).sort());
        bump();
      })
      .on(RoomEvent.ConnectionQualityChanged, qualityChanged)
      .on(RoomEvent.Reconnecting, () => {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (!cancelled) setReconnecting(true);
        }, RECONNECT_GRACE_MS);
      })
      .on(RoomEvent.Reconnected, () => {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        setReconnecting(false);
      })
      .on(RoomEvent.EncryptionError, () => fail("The call’s encryption failed, so it ended."))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (cancelled) return;
        if (reason === DisconnectReason.ROOM_DELETED) {
          notify({ message: "The call ended because no one else was in it." });
        } else if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
          notify({ message: "A moderator removed you from the call." });
        }
        useCallStore.getState().leave();
      });

    void (async () => {
      try {
        await keyProvider.setKeyAt(key, 0);
        await room.setE2EEEnabled(true);
        const { token, url } = await directApi.callToken(roomName);
        if (cancelled) return;
        await room.connect(url, token, { autoSubscribe: false });
        if (cancelled) return;
        for (const person of room.remoteParticipants.values())
          for (const publication of person.trackPublications.values())
            subscribe(publication, watching.current.has(person.identity));
        if (!(await encryptionOn(room)) || cancelled) {
          fail("The call couldn’t be encrypted, so it ended.");
          return;
        }
        if (room.remoteParticipants.size + 1 > maxPeople) {
          fail(`A call holds at most ${maxPeople} people.`);
          return;
        }
        const stop = await startKeyRotation(room, keyProvider, key);
        if (cancelled) return stop();
        stopRotation = stop;
        if (room.remoteParticipants.size) useCallStore.getState().setAnswered();
        useCallStore.getState().setLive();
        live = true;
        playCallSound("join");
        watchAlone();
        const remembered = savedCallAudio.getState().value;
        const quiet = startMuted || remembered.muted;
        if (!quiet && !remembered.deafened) await room.localParticipant.setMicrophoneEnabled(true);
        if (remembered.deafened) {
          micBeforeDeafen.current = !quiet;
          signalling.setDeaf(true);
        }
        if (video) await room.localParticipant.setCameraEnabled(true);
        bump();
      } catch (error) {
        console.error("The call couldn't connect:", error);
        fail("The call couldn’t connect.");
      }
    })();

    return () => {
      cancelled = true;
      setReconnecting(false);
      signalling.dispose();
      setSignals(null);
      setVolumes(new Map());
      if (live) playCallSound("leave");
      watched.clear();
      clearTimeout(aloneTimer);
      clearTimeout(reconnectTimer);
      clearTimeout(recoverTimer);
      stopRotation?.();
      void stopScreenAudio();
      setRoom(null);
      void room.disconnect().finally(() => worker.terminate());
    };
  }, [roomName, key, video, startMuted, maxPeople, bump, stopScreenAudio]);

  const view = signals?.current() ?? noSignals;
  const self = room?.localParticipant.identity ?? "";
  const deafened = view.deaf.has(self);
  const places = handPlaces(view.hands);
  const handUp = view.hands.has(self);
  const selfSpeaking = Boolean(room?.localParticipant.isSpeaking);
  const captionsNeeded = view.captionsWanted.size > 0;
  const micTrack = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
  const micLive = Boolean(room?.localParticipant.isMicrophoneEnabled);
  useEffect(() => {
    setSilentMic(false);
    if (!(micTrack instanceof LocalAudioTrack) || !micLive) return;
    let analyser: ReturnType<typeof createAudioAnalyser>;
    try {
      analyser = createAudioAnalyser(micTrack, { fftSize: 256, smoothingTimeConstant: 0.7 });
    } catch {
      return;
    }
    let quiet = 0;
    // An analyser offers no event for level changes, so the mic's level is read once a second.
    const timer = setInterval(() => {
      quiet = analyser.calculateVolume() < 0.0001 ? quiet + 1 : 0;
      setSilentMic(quiet >= 6);
    }, 1000);
    return () => {
      clearInterval(timer);
      void analyser.cleanup();
    };
  }, [micTrack, micLive]);
  useEffect(() => {
    if (!handUp) setOfferLowerHand(false);
    if (!handUp || !selfSpeaking) return;
    const timer = setTimeout(() => setOfferLowerHand(true), LOWER_HAND_AFTER_MS);
    return () => clearTimeout(timer);
  }, [handUp, selfSpeaking]);
  const micMedia = micLive ? micTrack?.mediaStreamTrack : undefined;
  useEffect(() => {
    if (!captionsNeeded || !micMedia || !signals) return;
    return captionVoice(micMedia, (text) => signals.say(text));
  }, [captionsNeeded, micMedia, signals]);
  const people: CallPerson[] = room
    ? [
        personOf(room.localParticipant, true, true, view, 1, places),
        ...[...room.remoteParticipants.values()].map((person) =>
          personOf(
            person,
            false,
            watching.current.has(person.identity),
            view,
            volumes.get(person.identity) ?? 1,
            places,
          ),
        ),
      ]
    : [];
  const local = room?.localParticipant;
  const run = (work: (room: Room) => Promise<unknown>, failed: string) => {
    if (!room) return;
    void work(room)
      .then(bump)
      .catch(() => notify({ message: failed, tone: "error" }));
  };
  const micOn = Boolean(local?.isMicrophoneEnabled);
  useEffect(() => {
    if (!room) return;
    useCallStore.setState({
      mic: {
        on: micOn,
        set: (on) => {
          if (room.localParticipant.isMicrophoneEnabled === on) return;
          void room.localParticipant
            .setMicrophoneEnabled(on)
            .then(() => {
              playCallSound(on ? "unmute" : "mute");
              bump();
            })
            .catch(() =>
              notify({ message: "The microphone couldn’t be turned on.", tone: "error" }),
            );
        },
      },
    });
  }, [room, micOn, bump]);
  const controls: CallControls = {
    room,
    people,
    micOn,
    cameraOn: Boolean(local?.isCameraEnabled),
    screenOn: Boolean(local?.isScreenShareEnabled),
    reconnecting,
    deafened,
    handUp,
    noiseReduction,
    silentMic,
    captionsOn: view.captionsWanted.has(self),
    captions: view.captions,
    offerLowerHand: offerLowerHand && handUp,
    toggleDeafen: () =>
      run(async (room) => {
        const on = !deafened;
        if (on) {
          micBeforeDeafen.current = room.localParticipant.isMicrophoneEnabled;
          if (micBeforeDeafen.current) await room.localParticipant.setMicrophoneEnabled(false);
        } else if (micBeforeDeafen.current) {
          await room.localParticipant.setMicrophoneEnabled(true);
        }
        signals?.setDeaf(on);
        savedCallAudio.getState().set((current) => ({ ...current, deafened: on }));
        playCallSound(on ? "mute" : "unmute");
      }, "Deafening didn’t work."),
    toggleHand: () => signals?.setHand(!handUp),
    toggleCaptions: () => signals?.setCaptions(!view.captionsWanted.has(self)),
    lowerHandOf: (personId) => signals?.lowerHandOf(personId),
    moderate: (personId, action) => {
      void directApi
        .moderateCall(roomName, action, personId)
        .then(() => {
          if (action === "mute") signals?.tellMuted(personId);
        })
        .catch(() =>
          notify({
            message:
              action === "mute"
                ? "They couldn’t be muted."
                : "They couldn’t be removed from the call.",
            tone: "error",
          }),
        );
    },
    react: (emoji) => signals?.react(emoji),
    setNoiseReduction: (on) => {
      savedNoiseReduction.getState().set(on);
      run(async (room) => {
        const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
        if (!(track instanceof LocalAudioTrack)) return;
        await track.restartTrack({
          deviceId: savedCallDevice.audioinput.getState().value || undefined,
          noiseSuppression: on,
          echoCancellation: true,
          autoGainControl: true,
        });
        await applyNoiseReduction(track, on);
      }, "Noise reduction couldn’t be changed.");
    },
    setVolume: (personId, volume) => {
      const person = room?.remoteParticipants.get(personId);
      if (!person) return;
      person.setVolume(volume);
      setVolumes((current) => new Map(current).set(personId, volume));
    },
    activeDevice: (kind) => room?.getActiveDevice(kind) || savedCallDevice[kind].getState().value,
    pickDevice: (kind, deviceId) => {
      if (kind === "audiooutput") {
        void rememberSpeaker(deviceId);
        if (!canPickSpeaker()) return;
      } else savedCallDevice[kind].getState().set(deviceId);
      run(
        (room) => room.switchActiveDevice(kind, deviceId),
        kind === "videoinput"
          ? "That camera couldn’t be used."
          : kind === "audioinput"
            ? "That microphone couldn’t be used."
            : "That speaker couldn’t be used.",
      );
    },
    toggleMic: () =>
      run(async (room) => {
        const on = !room.localParticipant.isMicrophoneEnabled;
        await room.localParticipant.setMicrophoneEnabled(on);
        if (on && deafened) signals?.setDeaf(false);
        savedCallAudio
          .getState()
          .set((current) => ({ muted: !on, deafened: on ? false : current.deafened }));
        playCallSound(on ? "unmute" : "mute");
      }, "The microphone couldn’t be turned on."),
    toggleCamera: () =>
      run(
        (room) => room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled),
        "The camera couldn’t be turned on.",
      ),
    toggleScreen: () =>
      run(async (room) => {
        if (room.localParticipant.isScreenShareEnabled) {
          await stopScreenAudio();
          await room.localParticipant.setScreenShareEnabled(false);
          return;
        }
        await room.localParticipant.setScreenShareEnabled(true, { audio: false });
        const sending = shareScreenAudio(room, () => {
          if (screenAudio.current === sending) screenAudio.current = undefined;
          notify({ message: "Your screen’s sound stopped.", tone: "error" });
          bump();
        }).catch((error: unknown) => {
          console.error("The screen's sound couldn't be shared:", error);
          if (screenAudio.current === sending) screenAudio.current = undefined;
          notify({ message: "Your screen’s sound couldn’t be shared.", tone: "error" });
          return undefined;
        });
        screenAudio.current = sending;
        await sending;
      }, "The screen couldn’t be shared."),
    watch: (personId, on) => {
      const person = room?.remoteParticipants.get(personId);
      if (!person) return;
      if (on) watching.current.add(personId);
      else watching.current.delete(personId);
      for (const source of screenSources) person.getTrackPublication(source)?.setSubscribed(on);
      bump();
    },
    leave: () => useCallStore.getState().leave(),
  };
  const latest = useRef(controls);
  latest.current = controls;
  useEffect(() => {
    if (!room) return;
    useCallStore.setState({
      audio: {
        micOn,
        deafened,
        noiseReduction,
        toggleMic: () => latest.current.toggleMic(),
        toggleDeafen: () => latest.current.toggleDeafen(),
        setNoiseReduction: (on) => latest.current.setNoiseReduction(on),
        activeDevice: (kind) => latest.current.activeDevice(kind),
        pickDevice: (kind, deviceId) => latest.current.pickDevice(kind, deviceId),
      },
    });
  }, [room, micOn, deafened, noiseReduction]);
  return controls;
}

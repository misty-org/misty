import { useCallback, useEffect, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  isE2EESupported,
  type Participant,
} from "livekit-client";
import { notify } from "@misty/ui";
import { directApi } from "../api";
import { useCallStore, type ActiveCall } from "./callStore";
import { CallKeyProvider, startKeyRotation } from "./keyRotation";

/** One person in the call, as the panel draws them. */
export interface CallPerson {
  id: string;
  /** Their user id (the token's identity) and the name the token gave them. */
  name: string;
  self: boolean;
  speaking: boolean;
  micOn: boolean;
  /** The screen they share, else their camera, when either is on. */
  video?: Track;
  /** Their voice and their screen's sound; never this computer's own. */
  audio: Track[];
}

export interface CallControls {
  /** The connected room, for what rides on the call's data channel (an agent's answers). */
  room: Room | null;
  people: CallPerson[];
  micOn: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  toggleMic(): void;
  toggleCamera(): void;
  toggleScreen(): void;
  leave(): void;
}

/** Someone's track, only when it is end-to-end encrypted: an unencrypted one is never played. */
function trackOf(participant: Participant, source: Track.Source, self: boolean) {
  const publication = participant.getTrackPublication(source);
  if (!publication?.track || publication.isMuted) return undefined;
  return self || publication.isEncrypted ? publication.track : undefined;
}

function personOf(participant: Participant, self: boolean): CallPerson {
  const shown =
    trackOf(participant, Track.Source.ScreenShare, self) ??
    trackOf(participant, Track.Source.Camera, self);
  const audio = self
    ? []
    : [Track.Source.Microphone, Track.Source.ScreenShareAudio]
        .map((source) => trackOf(participant, source, false))
        .filter((track): track is Track => Boolean(track));
  return {
    id: participant.identity,
    name: participant.name || participant.identity,
    self,
    speaking: participant.isSpeaking,
    micOn: participant.isMicrophoneEnabled,
    video: shown,
    audio,
  };
}

/** Waits (up to 10 seconds) for LiveKit to say this computer's frames are encrypted. */
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

/**
 * Joins a call's room (a DM's or a Space voice channel's), always end-to-end encrypted: LiveKit's
 * encryption worker encrypts every frame with the call's key (which never passes through
 * misty-server unsealed) before it leaves this computer, and the key changes whenever someone
 * leaves. A call that can't turn encryption on doesn't connect. Leaving disconnects the room.
 */
export function useLiveKitCall(call: ActiveCall, maxPeople: number): CallControls {
  const [room, setRoom] = useState<Room | null>(null);
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((n) => n + 1), []);
  const { room: roomName, key, video } = call;

  useEffect(() => {
    if (!isE2EESupported()) {
      useCallStore.getState().leave();
      return;
    }
    let cancelled = false;
    const worker = new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), {
      type: "module",
    });
    const keyProvider = new CallKeyProvider();
    let stopRotation: (() => void) | undefined;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      e2ee: { keyProvider, worker },
    });
    setRoom(room);
    const fail = (message: string) => {
      if (cancelled) return;
      notify({ message, tone: "error" });
      useCallStore.getState().leave();
    };
    const onJoined = () => {
      useCallStore.getState().setAnswered();
      bump();
    };
    room
      .on(RoomEvent.ParticipantConnected, onJoined)
      .on(RoomEvent.ParticipantDisconnected, bump)
      .on(RoomEvent.TrackSubscribed, bump)
      .on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        useCallStore.getState().setSpeaking(speakers.map((speaker) => speaker.identity).sort());
        bump();
      })
      .on(RoomEvent.EncryptionError, () => fail("The call’s encryption failed, so it ended."))
      .on(RoomEvent.Disconnected, () => {
        if (!cancelled) useCallStore.getState().leave();
      });

    void (async () => {
      try {
        await keyProvider.setKeyAt(key, 0);
        await room.setE2EEEnabled(true);
        const { token, url } = await directApi.callToken(roomName);
        if (cancelled) return;
        await room.connect(url, token);
        if (cancelled) return;
        // Nothing is sent until this computer's encryption is on.
        if (!(await encryptionOn(room)) || cancelled) {
          fail("The call couldn’t be encrypted, so it ended.");
          return;
        }
        if (room.remoteParticipants.size + 1 > maxPeople) {
          fail(`A call holds at most ${maxPeople} people.`);
          return;
        }
        // A new key whenever someone leaves (keyRotation.ts).
        const stop = await startKeyRotation(room, keyProvider, key);
        if (cancelled) return stop();
        stopRotation = stop;
        if (room.remoteParticipants.size) useCallStore.getState().setAnswered();
        useCallStore.getState().setLive();
        await room.localParticipant.setMicrophoneEnabled(true);
        if (video) await room.localParticipant.setCameraEnabled(true);
        bump();
      } catch (error) {
        // The notice stays one line; the step that failed is in the web inspector's console.
        console.error("The call couldn't connect:", error);
        fail("The call couldn’t connect.");
      }
    })();

    return () => {
      cancelled = true;
      stopRotation?.();
      setRoom(null);
      void room.disconnect().finally(() => worker.terminate());
    };
  }, [roomName, key, video, maxPeople, bump]);

  const people: CallPerson[] = room
    ? [
        personOf(room.localParticipant, true),
        ...[...room.remoteParticipants.values()].map((person) => personOf(person, false)),
      ]
    : [];
  const local = room?.localParticipant;
  const run = (work: (room: Room) => Promise<unknown>, failed: string) => {
    if (!room) return;
    void work(room)
      .then(bump)
      .catch(() => notify({ message: failed, tone: "error" }));
  };
  // The microphone, for the store too: misty-sdk's calls API mutes from outside the panel.
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
            .then(bump)
            .catch(() => notify({ message: "The microphone couldn’t be turned on.", tone: "error" }));
        },
      },
    });
  }, [room, micOn, bump]);
  return {
    room,
    people,
    micOn,
    cameraOn: Boolean(local?.isCameraEnabled),
    screenOn: Boolean(local?.isScreenShareEnabled),
    toggleMic: () =>
      run(
        (room) =>
          room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled),
        "The microphone couldn’t be turned on.",
      ),
    toggleCamera: () =>
      run(
        (room) => room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled),
        "The camera couldn’t be turned on.",
      ),
    toggleScreen: () =>
      run(
        (room) =>
          room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled, {
            audio: true,
          }),
        "The screen couldn’t be shared.",
      ),
    leave: () => useCallStore.getState().leave(),
  };
}

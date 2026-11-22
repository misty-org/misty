import { useCallback, useEffect, useRef, useState } from "react";
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  isE2EESupported,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { notify } from "@misty/ui";
import { directApi } from "../api";
import { useCallStore, type ActiveCall } from "./callStore";
import { playCallSound } from "./callSounds";
import { CallKeyProvider, startKeyRotation } from "./keyRotation";
import { shareScreenAudio } from "./screenAudio";

/** One person in the call, as the panel draws them. */
export interface CallPerson {
  id: string;
  /** Their user id (the token's identity) and the name the token gave them. */
  name: string;
  self: boolean;
  speaking: boolean;
  micOn: boolean;
  /** Their camera, while it is on. */
  camera?: Track;
  /**
   * The screen they share, once this computer watches it (always for this computer's own). A
   * screen nobody watches is never received, so it costs nothing.
   */
  screen?: Track;
  /** They are sharing their screen, watched or not. */
  sharing: boolean;
  /** This computer is watching their screen. */
  watching: boolean;
  /** Their voice, their screen's sound and their agents' voices; never this computer's own. */
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
  /** Starts or stops receiving someone's shared screen (and its sound). */
  watch(personId: string, on: boolean): void;
  leave(): void;
}

/** A screen and its sound: received only while this computer watches it. */
const screenSources: Track.Source[] = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio];

/** Someone's track, only when it is end-to-end encrypted: an unencrypted one is never played. */
function trackOf(participant: Participant, source: Track.Source, self: boolean) {
  const publication = participant.getTrackPublication(source);
  if (!publication?.track || publication.isMuted) return undefined;
  return self || publication.isEncrypted ? publication.track : undefined;
}

/** The track name an agent's voice is published under, by its person (`callAgents.ts`). */
export const AGENT_VOICE_PREFIX = "agent-voice:";

/** Someone's agents' voices, each its own encrypted audio track. */
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

function personOf(participant: Participant, self: boolean, watching: boolean): CallPerson {
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
    audio,
  };
}

/** Receives a track that just appeared: a voice or a camera always, a screen only when watched. */
function subscribe(publication: RemoteTrackPublication, watched: boolean) {
  const screen = screenSources.includes(publication.source);
  publication.setSubscribed(!screen || watched);
}

/**
 * misty-server ends any call left with one person in it for five minutes (`livekit_rooms.go`), with
 * no exceptions; the person hears about it a minute before.
 */
const ALONE_WARNING_MS = 4 * 60_000;

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
  // Whose screens this computer watches, by their identity.
  const watching = useRef(new Set<string>());
  // Stops the sound of this computer's shared screen, while it is sent.
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
    // While the call is live and nobody else is in it, a warning waits; anyone joining calls it off.
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
          bump();
        },
      )
      .on(
        RoomEvent.TrackUnpublished,
        (publication: RemoteTrackPublication, person: RemoteParticipant) => {
          // A screen that stops being shared is no longer watched; sharing again asks again.
          if (publication.source === Track.Source.ScreenShare)
            watching.current.delete(person.identity);
          bump();
        },
      )
      .on(RoomEvent.TrackSubscribed, bump)
      .on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
        // However the screen stops being shared (the button, the system's own menu), its sound
        // stops with it.
        if (publication.source === Track.Source.ScreenShare) void stopScreenAudio();
        bump();
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        useCallStore.getState().setSpeaking(speakers.map((speaker) => speaker.identity).sort());
        bump();
      })
      .on(RoomEvent.EncryptionError, () => fail("The call’s encryption failed, so it ended."))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (cancelled) return;
        if (reason === DisconnectReason.ROOM_DELETED) {
          notify({ message: "The call ended because no one else was in it." });
        }
        useCallStore.getState().leave();
      });

    void (async () => {
      try {
        await keyProvider.setKeyAt(key, 0);
        await room.setE2EEEnabled(true);
        const { token, url } = await directApi.callToken(roomName);
        if (cancelled) return;
        // Nothing is received until it is asked for: voices and cameras at once (below), a screen only
        // once someone chooses to watch it.
        await room.connect(url, token, { autoSubscribe: false });
        if (cancelled) return;
        for (const person of room.remoteParticipants.values())
          for (const publication of person.trackPublications.values())
            subscribe(publication, watching.current.has(person.identity));
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
        live = true;
        playCallSound("join");
        watchAlone();
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
      if (live) playCallSound("leave");
      watched.clear();
      clearTimeout(aloneTimer);
      stopRotation?.();
      void stopScreenAudio();
      setRoom(null);
      void room.disconnect().finally(() => worker.terminate());
    };
  }, [roomName, key, video, maxPeople, bump, stopScreenAudio]);

  const people: CallPerson[] = room
    ? [
        personOf(room.localParticipant, true, true),
        ...[...room.remoteParticipants.values()].map((person) =>
          personOf(person, false, watching.current.has(person.identity)),
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
  return {
    room,
    people,
    micOn,
    cameraOn: Boolean(local?.isCameraEnabled),
    screenOn: Boolean(local?.isScreenShareEnabled),
    toggleMic: () =>
      run(async (room) => {
        const on = !room.localParticipant.isMicrophoneEnabled;
        await room.localParticipant.setMicrophoneEnabled(on);
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
        // WebKit's capture brings no sound, so the screen's sound is sent on its own track.
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
}

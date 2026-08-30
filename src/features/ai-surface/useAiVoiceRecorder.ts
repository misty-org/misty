import { agentsApi } from "@/api/agents/api";
import { useCallback, useEffect, useRef, useState } from "react";

const voiceInputStorageKey = "misty.voice.input-device";

export interface AiVoiceInputDevice {
  deviceId: string;
  label: string;
}

export function useAiVoiceRecorder({
  onTranscript,
  onError,
  onActivityChange,
}: {
  onTranscript: (transcript: string) => void;
  onError: (message: string) => void;
  onActivityChange?: (active: boolean) => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [inputDevices, setInputDevices] = useState<AiVoiceInputDevice[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState(readSavedInputDevice);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const discardRecordingRef = useRef(false);
  const onActivityChangeRef = useRef(onActivityChange);

  useEffect(() => {
    onActivityChangeRef.current = onActivityChange;
  }, [onActivityChange]);

  const refreshInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const available = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "audioinput" && device.deviceId !== "default",
      );
      const next = available.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label.trim() || `Microphone ${index + 1}`,
      }));
      setInputDevices(next);
      if (
        selectedInputDeviceId &&
        available.every((device) => device.deviceId !== selectedInputDeviceId)
      ) {
        saveInputDevice("");
        setSelectedInputDeviceId("");
      }
    } catch {
      // Device discovery can be unavailable until microphone permission is granted.
    }
  }, [selectedInputDeviceId]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    void refreshInputDevices();
    const onDeviceChange = () => void refreshInputDevices();
    mediaDevices.addEventListener?.("devicechange", onDeviceChange);
    return () => mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
  }, [refreshInputDevices]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRecordingRef.current = true;
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      onActivityChangeRef.current?.(false);
    };
  }, []);

  const start = async () => {
    if (requesting || recording || transcribing) return;
    onError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("Voice recording is not available on this device.");
      return;
    }
    setRequesting(true);
    onActivityChangeRef.current?.(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedInputDeviceId ? { deviceId: { exact: selectedInputDeviceId } } : true,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      void refreshInputDevices();
      discardRecordingRef.current = false;
      const mimeType = preferredRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        recorderRef.current = null;
        streamRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        if (discardRecordingRef.current || !mountedRef.current) return;
        setRecording(false);
        const duration = Math.max(1, Math.min(60_000, Date.now() - startedAtRef.current));
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) {
          onActivityChangeRef.current?.(false);
          return void onError("No audio was recorded.");
        }
        setTranscribing(true);
        void agentsApi
          .transcribeVoice(blob, duration)
          .then((result) => onTranscript(result.transcript))
          .catch((reason) =>
            onError(reason instanceof Error ? reason.message : "Voice could not be transcribed."),
          )
          .finally(() => {
            if (mountedRef.current) setTranscribing(false);
            onActivityChangeRef.current?.(false);
          });
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setRequesting(false);
      setRecording(true);
      timeoutRef.current = window.setTimeout(() => recorder.stop(), 60_000);
    } catch (reason) {
      setRequesting(false);
      onActivityChangeRef.current?.(false);
      onError(microphoneErrorMessage(reason));
    }
  };

  const stop = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const selectInputDevice = (deviceId: string) => {
    const normalized = deviceId.trim();
    saveInputDevice(normalized);
    setSelectedInputDeviceId(normalized);
  };

  return {
    requesting,
    recording,
    transcribing,
    inputDevices,
    selectedInputDeviceId,
    refreshInputDevices,
    selectInputDevice,
    start,
    stop,
  };
}

function readSavedInputDevice(): string {
  try {
    return window.localStorage.getItem(voiceInputStorageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

function saveInputDevice(deviceId: string): void {
  try {
    if (deviceId) window.localStorage.setItem(voiceInputStorageKey, deviceId);
    else window.localStorage.removeItem(voiceInputStorageKey);
  } catch {
    // Persistence is optional in privacy-restricted webviews.
  }
}

function preferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm"].find(
    (mimeType) => MediaRecorder.isTypeSupported(mimeType),
  );
}

function microphoneErrorMessage(reason: unknown): string {
  const name = reason instanceof DOMException ? reason.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is off. Allow it for Misty in System Settings, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Misty could not find a microphone on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Another app or system setting is preventing Misty from using the microphone.";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "The selected microphone is no longer available. Choose another input.";
  }
  return reason instanceof Error && reason.message
    ? reason.message
    : "Misty could not start voice recording.";
}

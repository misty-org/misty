import { useSavedSpeaker } from "./call_devices";

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
type SinkElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

export interface SpeakerSink {
  destination: AudioNode;
  wake(): void;
  close(): void;
}

export function speakerSink(context: AudioContext): SpeakerSink {
  const sinkContext = context as SinkContext;
  const direct =
    typeof sinkContext.setSinkId === "function" ||
    typeof HTMLMediaElement === "undefined" ||
    !("setSinkId" in HTMLMediaElement.prototype);
  let element: SinkElement | undefined;
  let destination: AudioNode = context.destination;
  if (!direct) {
    const stream = context.createMediaStreamDestination();
    element = new Audio() as SinkElement;
    element.srcObject = stream.stream;
    destination = stream;
  }
  let device: string | undefined;
  const route = (next: string) => {
    if (next === device) return;
    device = next;
    if (typeof sinkContext.setSinkId === "function") {
      void sinkContext.setSinkId(next).catch(() => undefined);
      return;
    }
    if (element && typeof element.setSinkId === "function")
      void element.setSinkId(next).catch(() => undefined);
  };
  route(useSavedSpeaker.getState().value);
  const unsubscribe = useSavedSpeaker.subscribe((state) => route(state.value));
  const wake = () => {
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    if (element?.paused) void element.play().catch(() => undefined);
  };
  wake();
  return {
    destination,
    wake,
    close() {
      unsubscribe();
      if (element) {
        element.pause();
        element.srcObject = null;
      }
    },
  };
}

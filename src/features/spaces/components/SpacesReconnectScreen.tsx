import { useEffect, useState } from "react";

const reconnectPhrases = [
  "Trying to reconnect to Misty…",
  "Knocking gently on the server’s door…",
  "Sending a tiny signal through the mist…",
  "Untangling the connection…",
  "Asking the clouds to scoot a little closer…",
  "Finding our way back to your Spaces…",
] as const;

const phraseIntervalMs = 2_800;
const reconnectIntervalMs = 3_000;

export function SpacesReconnectScreen(props: { onReconnect: () => void }) {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(
      () => setPhraseIndex((current) => (current + 1) % reconnectPhrases.length),
      phraseIntervalMs,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(props.onReconnect, reconnectIntervalMs);
    return () => window.clearInterval(interval);
  }, [props.onReconnect]);

  return (
    <main
      className="grid h-full min-h-0 place-items-center overflow-hidden bg-background px-6 text-center"
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <h1 className="m-0 max-w-md text-lg font-semibold tracking-tight text-foreground">
        {reconnectPhrases[phraseIndex]}
      </h1>
    </main>
  );
}

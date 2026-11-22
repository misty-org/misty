// The text box's window draws with the app's own classes over a transparent page.
import "@/styles/styles.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Image as ImageIcon } from "lucide-react";
import {
  ComposerAttachment,
  Input,
  MessageComposerSend,
  MistyMark,
  Surface,
} from "@misty/ui";

/** The most pictures one question takes (`cursor/host/ask.rs`). */
const MOST_SHOTS = 4;

interface Shot {
  id: number;
  dataUrl: string;
}

/**
 * Tutor's text box beside the pointer (tap Control twice, `cursor/host/ask.rs`), one row as
 * Claude's quick entry is: Misty's mark, the pictures taken for this question, the question and
 * Send. While it's open a drag anywhere else on the screen adds a picture of that part
 * (`TutorShotLayer`). Enter sends the question to Tutor with its pictures; Escape or clicking
 * away closes it, and a half-typed question and its pictures stay for next time.
 */
export function TutorAskBox() {
  const [text, setText] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const field = useRef<HTMLInputElement>(null);
  const latest = useRef({ text, shots });
  latest.current = { text, shots };
  const nextShot = useRef(0);

  useEffect(() => {
    const focus = () => {
      field.current?.focus();
      field.current?.select();
    };
    focus();
    const opened = listen("misty://tutor-ask-open", focus);
    const shot = listen<{ dataUrl: string }>("misty://tutor-ask-shot", (event) => {
      setShots((current) =>
        [...current, { id: nextShot.current++, dataUrl: event.payload.dataUrl }].slice(
          -MOST_SHOTS,
        ),
      );
      field.current?.focus();
    });
    // Clicking another app closes the box, keeping what was typed.
    const away = () =>
      void invoke("cursor_companion_ask_close", { text: "", images: [] }).catch(() => {});
    window.addEventListener("blur", away);
    return () => {
      void opened.then((stop) => stop());
      void shot.then((stop) => stop());
      window.removeEventListener("blur", away);
    };
  }, []);

  const send = () => {
    const question = latest.current.text.trim();
    if (!question) return;
    const images = latest.current.shots.map((shot) => shot.dataUrl);
    setText("");
    setShots([]);
    void invoke("cursor_companion_ask_close", { text: question, images }).catch(() => {});
  };

  return (
    <Surface
      tone="card"
      edge="hairline"
      radius="xl"
      className="flex size-full min-w-0 items-center gap-2 px-3"
    >
      {/* At the glyph size, as every icon is drawn (`styles/glyphs.css`). */}
      <MistyMark aria-hidden size={18} className="shrink-0" />
      {shots.map((shot, index) => (
        <ComposerAttachment
          key={shot.id}
          icon={ImageIcon}
          name={shots.length > 1 ? `Image ${index + 1}` : "Image"}
          onRemove={() => setShots((current) => current.filter((kept) => kept.id !== shot.id))}
        />
      ))}
      <Input
        ref={field}
        variant="bare"
        value={text}
        placeholder="Ask Misty"
        aria-label="Ask Misty"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            send();
          } else if (event.key === "Escape") {
            void invoke("cursor_companion_ask_close", { text: "", images: [] }).catch(() => {});
          }
        }}
      />
      <MessageComposerSend label="Send" disabled={!text.trim()} onClick={send} />
    </Surface>
  );
}

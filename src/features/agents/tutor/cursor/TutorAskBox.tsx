// The text box's window draws with the app's own classes over a transparent page.
import "@/styles/styles.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Input, Surface } from "@/shared/ui";

/**
 * Tutor's text box beside the pointer (tap Control twice, `cursor/host/ask.rs`): Enter sends the
 * question to Tutor, Escape or clicking away closes it. A half-typed question stays for next time.
 */
export function TutorAskBox() {
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const latest = useRef(text);
  latest.current = text;

  useEffect(() => {
    const focus = () => {
      field.current?.focus();
      field.current?.select();
    };
    focus();
    const opened = listen("misty://tutor-ask-open", focus);
    // Clicking anywhere else closes the box, keeping what was typed.
    const away = () => void invoke("cursor_companion_ask_close", { text: "" }).catch(() => {});
    window.addEventListener("blur", away);
    return () => {
      void opened.then((stop) => stop());
      window.removeEventListener("blur", away);
    };
  }, []);

  const send = () => {
    const question = latest.current.trim();
    if (!question) return;
    setText("");
    void invoke("cursor_companion_ask_close", { text: question }).catch(() => {});
  };

  return (
    <Surface tone="card" edge="hairline" radius="xl" className="flex size-full items-center p-3">
      <Input
        ref={field}
        value={text}
        placeholder="Ask Misty"
        aria-label="Ask Misty"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            send();
          } else if (event.key === "Escape") {
            void invoke("cursor_companion_ask_close", { text: "" }).catch(() => {});
          }
        }}
      />
    </Surface>
  );
}

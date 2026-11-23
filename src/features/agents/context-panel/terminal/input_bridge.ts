// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { IDisposable, Terminal } from "@xterm/xterm";

const ECHO_WINDOW_MS = 250;

const MAX_REMEMBERED = 64;

interface Delivery {
  text: string;
  at: number;
}

export function attachInputBridge(term: Terminal, send: (data: string) => void): IDisposable {
  const element = term.element;

  let insertion: { text: string; sent: boolean } | null = null;
  const delivered: Delivery[] = [];
  let keypress: { text: string; at: number; handled: boolean } | null = null;

  const remember = (text: string) => {
    const at = performance.now();
    delivered.push({ text, at });
    while (delivered.length > MAX_REMEMBERED || at - delivered[0].at > ECHO_WINDOW_MS) {
      delivered.shift();
    }
  };

  const expire = (at: number) => {
    while (delivered.length && at - delivered[0].at > ECHO_WINDOW_MS) delivered.shift();
  };

  const isEcho = (text: string): boolean => {
    expire(performance.now());
    let matched = "";
    let count = 0;
    for (let index = delivered.length - 1; index >= 0 && matched.length < text.length; index--) {
      matched = delivered[index].text + matched;
      count++;
    }
    if (matched !== text) return false;
    delivered.splice(delivered.length - count, count);
    return true;
  };

  const onKeyDown = () => {
    keypress = null;
  };

  const onKeyPress = (event: Event) => {
    const { charCode, which, keyCode } = event as KeyboardEvent;
    const code = charCode || which || keyCode;
    keypress = code
      ? { text: String.fromCharCode(code), at: performance.now(), handled: false }
      : null;
  };

  const onInputCapture = (event: Event) => {
    insertion = null;
    if (term.options.screenReaderMode) return;
    const input = event as InputEvent;
    if (input.inputType !== "insertText" || !input.data || input.isComposing) return;
    const sent =
      keypress !== null &&
      keypress.handled &&
      keypress.text === input.data &&
      performance.now() - keypress.at <= ECHO_WINDOW_MS;
    keypress = null;
    insertion = { text: input.data, sent };
    if (sent) remember(input.data);
  };

  const onInputBubble = () => {
    const current = insertion;
    insertion = null;
    if (!current || current.sent) return;
    remember(current.text);
    send(current.text);
  };

  const dataDisposable = term.onData((data) => {
    if (insertion && data === insertion.text) {
      if (!insertion.sent) {
        insertion.sent = true;
        remember(data);
        send(data);
      }
      return;
    }
    if (keypress && !insertion && data === keypress.text) {
      keypress.handled = true;
    }
    if (!insertion && isEcho(data)) return;
    send(data);
  });

  const listeners: Array<[string, EventListener, boolean]> = [
    ["keydown", onKeyDown, true],
    ["keypress", onKeyPress, true],
    ["input", onInputCapture, true],
    ["input", onInputBubble, false],
  ];
  if (element) {
    for (const [type, listener, capture] of listeners) {
      element.addEventListener(type, listener, capture);
    }
  }

  return {
    dispose() {
      dataDisposable.dispose();
      if (element) {
        for (const [type, listener, capture] of listeners) {
          element.removeEventListener(type, listener, capture);
        }
      }
    },
  };
}

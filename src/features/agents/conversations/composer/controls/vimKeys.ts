/**
 * Vim keys for the composer, as the engines' own terminal apps offer them (`/vim`): insert and
 * normal modes, the common motions, `d`/`c`/`y` with a motion or doubled, `p`, `x` and undo.
 * Pure text in, text out, so the composer only applies what comes back.
 */

export type VimMode = "insert" | "normal";

export interface VimState {
  mode: VimMode;
  /** An operator or `g` typed and waiting for the rest of the command. */
  pending: string;
  /** What `y`, `d`, `x` and `c` last took; a whole line ends with a newline. */
  register: string;
  /** Text before each change, newest last, for `u`. */
  undo: string[];
}

export const vimStart = (): VimState => ({ mode: "insert", pending: "", register: "", undo: [] });

export interface VimEdit {
  text: string;
  caret: number;
  state: VimState;
}

const lineStart = (text: string, at: number) => text.lastIndexOf("\n", at - 1) + 1;

const lineEnd = (text: string, at: number) => {
  const end = text.indexOf("\n", at);
  return end === -1 ? text.length : end;
};

/** The last character of the line, where normal mode rests at its end. */
const lastOnLine = (text: string, at: number) =>
  Math.max(lineStart(text, at), lineEnd(text, at) - 1);

const firstWord = (text: string, at: number) => {
  let index = lineStart(text, at);
  const end = lineEnd(text, at);
  while (index < end && /\s/.test(text[index])) index += 1;
  return index;
};

const isWord = (char: string | undefined) => Boolean(char && /\w/.test(char));
const isSpace = (char: string | undefined) => Boolean(char && /\s/.test(char));

function nextWord(text: string, at: number) {
  let index = at;
  if (isWord(text[index])) while (isWord(text[index])) index += 1;
  else if (!isSpace(text[index]))
    while (index < text.length && !isWord(text[index]) && !isSpace(text[index])) index += 1;
  while (isSpace(text[index])) index += 1;
  return Math.min(index, text.length);
}

function previousWord(text: string, at: number) {
  let index = at - 1;
  while (index > 0 && isSpace(text[index])) index -= 1;
  if (isWord(text[index])) while (index > 0 && isWord(text[index - 1])) index -= 1;
  else while (index > 0 && !isWord(text[index - 1]) && !isSpace(text[index - 1])) index -= 1;
  return Math.max(index, 0);
}

function wordEnd(text: string, at: number) {
  let index = at + 1;
  while (isSpace(text[index])) index += 1;
  if (isWord(text[index])) while (isWord(text[index + 1])) index += 1;
  else
    while (index + 1 < text.length && !isWord(text[index + 1]) && !isSpace(text[index + 1]))
      index += 1;
  return Math.min(index, Math.max(text.length - 1, 0));
}

/** The same column on the line above (`-1`) or below (`1`). */
function verticalMove(text: string, at: number, step: -1 | 1) {
  const start = lineStart(text, at);
  const column = at - start;
  if (step === -1) {
    if (start === 0) return at;
    const above = lineStart(text, start - 1);
    return Math.min(above + column, lastOnLine(text, above));
  }
  const end = lineEnd(text, at);
  if (end >= text.length) return at;
  const below = end + 1;
  return Math.min(below + column, lastOnLine(text, below));
}

/** Where a motion key moves the caret, or undefined when it isn't one. */
function motion(key: string, text: string, at: number): number | undefined {
  switch (key) {
    case "h":
      return Math.max(lineStart(text, at), at - 1);
    case "l":
      return Math.min(lastOnLine(text, at), at + 1);
    case "j":
      return verticalMove(text, at, 1);
    case "k":
      return verticalMove(text, at, -1);
    case "w":
      return nextWord(text, at);
    case "b":
      return previousWord(text, at);
    case "e":
      return wordEnd(text, at);
    case "0":
      return lineStart(text, at);
    case "^":
      return firstWord(text, at);
    case "$":
      return lastOnLine(text, at);
    case "G":
      return lineStart(text, text.length);
    default:
      return undefined;
  }
}

/** The span a doubled operator (`dd`, `yy`, `cc`) takes: the whole line and its newline. */
function wholeLine(text: string, at: number): [number, number] {
  const start = lineStart(text, at);
  const end = lineEnd(text, at);
  if (end < text.length) return [start, end + 1];
  // The last line takes the newline before it instead.
  return [Math.max(start - 1, 0), end];
}

const remember = (state: VimState, text: string): VimState => ({
  ...state,
  undo: [...state.undo.slice(-49), text],
});

function operate(
  operator: string,
  from: number,
  to: number,
  text: string,
  state: VimState,
  linewise: boolean,
): VimEdit {
  const [start, end] = from <= to ? [from, to] : [to, from];
  const taken = text.slice(start, end);
  const register = linewise && !taken.endsWith("\n") ? `${taken.replace(/^\n/, "")}\n` : taken;
  if (operator === "y") {
    return { text, caret: start, state: { ...state, pending: "", register } };
  }
  const next = text.slice(0, start) + text.slice(end);
  const changed = { ...remember(state, text), pending: "", register };
  if (operator === "c") return { text: next, caret: start, state: { ...changed, mode: "insert" } };
  return { text: next, caret: Math.min(start, lastOnLine(next, start)), state: changed };
}

/**
 * Applies one key in Vim mode. Returns the edit, or null when the key isn't Vim's to take (typing
 * in insert mode, Enter to send, arrows, shortcuts with ⌘ or Ctrl).
 */
export function vimKey(key: string, text: string, caret: number, state: VimState): VimEdit | null {
  if (state.mode === "insert") {
    if (key !== "Escape") return null;
    const back = caret > lineStart(text, caret) ? caret - 1 : caret;
    return { text, caret: back, state: { ...state, mode: "normal", pending: "" } };
  }
  if (key === "Enter" || key.startsWith("Arrow") || key === "Tab") return null;
  if (key === "Escape") return { text, caret, state: { ...state, pending: "" } };
  if (key.length !== 1) return { text, caret, state };
  const insert = (at: number, next = text, base = state): VimEdit => ({
    text: next,
    caret: at,
    state: { ...base, mode: "insert", pending: "" },
  });

  const pending = state.pending;
  if (pending === "g") {
    return { text, caret: key === "g" ? 0 : caret, state: { ...state, pending: "" } };
  }
  if (pending === "d" || pending === "c" || pending === "y") {
    if (key === pending) {
      const [start, end] = wholeLine(text, caret);
      return operate(pending, start, end, text, state, true);
    }
    // `cw` changes to the word's end, as Vim does, rather than eating the space after it.
    if (pending === "c" && key === "w")
      return operate("c", caret, wordEnd(text, caret) + 1, text, state, false);
    const to = motion(key, text, caret);
    if (to === undefined) return { text, caret, state: { ...state, pending: "" } };
    const inclusive = key === "$" || key === "e";
    const end = inclusive ? to + 1 : to;
    return operate(pending, caret, end, text, state, key === "j" || key === "k");
  }

  const moved = motion(key, text, caret);
  if (moved !== undefined) return { text, caret: moved, state };
  switch (key) {
    case "g":
    case "d":
    case "c":
    case "y":
      return { text, caret, state: { ...state, pending: key } };
    case "i":
      return insert(caret);
    case "a":
      return insert(Math.min(caret + 1, lineEnd(text, caret)));
    case "I":
      return insert(firstWord(text, caret));
    case "A":
      return insert(lineEnd(text, caret));
    case "o": {
      const end = lineEnd(text, caret);
      return insert(end + 1, `${text.slice(0, end)}\n${text.slice(end)}`, remember(state, text));
    }
    case "O": {
      const start = lineStart(text, caret);
      return insert(start, `${text.slice(0, start)}\n${text.slice(start)}`, remember(state, text));
    }
    case "x":
      return text.length && caret < lineEnd(text, caret)
        ? operate("d", caret, caret + 1, text, state, false)
        : { text, caret, state };
    case "X":
      return caret > lineStart(text, caret)
        ? operate("d", caret - 1, caret, text, state, false)
        : { text, caret, state };
    case "s":
      return operate("c", caret, Math.min(caret + 1, lineEnd(text, caret)), text, state, false);
    case "D":
      return operate("d", caret, lineEnd(text, caret), text, state, false);
    case "C":
      return operate("c", caret, lineEnd(text, caret), text, state, false);
    case "p":
    case "P": {
      if (!state.register) return { text, caret, state };
      const linewise = state.register.endsWith("\n");
      const at = linewise
        ? key === "p"
          ? Math.min(lineEnd(text, caret) + 1, text.length)
          : lineStart(text, caret)
        : key === "p"
          ? Math.min(caret + 1, text.length)
          : caret;
      const piece =
        linewise && key === "p" && at === text.length && !text.endsWith("\n")
          ? `\n${state.register.slice(0, -1)}`
          : state.register;
      const next = text.slice(0, at) + piece + text.slice(at);
      return {
        text: next,
        caret: linewise ? at + (piece.startsWith("\n") ? 1 : 0) : at + piece.length - 1,
        state: remember(state, text),
      };
    }
    case "u": {
      const previous = state.undo[state.undo.length - 1];
      if (previous === undefined) return { text, caret, state };
      return {
        text: previous,
        caret: Math.min(caret, Math.max(previous.length - 1, 0)),
        state: { ...state, undo: state.undo.slice(0, -1) },
      };
    }
    default:
      // Normal mode types nothing.
      return { text, caret, state };
  }
}

// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
const EMPTY: never[] = [];

/** Keeps one derived result per caller. A store selector runs on every store write, including
 * other chats' streamed text; unchanged inputs must not walk the same history again. Message
 * writes are immutable, so identity is enough. */
export function memoizeMessageHistory<Message, Result, Extra = undefined>(
  derive: (messages: Message[], extra: Extra | undefined) => Result,
) {
  let previousMessages: Message[] | undefined;
  let previousExtra: Extra | undefined;
  let result: Result;
  return (messages: Message[] | undefined, extra?: Extra): Result => {
    const current = messages ?? (EMPTY as Message[]);
    if (current !== previousMessages || !Object.is(extra, previousExtra)) {
      result = derive(current, extra);
      previousMessages = current;
      previousExtra = extra;
    }
    return result;
  };
}

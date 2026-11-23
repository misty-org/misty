// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
interface InputQueueOptions {
  write: (data: string) => Promise<void>;
  reopen: () => Promise<void>;
  isSessionGone: (error: unknown) => boolean;
}

interface TerminalInputQueue {
  send: (data: string) => Promise<void>;
}

export function createInputQueue({
  write,
  reopen,
  isSessionGone,
}: InputQueueOptions): TerminalInputQueue {
  let pending = "";
  let draining: Promise<void> | null = null;

  const drain = async () => {
    try {
      while (pending) {
        const chunk = pending;
        pending = "";
        try {
          await write(chunk);
        } catch (error) {
          if (!isSessionGone(error)) continue;
          try {
            await reopen();
            await write(chunk);
          } catch {}
        }
      }
    } finally {
      draining = null;
    }
  };

  return {
    send(data) {
      if (!data) return Promise.resolve();
      pending += data;
      draining ??= drain();
      return draining;
    },
  };
}

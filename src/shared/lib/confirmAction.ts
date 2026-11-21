import { create } from "zustand";

/** A question Misty asks before doing something, waiting on the person's answer. */
export interface ConfirmRequest {
  title: string;
  message: string;
  answer(yes: boolean): void;
}

/** The question open now, shown by `ConfirmActionHost` at the app's root. */
export const useConfirmRequest = create<{ request: ConfirmRequest | null }>(() => ({
  request: null,
}));

/**
 * Asks before an action, in Misty's own dialog (`ConfirmActionHost`), never the system's: the
 * title, the question, then Cancel and the action. Resolves true once the person confirms. A new
 * question while one is open answers the open one with no.
 */
export function confirmAction(message: string, title = "Are you sure?"): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmRequest.getState().request?.answer(false);
    useConfirmRequest.setState({
      request: {
        title,
        message,
        answer: (yes) => {
          useConfirmRequest.setState({ request: null });
          resolve(yes);
        },
      },
    });
  });
}

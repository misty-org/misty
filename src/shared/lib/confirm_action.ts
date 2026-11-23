import { create } from "zustand";

export interface ConfirmRequest {
  title: string;
  message: string;
  answer(yes: boolean): void;
}

export const useConfirmRequest = create<{ request: ConfirmRequest | null }>(() => ({
  request: null,
}));

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

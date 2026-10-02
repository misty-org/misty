import { invoke } from "@tauri-apps/api/core";
let nativeLifecycle = Promise.resolve<unknown>(undefined);
export const nativeConfiguration = (accountId: string) => {
  const next = nativeLifecycle
    .catch(() => {})
    .then(() =>
      invoke<number>("cursor_companion_configure", {
        accountId,
      }),
    );
  nativeLifecycle = next;
  return next;
};

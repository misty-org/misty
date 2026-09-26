import { resolveApiBase } from "@/api/deployment/api";
import { invoke } from "@tauri-apps/api/core";
import { assertStableApiSession, readApiSessionGeneration } from "@/api/client";
import {
  readActiveSavedAccountSession,
  accountScopeResetEvent,
} from "@/features/auth/runtimeSession";

/** Host-only lifetime for bundled workers. Native folder/picker grants still apply. */
export async function withBuiltinService<T>(
  tool: "files" | "library",
  _spaceId: string,
  run: (instance: string) => Promise<T>,
  signal?: AbortSignal,
  purpose: "documents" | "search" | "previews" | "devices" = "documents",
): Promise<T> {
  const account = readActiveSavedAccountSession();
  const generation = readApiSessionGeneration();
  if (!account) throw new Error(`Sign in before using ${purpose}.`);
  let instance = "";
  let invalid: Error | undefined;
  let rejectCancelled!: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectCancelled = reject;
  });
  void cancelled.catch(() => {});
  const close = () => {
    if (!instance) return;
    const id = instance;
    instance = "";
    void invoke("mini_app_close", { instance: id }).catch(() => {});
  };
  const invalidate = () => {
    invalid ??= new Error("The active session changed. Try again to continue.");
    close();
    rejectCancelled(invalid);
  };
  const assert = () => {
    if (invalid) throw invalid;
    signal?.throwIfAborted();
    assertStableApiSession(generation);
    if (readActiveSavedAccountSession()?.id !== account.id)
      throw new Error("The active account changed.");
  };
  window.addEventListener(accountScopeResetEvent, invalidate);
  signal?.addEventListener("abort", invalidate, { once: true });
  try {
    assert();
    const deployment = await resolveApiBase();
    assert();
    instance = await invoke<string>("builtin_service_open", {
      tool,
      purpose,
      owner: { accountId: account.id, deployment },
    });
    assert();
    const result = await Promise.race([run(instance), cancelled]);
    assert();
    return result;
  } finally {
    window.removeEventListener(accountScopeResetEvent, invalidate);
    signal?.removeEventListener("abort", invalidate);
    close();
  }
}

import { deviceModelCall } from "@/api/device-models";
import { invoke } from "@/native/invoke";
import { useCallback, useEffect, useState } from "react";

/** A model a provider offers, as `model_keys_models` lists it. */
export interface ListedModel {
  id: string;
  label: string;
  embedding: boolean;
}

/** A key the native app confirmed by listing its provider's models, then saved. */
export interface AddedKey {
  provider: string;
  models: ListedModel[];
  saved: string[];
}

interface ChatgptStatus {
  signedIn: boolean;
  email: string;
  /** The plan-usage grant was given; without it requests can't use the plan. */
  planUsage: boolean;
  revoked?: boolean;
}

const message = (cause: unknown, fallback: string) =>
  typeof cause === "string" ? cause : cause instanceof Error ? cause.message : fallback;

/** Sign in with ChatGPT: the native app holds and refreshes the tokens. */
export function useChatgptAccount() {
  const [status, setStatus] = useState<ChatgptStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    invoke<ChatgptStatus>("model_keys_chatgpt_status")
      .then((next) => live && setStatus(next))
      .catch(() => live && setStatus({ signedIn: false, email: "", planUsage: false }));
    return () => {
      live = false;
    };
  }, []);
  const run = useCallback(async (command: string, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      const next = await invoke<ChatgptStatus>(command);
      setStatus(next);
      if (next.revoked === false)
        setError(
          "Signed out here. ChatGPT didn't confirm it; disconnect Misty in ChatGPT's settings.",
        );
      return next;
    } catch (cause) {
      setError(message(cause, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  return {
    status,
    busy,
    error,
    signIn: () => run("model_keys_chatgpt_sign_in", "ChatGPT sign-in didn't finish."),
    signOut: () => run("model_keys_chatgpt_sign_out", "Misty couldn't sign out of ChatGPT."),
  };
}

/** Adds a pasted key (its provider found from the key) or signs in to OpenRouter for one. */
export async function addModelKey(key: string, provider?: string): Promise<AddedKey> {
  return invoke<AddedKey>("model_keys_add", { key, provider: provider ?? null });
}

export async function signInToOpenRouter(): Promise<AddedKey> {
  return invoke<AddedKey>("model_keys_openrouter_sign_in");
}

/** The models a provider offers this device; null while listing, [] when it can't list. */
export function useProviderModels(provider: string, ready: boolean, revision = 0) {
  const [models, setModels] = useState<ListedModel[] | null>(null);
  useEffect(() => {
    if (!ready) {
      setModels([]);
      return;
    }
    let live = true;
    setModels(null);
    invoke<ListedModel[]>("model_keys_models", { provider })
      .then((next) => live && setModels(next))
      .catch(() => live && setModels([]));
    return () => {
      live = false;
    };
  }, [provider, ready, revision]);
  return models;
}

export interface ModelTestResult {
  model: string;
  tools: { ok: boolean; detail: string };
  images: { ok: boolean; detail: string };
}

/** Checks the agent model calls tools and sees screenshots, on the runtime on this computer. */
export function useModelTest() {
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      setResult(await deviceModelCall<ModelTestResult>("model-test", {}));
    } catch (cause) {
      setError(message(cause, "The check couldn't run."));
    } finally {
      setRunning(false);
    }
  }, []);
  return { result, error, running, run };
}

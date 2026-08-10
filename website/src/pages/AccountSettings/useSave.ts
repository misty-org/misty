import { useState } from "react";

/**
 * Runs a save request and exposes the three states a settings form needs:
 * in-flight, failed, and a "Saved." confirmation that clears itself.
 */
export function useSave(fn: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  async function save() {
    setSaving(true);
    setError("");
    setOk(false);
    try {
      await fn();
      setOk(true);
      window.setTimeout(() => setOk(false), 2500);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return { saving, error, ok, save };
}

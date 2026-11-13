
/**
 * Whether an AI error is a run's `model_key_needed` ending: no agent model is set on this device.
 */
export function needsModelKey(message: string | null | undefined): boolean {
  return Boolean(message && /\bmodel key\b/i.test(message));
}

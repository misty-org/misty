import { Button } from "@/shared/ui";
import { openModelSettings } from "./models/modelKeys";

/**
 * Whether an AI error is a run's `model_key_needed` ending: no agent model is set on this device.
 */
export function needsModelKey(message: string | null | undefined): boolean {
  return Boolean(message && /\bmodel key\b/i.test(message));
}

/** The way out of a `model_key_needed` error: straight to Settings › Models. */
export function ModelKeyNeededButton(props: { onOpen?: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        props.onOpen?.();
        openModelSettings();
      }}
    >
      Open Models settings
    </Button>
  );
}

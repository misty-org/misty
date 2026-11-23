import { readApiSessionGeneration } from "@/api/client/session";
import type { SpaceMessage } from "../../api/dto/entities";
import { useCallback, useState } from "react";

export function useMessageDeleteTarget(chatKey: ReadonlyArray<string | undefined>) {
  const scope = JSON.stringify([readApiSessionGeneration(), ...chatKey]);
  const [target, setTarget] = useState<{ scope: string; message: SpaceMessage } | null>(null);
  const clear = useCallback(() => setTarget(null), []);
  return {
    message: target?.scope === scope ? target.message : null,
    request: (message: SpaceMessage) => setTarget({ scope, message }),
    clear,
  };
}

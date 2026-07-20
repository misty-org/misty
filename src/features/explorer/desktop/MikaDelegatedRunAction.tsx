import { Button } from "@/ui";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorText } from "@/lib/format";
import { agentArchitectureApi } from "@/stores/agents/useAgentArchitectureStore";
import type { AiPanelMessage } from "@/models/types/stores/assistant/useMikaSessionStore";

export function MikaDelegatedRunAction({ message }: { message: AiPanelMessage }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!message.delegatedRunId) return null;

  const inspect = async () => {
    setBusy(true);
    setError("");
    try {
      const { run } = await agentArchitectureApi.runDetail(message.delegatedRunId!);
      const section = run.resource_kind === "workflow" ? "workflows" : "agents";
      const query = new URLSearchParams({
        runId: run.id,
        agentId: run.agent_id || run.resource_id,
      });
      navigate(
        `/spaces/${encodeURIComponent(run.space_id)}/agents/studio/${section}?${query.toString()}`,
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid justify-items-start gap-1">
      <Button
        variant="secondary"
        size="xs"
        type="button"
        disabled={busy}
        onClick={() => void inspect()}
      >
        <ExternalLink size={12} />
        {busy ? "Opening run…" : "Inspect run"}
      </Button>
      {error ? (
        <small className="text-[10px] text-destructive" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}

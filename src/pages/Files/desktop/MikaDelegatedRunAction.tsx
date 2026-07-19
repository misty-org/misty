import { Button } from "../../../components/ui/button";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorText } from "../../../shared/format";
import { agentArchitectureApi } from "../../../spaces/agentArchitectureApi";
import type { AiPanelMessage } from "../../../stores/useMikaSessionStore";

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
      const query = new URLSearchParams({ runId: run.id, agentId: run.agent_id || run.resource_id });
      navigate(`/spaces/${encodeURIComponent(run.space_id)}/agents/studio/${section}?${query.toString()}`);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return <div className="grid justify-items-start gap-1"><Button className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] px-2.5 text-[10px] font-semibold text-[#d4d4d4] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-hover))] disabled:opacity-60" type="button" disabled={busy} onClick={() => void inspect()}><ExternalLink size={12}/>{busy ? "Opening run…" : "Inspect run"}</Button>{error ? <small className="text-[10px] text-red-300" role="alert">{error}</small> : null}</div>;
}

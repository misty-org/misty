
import { useCallback, useEffect, useRef, useState } from "react";
import {runtimeAutomationsApi as automationsApi} from "@/features/agents/agentsRuntime";

import { AutomationEditor } from "./AutomationEditor";
import { AutomationListings } from "./AutomationListings";
import { normalizeActivepiecesFlows, type AutomationFlow } from "./normalizeFlows";

export function AutomationsWorkspace(props: {
  selectedFlowId?: string;
  onSelectedFlowChange: (flowId?: string) => void;
  onCreateWithMisty: (draft?: string) => void;
}) {
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [loadingFlows, setLoadingFlows] = useState(true);
  const [flowError, setFlowError] = useState("");
  const [creating, setCreating] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const createInFlightRef = useRef(false);
  const editingFlow = flows.find((flow) => flow.id === props.selectedFlowId) ?? null;

  const loadFlows = useCallback(async () => {
    setLoadingFlows(true);
    setFlowError("");
    try {
      const result = await automationsApi.flows();
      setConnected(result.connected);
      setFlows(normalizeActivepiecesFlows(result.structured_content, result.text));
    } catch (error) {
      setFlowError(
        error instanceof Error ? error.message : "Misty could not load your automations.",
      );
    } finally {
      setLoadingFlows(false);
    }
  }, []);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  if (editingFlow) {
    return (
      <AutomationEditor
        flow={editingFlow}
        onBack={() => props.onSelectedFlowChange()}
        onFlowChanged={(flowId, changes) => {
          setFlows((current) =>
            current.map((flow) => (flow.id === flowId ? { ...flow, ...changes } : flow)),
          );
        }}
      />
    );
  }

  const createFlow = async () => {
    if (connected === false) {
      setFlowError("The built-in automation engine is not ready. Refresh and try again.");
      return;
    }
    if (connected !== true || createInFlightRef.current) return;
    createInFlightRef.current = true;
    setCreating(true);
    setFlowError("");
    try {
      const result = await automationsApi.callTool("ap_create_flow", {
        flowName: "Untitled automation",
      });
      const structured = result.structured_content;
      const created =
        structured && typeof structured === "object" && !Array.isArray(structured)
          ? (structured as Record<string, unknown>)
          : {};
      const id = typeof created.flowId === "string" ? created.flowId : "";
      const name =
        typeof created.displayName === "string" ? created.displayName : "Untitled automation";
      if (!id)
        throw new Error(
          "The automation was created, but Misty could not open it yet. Refresh the list to continue.",
        );
      const flow: AutomationFlow = {
        id,
        name,
        status: "disabled",
        trigger: "Trigger not configured",
        published: false,
      };
      setFlows((current) => [flow, ...current.filter((item) => item.id !== flow.id)]);
      props.onSelectedFlowChange(flow.id);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "activepieces_not_connected") {
        setConnected(false);
        setFlowError("The built-in automation engine is not ready. Refresh and try again.");
        return;
      }
      setFlowError(
        error instanceof Error ? error.message : "Misty could not create the automation.",
      );
    } finally {
      createInFlightRef.current = false;
      setCreating(false);
    }
  };

  return (
    <AutomationListings
      flows={flows}
      connected={connected}
      loading={loadingFlows || creating}
      error={flowError}
      onRefresh={() => void loadFlows()}
      onCreate={() => void createFlow()}
      onOpen={(flow) => props.onSelectedFlowChange(flow.id)}
    />
  );
}

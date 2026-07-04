import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { createCodeAiAdapter } from "./createCodeAiAdapter";
export const useCodeAiAdapter = createCodeAiAdapter(useCodingWorkspaceStore, useAiSurfaceAdapter);

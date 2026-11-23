export type ThinkingMode = "normal" | "deep";
type MistyReasoningEffort = "high" | "xhigh";
export function thinkingMode(effort?: string): ThinkingMode {
  return effort === "xhigh" ? "deep" : "normal";
}
export function thinkingEffort(mode: ThinkingMode): MistyReasoningEffort {
  return mode === "deep" ? "xhigh" : "high";
}

/** Product presets. The server owns the model; legacy efforts normalize to Normal. */
export type ThinkingMode = "normal" | "deep";
export type MistyReasoningEffort = "high" | "xhigh";
export function thinkingMode(effort?: string): ThinkingMode {
  return effort === "xhigh" ? "deep" : "normal";
}
export function thinkingEffort(mode: ThinkingMode): MistyReasoningEffort {
  return mode === "deep" ? "xhigh" : "high";
}

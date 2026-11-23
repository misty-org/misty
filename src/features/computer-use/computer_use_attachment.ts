// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";

const attached = new Set<string>();
const draftKey = "draft";

export function takeComputerCommand(typed: string, conversationId: string | undefined): string {
  const match = /^\/computer(?:\s+|$)/.exec(typed.trimStart());
  if (!match) return typed;
  attached.add(conversationId || draftKey);
  return typed.trimStart().slice(match[0].length);
}

export function takeComputerUseAttachment(conversationId: string): boolean {
  const used = attached.has(conversationId) || attached.has(draftKey);
  attached.delete(conversationId);
  attached.delete(draftKey);
  return used;
}

export interface ComputerUsePermissions {
  accessibility: boolean;
  screenRecording: boolean;
  osPermissionsRequired: boolean;
}

export const computerUseApi = {
  permissions: () => invoke<ComputerUsePermissions>("computer_use_permission_status"),
  openSettings: (kind: "accessibility" | "screenRecording") =>
    invoke<void>("computer_use_open_permission_settings", { kind }),
  stop: () => invoke<void>("computer_use_stop"),
};

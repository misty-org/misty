// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { invoke } from "@/native/invoke";

/** Where a prompt lives: the chat's linked folder (`.misty/prompts`) or Misty's own folder. */
export type PromptScope = "workspace" | "global";

/** One Markdown prompt. `path` is its key for edits, moves and deletes. */
export interface CustomPromptEntry {
  name: string;
  path: string;
  description?: string | null;
  argumentHint?: string | null;
  content: string;
  scope: PromptScope;
}

export interface PromptInput {
  name: string;
  description?: string;
  argumentHint?: string;
  content: string;
}

export type PromptUpdates = Partial<PromptInput>;

/** The folder's prompts, then the global ones. `folder` may be empty: global only. */
export const listPrompts = (folder: string) =>
  invoke<CustomPromptEntry[]>("engine_prompts_list", { path: folder });

export const createPromptFile = (folder: string, scope: PromptScope, input: PromptInput) =>
  invoke<CustomPromptEntry>("engine_prompts_create", {
    path: folder,
    scope,
    name: input.name,
    description: input.description ?? null,
    argumentHint: input.argumentHint ?? null,
    content: input.content,
  });

export const updatePromptFile = (folder: string, promptPath: string, updates: PromptUpdates) =>
  invoke<CustomPromptEntry>("engine_prompts_update", { path: folder, promptPath, updates });

export const deletePromptFile = (folder: string, promptPath: string) =>
  invoke<boolean>("engine_prompts_delete", { path: folder, promptPath });

export const movePromptFile = (folder: string, promptPath: string, scope: PromptScope) =>
  invoke<CustomPromptEntry>("engine_prompts_move", { path: folder, promptPath, scope });

/** Opens one scope's prompts folder in the file manager. */
export const revealPrompts = (folder: string, scope: PromptScope) =>
  invoke<void>("engine_prompts_reveal", { path: folder, scope });

/** The Settings block that manages prompts, opened from the composer's "New prompt" row. */
export const PROMPTS_SETTINGS_SECTION = "engine-prompts";

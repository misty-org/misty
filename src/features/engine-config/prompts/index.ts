// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

export { PromptsSection } from "./PromptsSection";
export {
  PROMPTS_SETTINGS_SECTION,
  listPrompts,
  type CustomPromptEntry,
  type PromptScope,
} from "./promptsApi";
export {
  createPrompt,
  deletePrompt,
  matchPrompts,
  movePrompt,
  promptsFor,
  prunePrompts,
  subscribePromptsChanged,
  updatePrompt,
  usePromptStore,
} from "./promptStore";

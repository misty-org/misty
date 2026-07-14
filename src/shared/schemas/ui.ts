import { z } from "zod";

export const mistyTerminalCommands = [
  "terminal.clear",
  "terminal.search",
  "terminal.zoom_in",
  "terminal.zoom_out",
  "terminal.zoom_reset",
  "terminal.copy",
  "terminal.paste",
] as const;

export const mistyPlannerCommands = [
  "planner.create",
  "roadmap.create",
  "roadmap.copy",
  "roadmap.paste",
  "roadmap.duplicate",
  "roadmap.delete",
  "roadmap.undo",
  "roadmap.redo",
] as const;

export const mistyBrowserCommands = [
  "navigation.back",
  "navigation.forward",
  "navigation.refresh",
  "browser.annotation_undo",
  "browser.annotation_redo",
] as const;

export const mistyCodeCommands = [
  "code.add_cursor_above",
  "code.add_cursor_below",
  "code.apply_inline_ai",
  "code.code_actions",
  "code.command_palette",
  "code.document_symbols",
  "code.format_document",
  "code.go_to_definition",
  "code.harpoon",
  "code.inline_ai",
  "code.open_multibuffer_excerpt",
  "code.previous_file",
  "code.quick_open",
  "code.references",
  "code.rename",
  "code.save",
  "code.search_project",
  "code.select_all_occurrences",
  "code.select_next_occurrence",
  "code.show_hover",
  "code.toggle_explorer",
  "code.toggle_terminal",
  "code.undo_selection",
] as const;

export const mistyFilesCommands = [
  "explorer.new_folder",
  "explorer.search",
  "explorer.rename",
  "explorer.batch_rename",
  "explorer.delete",
  "explorer.download",
  "explorer.open_with",
  "explorer.copy",
  "explorer.cut",
  "explorer.paste",
  "explorer.copy_path",
  "explorer.undo",
  "explorer.redo",
  "explorer.refresh",
  "explorer.duplicate_finder",
  "explorer.compare_with",
  "explorer.toggle_hidden",
  "explorer.preview.toggle",
  "explorer.preview_save",
  "explorer.sidebar.toggle",
] as const;

export const MistyAppCommandSchema = z.enum([
  ...mistyFilesCommands,
  ...mistyTerminalCommands,
  ...mistyPlannerCommands,
  ...mistyBrowserCommands,
  ...mistyCodeCommands,
]);

export function commandsForApp(appId: string): readonly MistyAppCommand[] {
  switch (appId) {
    case "files":
      return mistyFilesCommands;
    case "code":
      return mistyCodeCommands;
    case "terminal":
      return mistyTerminalCommands;
    case "planner":
      return mistyPlannerCommands;
    case "browser":
      return mistyBrowserCommands;
    case "chat":
    case "inbox":
      return ["navigation.back", "navigation.forward", "navigation.refresh"];
    default:
      return [];
  }
}

/** One ID per requested background job; increment revision only on a state transition. */
export const MistyActivityOperationSchema = z.strictObject({
  operationId: z.string().min(1).max(160),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["running", "blocked", "completed", "resolved"]),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(1000).optional(),
  route: z.string().max(2048).optional(),
});

export type MistyActivityOperation = z.input<typeof MistyActivityOperationSchema>;

export type MistyAppCommand = z.infer<typeof MistyAppCommandSchema>;

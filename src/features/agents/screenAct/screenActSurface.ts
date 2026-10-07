/**
 * Where a browser_act goal runs. A browser screen takes native page input; the
 * Misty window and the desktop take Misty's workspace actions, which reach
 * other apps through Accessibility with Misty's own cursor.
 */
export type ScreenSurface = "browser" | "workspace" | "desktop";

export type PlannedAction = Record<string, unknown> & { kind: string };

export interface SurfaceAdapter {
  capabilities: [string, string];
  visual: string;
  interact: string;
  /** The interact input for one planned action, or why it cannot run here. */
  input(
    action: PlannedAction,
    plan: { documentId: string; consequential: boolean; description: string },
  ): { input: Record<string, unknown> } | { unsupported: string };
  /** Where the action leaves Misty's cursor, when the device does not report it. */
  cursor(action: PlannedAction): { x: number; y: number } | undefined;
}

export const workspaceKeys = [
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "SelectAll",
  "Undo",
  "AddressBar",
  "NewTab",
  "Find",
] as const;

export function screenSurface(config: unknown): ScreenSurface {
  const surface = (config as { surface?: unknown } | null)?.surface;
  return surface === "desktop" || surface === "workspace" ? surface : "browser";
}

const pointer = (action: PlannedAction) =>
  typeof action.x === "number" && typeof action.y === "number"
    ? { x: action.x, y: action.y }
    : undefined;

const browserAdapter: SurfaceAdapter = {
  capabilities: ["browser.visual", "browser.interact"],
  visual: "browser.visual",
  interact: "browser.interact",
  input: (action, plan) => ({
    input: {
      documentId: plan.documentId,
      consequential: plan.consequential,
      description: plan.description,
      action: { kind: "native", input: action },
    },
  }),
  cursor: (action) =>
    action.kind === "drag" ? { x: Number(action.toX), y: Number(action.toY) } : pointer(action),
};

function workspaceAction(action: PlannedAction): Record<string, unknown> | string {
  switch (action.kind) {
    case "click":
      return { kind: "point", x: action.x, y: action.y };
    case "scroll":
      return {
        kind: "scroll",
        x: action.x,
        y: action.y,
        deltaX: action.deltaX,
        deltaY: action.deltaY,
      };
    case "type":
      return { kind: "type", text: action.text };
    case "key":
      return (workspaceKeys as readonly string[]).includes(String(action.key))
        ? { kind: "key", key: action.key }
        : `The key ${String(action.key)} is not available here. Use one of: ${workspaceKeys.join(", ")}.`;
    default:
      return `${action.kind} is not available here; use click, type, key or scroll.`;
  }
}

const workspaceAdapter: SurfaceAdapter = {
  capabilities: ["browser.workspace.visual", "browser.workspace.interact"],
  visual: "browser.workspace.visual",
  interact: "browser.workspace.interact",
  input: (action, plan) => {
    const mapped = workspaceAction(action);
    return typeof mapped === "string"
      ? { unsupported: mapped }
      : { input: { documentId: plan.documentId, action: mapped } };
  },
  cursor: pointer,
};

export const surfaceAdapter = (surface: ScreenSurface): SurfaceAdapter =>
  surface === "browser" ? browserAdapter : workspaceAdapter;

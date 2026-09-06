import type { DockWidgetDescriptor, WorkspaceSurfaceId } from "./model";
import {
  createBrowserTabState,
  createCodeTabState,
  parseBrowserTabState,
  parseCodeTabState,
} from "./model";

const identityState = {
  create: () => ({}),
  serialize: (state: unknown) => state,
  restore: (snapshot: unknown) => snapshot ?? {},
};

const defaults: Record<WorkspaceSurfaceId, DockWidgetDescriptor> = {
  home: descriptor("home", "singleton", "suspend", 360, 240),
  inbox: descriptor("inbox", "singleton", "suspend", 520, 280),
  space: descriptor("space", "per-space", "suspend", 360, 240),
  browser: {
    ...descriptor("browser", "multiple", "keep-alive", 360, 240),
    create: createBrowserTabState,
    serialize: parseBrowserTabState,
    restore: parseBrowserTabState,
  },
  terminal: descriptor("terminal", "multiple", "keep-alive", 320, 180),
  code: {
    ...descriptor("code", "multiple", "keep-alive", 480, 280),
    create: createCodeTabState,
    serialize: parseCodeTabState,
    restore: parseCodeTabState,
  },
  files: descriptor("files", "multiple", "suspend", 360, 240),
  transfers: descriptor("transfers", "singleton", "suspend", 360, 240),
  agents: descriptor("agents", "singleton", "suspend", 360, 240),
  "official-app": descriptor("official-app", "multiple", "keep-alive", 420, 280),
  extension: descriptor("extension", "multiple", "keep-alive", 420, 280),
  marketplace: descriptor("marketplace", "singleton", "suspend", 360, 240),
};

function descriptor(
  kind: WorkspaceSurfaceId,
  instancePolicy: DockWidgetDescriptor["instancePolicy"],
  mountPolicy: DockWidgetDescriptor["mountPolicy"],
  width: number,
  height: number,
): DockWidgetDescriptor {
  return {
    kind,
    instancePolicy,
    mountPolicy,
    minimumSize: { width, height },
    ...identityState,
  };
}

class DockWidgetRegistry {
  private descriptors = new Map<WorkspaceSurfaceId, DockWidgetDescriptor>(
    Object.values(defaults).map((entry) => [entry.kind, entry]),
  );

  get(kind: WorkspaceSurfaceId): DockWidgetDescriptor {
    return this.descriptors.get(kind) ?? defaults.space;
  }

  register<TState>(descriptor: DockWidgetDescriptor<TState>): () => void {
    const previous = this.descriptors.get(descriptor.kind);
    this.descriptors.set(descriptor.kind, descriptor as DockWidgetDescriptor);
    return () => {
      if (previous) this.descriptors.set(descriptor.kind, previous);
      else this.descriptors.delete(descriptor.kind);
    };
  }
}

export const dockWidgetRegistry = new DockWidgetRegistry();

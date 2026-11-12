import type { DockWidgetDescriptor, WorkspaceSurfaceId } from "../tabs/workspaceViews";

const identityState = {
  create: () => ({}),
  serialize: (state: unknown) => state,
  restore: (snapshot: unknown) => snapshot ?? {},
};

const defaults: Record<WorkspaceSurfaceId, DockWidgetDescriptor> = {
  space: descriptor("space", "per-space", "suspend", 360, 240),
  agents: descriptor("agents", "singleton", "suspend", 360, 240),
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

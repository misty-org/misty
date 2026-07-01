import type { WorkspaceVirtualWindow } from "@/features/workspace/model";
import { deviceSelection, sameValue, workspaceChanges } from "./changes";
import type { EditJournal } from "./editJournal";
import type { NativeSyncView } from "./native";
import { recordChanges } from "./recordChanges";
import type { Resume, DeviceSelection, SharedRecord, WorkspaceChange } from "./model";
import { projectWorkspace, type ProjectedWorkspace } from "./projection";

export interface WorkspaceSource {
  read(): {
    windows: WorkspaceVirtualWindow[];
    activeWindowId: string;
    groups?: SharedRecord<"group">[];
    websites?: SharedRecord<"website">[];
  };
  write(projected: ProjectedWorkspace): void;
  subscribe(changed: () => void): () => void;
}
interface Ports {
  source: WorkspaceSource;
  journal: EditJournal;
  read(): Promise<NativeSyncView | null>;
  publish(sessionId: string, operationId: string, changes: WorkspaceChange[]): Promise<string>;
  publishResume?(sessionId: string, operationId: string, resume: Resume): Promise<string>;
  state(view: NativeSyncView): void;
  error(error: unknown): void;
  locked?(): void;
  closed?(): void;
  captureDelayMs?: number;
}

/** A newly enrolled device has no document yet. Wait for authenticated replay
 * before treating an empty local snapshot as an empty remote workspace. Cached
 * documents and durable local edits can still open while offline. */
export function canProjectWorkspace(view: NativeSyncView): boolean {
  return (
    view.workspace.sequence > 0 ||
    view.pending_operation_ids.length > 0 ||
    ((view.status.phase === "catching_up" || view.status.phase === "ready") &&
      view.status.applied_sequence >= view.status.head_sequence)
  );
}

/** One bridge per visible account. Native remains the durable authority; this
 * bridge captures user deltas and suppresses capture during incoming projection. */
export class WorkspaceSyncController {
  private active = true;
  private applying = false;
  private running = false;
  private dirty = false;
  private captureBlocked = false;
  private previous: WorkspaceVirtualWindow[];
  private previousNavigation: SharedRecord[];
  private previousResume: Resume | null = null;
  private followedSequence = 0;
  private unsubscribe: () => void;
  private captureTimer?: ReturnType<typeof setTimeout>;
  private captureDeadline?: ReturnType<typeof setTimeout>;
  constructor(
    private current: NativeSyncView,
    private ports: Ports,
  ) {
    if (!canProjectWorkspace(current))
      throw new Error("Waiting for the server workspace before starting device sync");
    this.previous = ports.source.read().windows;
    this.previousNavigation = navigationRecords(ports.source.read());
    // An empty first vault adopts the existing browser workspace once. A
    // reconnect with queued edits uses its original journal IDs instead.
    const seed =
      !current.workspace.records.length &&
      current.workspace.sequence === 0 &&
      current.status.head_sequence === 0 &&
      !current.pending_operation_ids.length &&
      !ports.journal.pending.length;
    if (seed)
      ports.journal.append([
        ...workspaceChanges([], this.previous, current.profile_id).changes,
        ...recordChanges([], this.previousNavigation),
      ]);
    else if (!ports.journal.pending.length) {
      const selection = ports.source.read();
      ports.source.write(projectWorkspace(current.workspace, this.selection(current, selection)));
      this.previous = ports.source.read().windows;
      this.previousNavigation = navigationRecords(ports.source.read());
    }
    this.previousResume = workspaceResume(ports.source.read());
    if (seed && this.previousResume && ports.publishResume)
      ports.journal.appendResume(this.previousResume);
    this.unsubscribe = ports.source.subscribe(() => this.scheduleCapture());
    this.refresh();
  }
  stop(): void {
    if (!this.active) return;
    this.flushCapture();
    void this.ports.journal.flush().catch((error: unknown) => this.ports.error(error));
    this.active = false;
    this.unsubscribe();
    this.ports.closed?.();
  }
  async flushLocal(): Promise<void> {
    this.flushCapture();
    await this.ports.journal.flush();
  }
  private scheduleCapture(): void {
    if (!this.active || this.applying) return;
    const delay = this.ports.captureDelayMs ?? 0;
    if (!delay) {
      this.capture();
      return;
    }
    clearTimeout(this.captureTimer);
    this.captureTimer = setTimeout(() => this.flushCapture(), delay);
    this.captureDeadline ??= setTimeout(() => this.flushCapture(), 2_000);
  }
  private flushCapture(): void {
    if (!this.captureTimer && !this.captureDeadline) return;
    clearTimeout(this.captureTimer);
    clearTimeout(this.captureDeadline);
    this.captureTimer = undefined;
    this.captureDeadline = undefined;
    this.capture();
  }
  refresh(): void {
    if (!this.active) return;
    if (this.captureBlocked) this.capture(false);
    this.dirty = true;
    if (!this.running) void this.pump();
  }
  private capture(refresh = true): void {
    if (!this.active || this.applying) return;
    const source = this.ports.source.read();
    try {
      const edit = workspaceChanges(this.previous, source.windows, this.current.profile_id);
      const navigation = navigationRecords(source);
      const changes = [...edit.changes, ...recordChanges(this.previousNavigation, navigation)];
      if (changes.length) this.ports.journal.append(changes);
      if (edit.remapped.size) {
        this.applying = true;
        try {
          this.ports.source.write({
            windows: edit.windows,
            activeWindowId: edit.remapped.get(source.activeWindowId) ?? source.activeWindowId,
            groups: source.groups ?? [],
            websites: source.websites ?? [],
            recoveryTabIds: [],
          });
        } finally {
          this.applying = false;
        }
      }
      this.previous = this.ports.source.read().windows;
      this.previousNavigation = navigation;
      const resume = workspaceResume(this.ports.source.read());
      const resumeChanged = resume && !sameValue(resume, this.previousResume);
      if (resumeChanged && this.ports.publishResume) this.ports.journal.appendResume(resume);
      this.previousResume = resume;
      this.captureBlocked = false;
      if (refresh && (changes.length || resumeChanged)) this.refresh();
    } catch (error) {
      // Do not erase the user's visible edit. The existing workspace backup
      // retains it, and the error remains actionable rather than claiming sync.
      this.captureBlocked = true;
      this.ports.error(error);
    }
  }
  private selection(
    view: NativeSyncView,
    source: ReturnType<WorkspaceSource["read"]>,
  ): DeviceSelection {
    const selection = deviceSelection(source.windows, source.activeWindowId);
    // Server sequence, rather than wall clocks, orders which device last moved
    // focus. Applying it updates our baseline without publishing it back.
    const latest = Object.entries(view.workspace.resumes).sort(
      (a, b) => b[1].sequence - a[1].sequence,
    )[0];
    if (!latest || latest[1].sequence <= this.followedSequence) return selection;
    this.followedSequence = latest[1].sequence;
    if (latest[0] === view.device_id) return selection;
    const resume = latest[1].resume;
    return {
      ...selection,
      activeWindowId: resume.active_window_id,
      activeLayoutByWindow: {
        ...selection.activeLayoutByWindow,
        [resume.active_window_id]: resume.active_layout_id,
      },
      focusedPaneByLayout: {
        ...selection.focusedPaneByLayout,
        [resume.active_layout_id]: resume.focused_pane_id,
      },
      activeTabByPane: { ...selection.activeTabByPane, ...resume.active_tab_by_pane },
    };
  }
  private matches(view: NativeSyncView): boolean {
    return (
      view.deployment === this.current.deployment &&
      view.account_id === this.current.account_id &&
      view.workspace_id === this.current.workspace_id &&
      view.device_id === this.current.device_id
    );
  }
  private async pump(): Promise<void> {
    this.running = true;
    try {
      while (this.active && (this.dirty || this.ports.journal.pending.length)) {
        // Preserve visible, not-yet-captured gestures if a remote notification
        // arrives during the debounce window. The bounded timer resumes work.
        if (this.captureTimer) return;
        this.dirty = false;
        await this.ports.journal.flush();
        if (!this.active) return;
        const latest = await this.ports.read();
        if (!this.active) return;
        if (!latest) {
          // Locking removes native keys, not the visible account's edit capture.
          // Keep recording metadata changes with their stable IDs while locked;
          // the next native event resumes delivery before applying remote state.
          this.ports.locked?.();
          return;
        }
        if (!this.matches(latest)) {
          this.stop();
          return;
        }
        this.current = latest;
        // A reconnection may have a new session ID but the same durable device.
        // Drain the stable journal before applying a projection to the renderer.
        while (this.active && this.ports.journal.pending.length) {
          await this.ports.journal.flush();
          if (!this.active) return;
          const edit = this.ports.journal.pending[0];
          const accepted = edit.resume
            ? await this.ports.publishResume!(this.current.session_id, edit.id, edit.resume)
            : await this.ports.publish(this.current.session_id, edit.id, edit.changes);
          if (!this.active) return;
          if (accepted !== edit.id) throw new Error("Native sync acknowledged a different edit");
          this.ports.journal.acknowledge(edit.id);
          await this.ports.journal.flush();
          this.dirty = true;
        }
        if (this.dirty) continue;
        // A storage failure must not let an in-flight read replace an edit
        // that has not reached the durable journal. A later refresh retries it.
        if (this.captureBlocked || this.captureTimer) return;
        const selection = this.ports.source.read();
        const projected = projectWorkspace(latest.workspace, this.selection(latest, selection));
        this.applying = true;
        try {
          this.ports.source.write(projected);
        } finally {
          this.applying = false;
        }
        this.previous = this.ports.source.read().windows;
        this.previousNavigation = navigationRecords(this.ports.source.read());
        this.previousResume = workspaceResume(this.ports.source.read());
        this.ports.state(latest);
      }
    } catch (error) {
      if (this.active) this.ports.error(error);
    } finally {
      this.running = false;
    }
  }
}

function navigationRecords(source: ReturnType<WorkspaceSource["read"]>): SharedRecord[] {
  return [...(source.groups ?? []), ...(source.websites ?? [])];
}

function workspaceResume(source: ReturnType<WorkspaceSource["read"]>): Resume | null {
  const selection = deviceSelection(source.windows, source.activeWindowId);
  const layout = selection.activeLayoutByWindow[source.activeWindowId];
  const pane = selection.focusedPaneByLayout[layout];
  if (!source.activeWindowId || !layout || !pane) return null;
  return {
    active_window_id: source.activeWindowId,
    active_layout_id: layout,
    focused_pane_id: pane,
    active_tab_by_pane: selection.activeTabByPane,
  };
}

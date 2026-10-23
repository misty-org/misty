import { sameValue } from "./changes";
import { WorkspaceCapture, type Ports } from "./controllerCapture";
import { groupsSynced, localGroups, localSelection, projectionContent } from "./controllerSnapshot";
import { activeDeviceEpoch, type NativeSyncView } from "./native";
import { projectWorkspace } from "./projection";

/** A newly enrolled device has no document yet. Wait for authenticated replay
 * before treating an empty local snapshot as an empty remote workspace. Cached
 * documents and durable local edits can still open while offline. */
export function canProjectWorkspace(view: NativeSyncView): boolean {
  return (
    view.full_sync !== false &&
    (view.workspace.sequence > 0 ||
      view.pending_operation_ids.length > 0 ||
      ((view.status.phase === "catching_up" || view.status.phase === "ready") &&
        view.status.applied_sequence >= view.status.head_sequence))
  );
}

/** One bridge per visible account. Native remains the durable authority; this
 * bridge captures user deltas and suppresses capture during incoming projection. */
export class WorkspaceSyncController extends WorkspaceCapture {
  private running = false;
  private dirty = false;
  private unsubscribe: () => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  /** An edit is on its way to native, so a failure now retries it. */
  private publishing = false;
  private projectedContent: unknown;
  private scheduled = false;
  constructor(current: NativeSyncView, ports: Ports) {
    super(current, ports);
    if (!canProjectWorkspace(current))
      throw new Error("Waiting for the server workspace before starting device sync");
    this.rememberSource();
    // An empty first vault adopts the existing browser workspace once. A
    // reconnect with queued edits uses its original journal IDs instead.
    ports.journal.retainActiveEpoch(activeDeviceEpoch(current));
    const seed = this.seed();
    if (!seed && !ports.journal.pending.length && !this.unselectedEmpty(current)) {
      const selection = ports.source.read();
      ports.source.write(
        projectWorkspace(
          current.workspace,
          localSelection(selection),
          localGroups(current, selection),
        ),
      );
      this.projectedContent = projectionContent(current.workspace);
      this.rememberSource();
    }
    this.unsubscribe = ports.source.subscribe(() => this.scheduleCapture());
    this.refresh();
  }
  stop(): void {
    if (!this.active) return;
    this.flushCapture();
    void this.ports.journal.flush().catch((error: unknown) => this.ports.error(error));
    this.active = false;
    clearTimeout(this.retryTimer);
    this.unsubscribe();
    this.ports.closed?.();
  }
  async flushLocal(): Promise<void> {
    this.flushCapture();
    await this.ports.journal.flush();
  }
  /** Native notifications arrive in bursts (another machine opening many
   * tabs). Notifications in one tick share a pump, and any arriving while it
   * reads are folded into its next pass: one projection per burst. */
  refresh(): void {
    if (!this.active) return;
    if (this.captureBlocked) this.capture(false);
    this.dirty = true;
    if (this.running || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.active && !this.running) void this.pump();
    });
  }
  private matches(view: NativeSyncView): boolean {
    return (
      view.deployment === this.current.deployment &&
      view.account_id === this.current.account_id &&
      view.vault_id === this.current.vault_id &&
      view.device_id === this.current.device_id
    );
  }
  private unselectedEmpty(view: NativeSyncView): boolean {
    return !view.workspace.active_device && !view.workspace.records.length;
  }
  private async publishJournal(): Promise<boolean> {
    // A reconnection may have a new session ID but the same durable device.
    // Drain the stable journal before applying a projection to the renderer.
    while (this.active && this.ports.journal.pending.length) {
      await this.ports.journal.flush();
      if (!this.active) return false;
      const edit = this.ports.journal.pending[0];
      // Selection no longer syncs; an older journal's focus entry is dropped.
      if (edit.resume) {
        this.ports.journal.acknowledge(edit.id);
        continue;
      }
      this.publishing = true;
      const accepted = await this.ports.publish(
        this.current.session_id,
        edit.id,
        edit.changes,
        edit.activeEpoch!,
      );
      this.publishing = false;
      if (!this.active) return false;
      if (accepted !== edit.id) throw new Error("Native sync acknowledged a different edit");
      this.ports.journal.acknowledge(edit.id);
      await this.ports.journal.flush();
      this.failures = 0;
      this.dirty = true;
    }
    return this.active;
  }
  /** Shows the latest remote content, keeping this machine's own selection. */
  private project(latest: NativeSyncView): void {
    const content = projectionContent(latest.workspace);
    // Transport heartbeats and credential receipts are not navigation.
    // Re-projecting them can repeatedly reload a follower's redirected page.
    if (sameValue(content, this.projectedContent)) return;
    // Remote edits only populate data: this machine's selection is its own.
    const visible = this.ports.source.read();
    const projected = projectWorkspace(
      latest.workspace,
      localSelection(visible),
      localGroups(latest, visible),
    );
    this.applying = true;
    try {
      this.ports.source.write(projected);
      this.projectedContent = content;
    } finally {
      this.applying = false;
    }
    this.rememberSource();
    this.ports.state(latest);
  }
  private async pump(): Promise<void> {
    this.running = true;
    let changedPublisher = false;
    this.publishing = false;
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
        const wasIndependent = this.current.full_sync === false;
        const groupsStarted = !groupsSynced(this.current) && groupsSynced(latest);
        if (
          wasIndependent ||
          latest.session_id !== this.current.session_id ||
          activeDeviceEpoch(latest) !== activeDeviceEpoch(this.current)
        ) {
          clearTimeout(this.retryTimer);
          this.retryTimer = undefined;
          this.failures = 0;
        }
        this.current = latest;
        // Every device now syncs tab groups: send this machine's before any
        // projection, so the (still empty) synced list never replaces them.
        if (groupsStarted) this.capture(false);
        this.ports.state(latest, this.failures > 0 && this.ports.journal.pending.length > 0);
        if (latest.full_sync === false) {
          // Keep local browsing and its durable journal intact while continuing
          // to observe connection/policy changes. Never project remote content.
          this.rememberSource();
          return;
        }
        if (wasIndependent) this.projectedContent = null;
        this.ports.journal.retainActiveEpoch(activeDeviceEpoch(latest));
        this.seed();
        // Other profiles keep sending legitimate events while one local edit
        // fails. Read those updates, but do not retry the rejected edit for
        // every notification (or project over the unsent local change).
        if (this.retryTimer && this.ports.journal.pending.length) return;
        if (!(await this.publishJournal())) return;
        if (this.dirty) continue;
        // A storage failure must not let an in-flight read replace an edit
        // that has not reached the durable journal. A later refresh retries it.
        if (this.captureBlocked || this.captureTimer) return;
        if (this.unselectedEmpty(latest)) return;
        this.project(latest);
      }
    } catch (error) {
      if (this.active) {
        // Control can move between our read and native acceptance. That is a
        // normal handoff: retire the old tenure's journal on the next pass.
        const latest = await this.ports.read().catch(() => null);
        if (
          latest &&
          this.matches(latest) &&
          activeDeviceEpoch(latest) !== activeDeviceEpoch(this.current)
        ) {
          this.current = latest;
          changedPublisher = true;
        } else {
          this.ports.error(error);
          if (this.publishing && !this.retryTimer && this.ports.journal.pending.length) {
            const delay = Math.min(1_000 * 2 ** Math.min(this.failures++, 5), 30_000);
            this.retryTimer = setTimeout(() => {
              this.retryTimer = undefined;
              this.refresh();
            }, delay);
          }
        }
      }
    } finally {
      this.running = false;
      if (changedPublisher && this.active) this.refresh();
    }
  }
}

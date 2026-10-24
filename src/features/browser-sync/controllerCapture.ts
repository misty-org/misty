import type { WorkspaceWindow } from "@/features/workspace/model";
import { workspaceChanges } from "./changes";
import { groupsSynced, navigationRecords, type WorkspaceSource } from "./controllerSnapshot";
import type { EditJournal } from "./editJournal";
import { activeDeviceEpoch, type NativeSyncView } from "./native";
import { recordChanges } from "./recordChanges";
import type { SharedRecord, WorkspaceChange } from "./model";

export interface Ports {
  source: WorkspaceSource;
  journal: EditJournal;
  read(): Promise<NativeSyncView | null>;
  publish(
    sessionId: string,
    operationId: string,
    changes: WorkspaceChange[],
    activeEpoch: string,
  ): Promise<string>;
  state(view: NativeSyncView, preserveIssue?: boolean): void;
  error(error: unknown): void;
  locked?(): void;
  closed?(): void;
  captureDelayMs?: number;
}

/** The capture half of the sync controller (controller.ts): turns the visible
 * workspace's edits into journal entries, and stays quiet while a projection
 * writes remote content into it. */
export abstract class WorkspaceCapture {
  protected active = true;
  protected applying = false;
  protected captureBlocked = false;
  protected previous: WorkspaceWindow[] = [];
  protected previousNavigation: SharedRecord[] = [];
  protected captureTimer?: ReturnType<typeof setTimeout>;
  private captureDeadline?: ReturnType<typeof setTimeout>;
  constructor(
    protected current: NativeSyncView,
    protected ports: Ports,
  ) {}
  abstract refresh(): void;
  protected scheduleCapture(): void {
    if (!this.active || this.applying) return;
    if (!activeDeviceEpoch(this.current)) {
      this.capture();
      return;
    }
    const delay = this.ports.captureDelayMs ?? 0;
    if (!delay) {
      this.capture();
      return;
    }
    clearTimeout(this.captureTimer);
    this.captureTimer = setTimeout(() => this.flushCapture(), delay);
    this.captureDeadline ??= setTimeout(() => this.flushCapture(), 2_000);
  }
  protected flushCapture(): void {
    if (!this.captureTimer && !this.captureDeadline) return;
    clearTimeout(this.captureTimer);
    clearTimeout(this.captureDeadline);
    this.captureTimer = undefined;
    this.captureDeadline = undefined;
    this.capture();
  }
  protected capture(refresh = true): void {
    if (!this.active || this.applying) return;
    const source = this.ports.source.read();
    const epoch = activeDeviceEpoch(this.current);
    if (!epoch) {
      this.rememberSource();
      this.captureBlocked = false;
      return;
    }
    try {
      const edit = workspaceChanges(this.previous, source.windows, this.current.profile_id);
      const navigation = navigationRecords(source, groupsSynced(this.current));
      const changes = [...edit.changes, ...recordChanges(this.previousNavigation, navigation)];
      if (changes.length) this.ports.journal.append(changes, epoch);
      if (edit.remapped.size) {
        this.applying = true;
        try {
          this.ports.source.write({
            windows: edit.windows,
            activeWindowId: edit.remapped.get(source.activeWindowId) ?? source.activeWindowId,
            folders: source.folders ?? [],
            bookmarks: source.bookmarks ?? [],
            recoveryViewIds: [],
          });
        } finally {
          this.applying = false;
        }
      }
      this.previous = this.ports.source.read().windows;
      this.previousNavigation = navigation;
      this.captureBlocked = false;
      if (refresh && changes.length) this.refresh();
    } catch (error) {
      // Do not erase the user's visible edit. The existing workspace backup
      // retains it, and the error remains actionable rather than claiming sync.
      this.captureBlocked = true;
      this.ports.error(error);
    }
  }
  protected seed(): boolean {
    const view = this.current;
    const epoch = activeDeviceEpoch(view);
    if (
      !epoch ||
      view.workspace.records.length ||
      view.pending_operation_ids.length ||
      this.ports.journal.pending.length
    )
      return false;
    const source = this.ports.source.read();
    const changes = [
      ...workspaceChanges([], source.windows, view.profile_id).changes,
      ...recordChanges([], navigationRecords(source, groupsSynced(this.current))),
    ];
    if (!changes.length) return false;
    this.ports.journal.append(changes, epoch);
    return true;
  }
  protected rememberSource(): void {
    const source = this.ports.source.read();
    this.previous = source.windows;
    this.previousNavigation = navigationRecords(source, groupsSynced(this.current));
  }
  /** Sends the journal's edits in order. False when the controller stopped meanwhile. */
}

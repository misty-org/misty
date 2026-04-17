package syncindex

import (
	"context"
	"fmt"
	"log"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/kannachi323/misty/proxy/core/rclone"
	dbpkg "github.com/kannachi323/misty/proxy/db"
)

const (
	// maxReconcileRetries caps how many failed attempts we'll make against a
	// single dirty entry before leaving it alone. The row stays dirty and
	// retains its last_error so a human can look at it; new FSEvents activity
	// will reset retry_count via the ClearSyncEntryDirty → success path.
	maxReconcileRetries = 5
	// reconcileBatchLimit bounds how many entries a single tick will handle.
	// At 30s cadence this is a generous budget for typical workloads without
	// letting one pathological root starve the others.
	reconcileBatchLimit = 100
)

// Reconciler applies pending dirty sync_entries to the real filesystems.
// Direction is already decided by reconcileState in service.go; the reconciler
// only executes, records failures, and clears the dirty bit on success.
// Conflict policy is "prefer remote": for any pull-style operation that would
// overwrite an existing local file, the local copy is moved aside to
// "<name>.tmp" first so the user can recover manually.
type Reconciler struct {
	service *Service
}

func NewReconciler(service *Service) *Reconciler {
	return &Reconciler{service: service}
}

// ReconcileRoot drains up to reconcileBatchLimit dirty entries for the given
// root. Per-entry failures are recorded on the row (retry_count++,
// last_error) so the entry comes back on a later tick; they never abort the
// outer loop because one bad file shouldn't starve the rest. After the pass
// the root's dirty_bit is refreshed from the aggregate state so the UI badge
// clears as soon as everything has been drained.
func (r *Reconciler) ReconcileRoot(ctx context.Context, root dbpkg.SyncRoot) error {
	if r == nil || r.service == nil || r.service.database == nil || r.service.database.Conn == nil {
		return nil
	}
	if !rclone.RemoteExists(root.RemoteName) {
		return nil
	}

	entries, err := dbpkg.ListDirtySyncEntries(r.service.database.Conn, root.ID, reconcileBatchLimit)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.RetryCount >= maxReconcileRetries {
			continue
		}
		if err := r.reconcileEntry(ctx, root, entry); err != nil {
			log.Printf("syncindex reconciler: %s:%s (%s): %v",
				root.RemoteName, entry.RelPath, entry.SyncDirection, err)
			now := dbpkg.NowRFC3339()
			if bumpErr := dbpkg.IncrementSyncEntryRetry(r.service.database.Conn, entry.ID, err.Error(), now); bumpErr != nil {
				log.Printf("syncindex reconciler: record failure for %s: %v", entry.ID, bumpErr)
			}
		}
	}

	stillDirty, err := dbpkg.RootHasDirtyEntries(r.service.database.Conn, root.ID)
	if err != nil {
		return err
	}
	return dbpkg.SetSyncRootDirtyBit(r.service.database.Conn, root.ID, stillDirty, "")
}

func (r *Reconciler) reconcileEntry(ctx context.Context, root dbpkg.SyncRoot, entry dbpkg.SyncEntry) error {
	switch entry.SyncDirection {
	case "push":
		return r.push(ctx, root, entry)
	case "pull":
		return r.pull(ctx, root, entry)
	case "conflict":
		return r.pullWithBackup(ctx, root, entry)
	case "none", "":
		// Direction says nothing to do, but the row is still dirty — a
		// prior reconcileState must have flipped direction to "none"
		// without clearing is_dirty. Clear it now.
		return r.markReconciled(entry)
	default:
		return fmt.Errorf("unknown sync_direction %q", entry.SyncDirection)
	}
}

func (r *Reconciler) push(ctx context.Context, root dbpkg.SyncRoot, entry dbpkg.SyncEntry) error {
	switch {
	case !entry.LocalExists:
		// Local was deleted (or never existed) — propagate the delete to
		// remote. If the remote was already gone, don't retry forever;
		// treat it as success so the dead row drops cleanly.
		if err := rclone.DeletePath(ctx, root.RemoteName, entry.RelPath); err != nil && !isNotFoundErr(err) {
			return fmt.Errorf("delete remote: %w", err)
		}
		return dbpkg.DeleteSyncEntry(r.service.database.Conn, entry.ID)

	case entry.IsDir:
		if err := rclone.MkDir(ctx, root.RemoteName, entry.RelPath); err != nil {
			return fmt.Errorf("mkdir remote: %w", err)
		}
		return r.markReconciled(entry)

	default:
		localPath := buildLocalPath(root, entry.RelPath)
		f, err := os.Open(localPath)
		if err != nil {
			return fmt.Errorf("open local: %w", err)
		}
		defer f.Close()

		stat, err := f.Stat()
		if err != nil {
			return fmt.Errorf("stat local: %w", err)
		}

		dirPath := path.Dir(entry.RelPath)
		// path.Dir("file.txt") returns ".", but rclone distinguishes
		// "remote:" (root) from "remote:." — normalize to the root form.
		if dirPath == "." {
			dirPath = ""
		}
		fileName := path.Base(entry.RelPath)
		if err := rclone.UploadFile(ctx, root.RemoteName, dirPath, fileName, stat.Size(), f); err != nil {
			return fmt.Errorf("upload: %w", err)
		}
		return r.markReconciled(entry)
	}
}

func (r *Reconciler) pull(ctx context.Context, root dbpkg.SyncRoot, entry dbpkg.SyncEntry) error {
	if !entry.RemoteExists {
		// Remote is gone but pull direction was chosen — likely a stale
		// classification. Don't delete the local file (could be real user
		// content); just clear the dirty bit.
		return r.markReconciled(entry)
	}
	if entry.IsDir {
		localPath := buildLocalPath(root, entry.RelPath)
		if err := os.MkdirAll(localPath, 0o755); err != nil {
			return fmt.Errorf("mkdir local: %w", err)
		}
		return r.markReconciled(entry)
	}
	// Pure pull with no local file: download straight through. If there is
	// a local file and reconcileState still picked "pull" (remote strictly
	// newer), overwrite is intended — no .tmp needed.
	return r.pullFile(ctx, root, entry, false)
}

func (r *Reconciler) pullWithBackup(ctx context.Context, root dbpkg.SyncRoot, entry dbpkg.SyncEntry) error {
	if !entry.RemoteExists {
		return r.markReconciled(entry)
	}
	if entry.IsDir {
		localPath := buildLocalPath(root, entry.RelPath)
		if err := os.MkdirAll(localPath, 0o755); err != nil {
			return fmt.Errorf("mkdir local: %w", err)
		}
		return r.markReconciled(entry)
	}
	return r.pullFile(ctx, root, entry, true)
}

// pullFile downloads a single remote file to local, publishing atomically via
// download-to-"<name>.download" + rename. When backupLocal is set and a local
// file already exists, it is moved aside to "<name>.tmp" before the rename so
// the user can recover the pre-sync contents if the chosen-remote policy went
// the wrong way.
func (r *Reconciler) pullFile(ctx context.Context, root dbpkg.SyncRoot, entry dbpkg.SyncEntry, backupLocal bool) error {
	localPath := buildLocalPath(root, entry.RelPath)

	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return fmt.Errorf("mkdir parent: %w", err)
	}

	if backupLocal && entry.LocalExists {
		backup := localPath + ".tmp"
		if err := os.Rename(localPath, backup); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("backup local: %w", err)
		}
	}

	tmp := localPath + ".download"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("create tmp: %w", err)
	}
	// Tidy up on any early-return path. Close is idempotent enough that a
	// successful Close before rename followed by this defer is harmless;
	// Remove on an already-renamed file returns ENOENT which we ignore.
	cleanup := true
	defer func() {
		if cleanup {
			_ = out.Close()
			_ = os.Remove(tmp)
		}
	}()

	if _, err := rclone.DownloadFile(ctx, root.RemoteName, entry.RelPath, out); err != nil {
		return fmt.Errorf("download: %w", err)
	}
	if err := out.Close(); err != nil {
		return fmt.Errorf("close tmp: %w", err)
	}
	if err := os.Rename(tmp, localPath); err != nil {
		return fmt.Errorf("publish: %w", err)
	}
	cleanup = false
	return r.markReconciled(entry)
}

func (r *Reconciler) markReconciled(entry dbpkg.SyncEntry) error {
	return dbpkg.ClearSyncEntryDirty(r.service.database.Conn, entry.ID, dbpkg.NowRFC3339())
}

// isNotFoundErr recognises the "object missing" errors surfaced by
// rclone.DeletePath when the remote path doesn't exist. rclone's fs package
// returns varied typed errors across backends, so this is a substring match
// against the wrappings our operations layer produces plus the common rclone
// fallback strings.
func isNotFoundErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") ||
		strings.Contains(msg, "doesn't exist") ||
		strings.Contains(msg, "does not exist")
}

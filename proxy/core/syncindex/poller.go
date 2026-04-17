package syncindex

import (
	"context"
	"log"
	"os"
	"strconv"
	"sync"
	"time"

	dbpkg "github.com/kannachi323/misty/proxy/db"
	"github.com/kannachi323/misty/proxy/core/rclone"
)

// Poller refetches every enabled sync root on a fixed cadence so the DB
// catches remote-side drift (e.g. the user edits a file in the Google Drive
// web UI) without waiting for a manual refresh. For each root it reruns
// RefetchDirectory on every distinct parent_rel_path that already has rows
// — i.e. every directory the user has ever browsed — which keeps cost bounded
// to the working set rather than the full cloud tree.
type Poller struct {
	service    *Service
	reconciler *Reconciler
	interval   time.Duration

	startOnce sync.Once
	stopOnce  sync.Once
	stop      chan struct{}
	done      chan struct{}
}

func NewPoller(service *Service, interval time.Duration) *Poller {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &Poller{
		service:    service,
		reconciler: NewReconciler(service),
		interval:   interval,
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
	}
}

// PollIntervalFromEnv reads MISTY_SYNC_POLL_SEC and falls back to the provided
// default (seconds) when unset or invalid. Values <= 0 also fall back.
func PollIntervalFromEnv(defaultSec int) time.Duration {
	if s := os.Getenv("MISTY_SYNC_POLL_SEC"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	if defaultSec <= 0 {
		defaultSec = 30
	}
	return time.Duration(defaultSec) * time.Second
}

func (p *Poller) Start() {
	if p == nil {
		return
	}
	p.startOnce.Do(func() {
		go p.run()
	})
}

func (p *Poller) Stop() {
	if p == nil {
		return
	}
	p.stopOnce.Do(func() {
		close(p.stop)
	})
	<-p.done
}

func (p *Poller) run() {
	defer close(p.done)

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-p.stop:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), p.interval)
			if err := p.Tick(ctx); err != nil {
				log.Println("syncindex poller:", err)
			}
			cancel()
		}
	}
}

// RunNow runs an out-of-band poll pass on demand, bypassing the wall-clock
// ticker. If remoteName is empty every enabled root is processed (same work
// as one Tick). If set, only the matching root is refetched + reconciled so
// a user-initiated refresh is fast and scoped to what they're looking at.
// Returns the refetched-directory count and the dirty-entry count seen going
// in, so the API can report something useful to the caller.
func (p *Poller) RunNow(ctx context.Context, remoteName string) (int, int, error) {
	if p == nil || p.service == nil || p.service.database == nil || p.service.database.Conn == nil {
		return 0, 0, nil
	}

	roots, err := dbpkg.ListEnabledSyncRoots(p.service.database.Conn)
	if err != nil {
		return 0, 0, err
	}
	if remoteName != "" {
		filtered := roots[:0]
		for _, root := range roots {
			if root.RemoteName == remoteName {
				filtered = append(filtered, root)
			}
		}
		roots = filtered
	}

	now := dbpkg.NowRFC3339()
	var refetchedDirs, dirtyBefore int
	for _, root := range roots {
		if err := ctx.Err(); err != nil {
			return refetchedDirs, dirtyBefore, err
		}
		if !rclone.RemoteExists(root.RemoteName) {
			continue
		}

		dirs, err := dbpkg.ListSyncEntryDirectories(p.service.database.Conn, root.ID)
		if err != nil {
			log.Printf("syncindex run-now: list dirs for %s: %v", root.RemoteName, err)
			continue
		}
		if len(dirs) == 0 {
			dirs = []string{""}
		}

		for _, dir := range dirs {
			if err := ctx.Err(); err != nil {
				return refetchedDirs, dirtyBefore, err
			}
			if _, err := p.service.RefetchDirectory(ctx, root.RemoteName, dir); err != nil {
				log.Printf("syncindex run-now: refetch %s:%s: %v", root.RemoteName, dir, err)
				continue
			}
			refetchedDirs++
		}

		dirty, err := dbpkg.ListDirtySyncEntries(p.service.database.Conn, root.ID, reconcileBatchLimit)
		if err != nil {
			log.Printf("syncindex run-now: list dirty %s: %v", root.RemoteName, err)
		} else {
			dirtyBefore += len(dirty)
		}

		if p.reconciler != nil {
			if err := p.reconciler.ReconcileRoot(ctx, root); err != nil {
				log.Printf("syncindex run-now: reconcile %s: %v", root.RemoteName, err)
			}
		}

		if err := dbpkg.SetSyncRootLastPollAt(p.service.database.Conn, root.ID, now); err != nil {
			log.Printf("syncindex run-now: stamp last_poll_at for %s: %v", root.RemoteName, err)
		}
	}
	return refetchedDirs, dirtyBefore, nil
}

// Tick runs one poll pass. Exposed so tests can drive it deterministically
// without relying on the wall-clock ticker.
func (p *Poller) Tick(ctx context.Context) error {
	if p == nil || p.service == nil || p.service.database == nil || p.service.database.Conn == nil {
		return nil
	}

	roots, err := dbpkg.ListEnabledSyncRoots(p.service.database.Conn)
	if err != nil {
		return err
	}

	now := dbpkg.NowRFC3339()
	for _, root := range roots {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !rclone.RemoteExists(root.RemoteName) {
			continue
		}

		dirs, err := dbpkg.ListSyncEntryDirectories(p.service.database.Conn, root.ID)
		if err != nil {
			log.Printf("syncindex poller: list dirs for %s: %v", root.RemoteName, err)
			continue
		}
		if len(dirs) == 0 {
			// No rows yet — seed the top level so at least the root gets
			// scanned on first poll after a new remote is added.
			dirs = []string{""}
		}

		for _, dir := range dirs {
			if err := ctx.Err(); err != nil {
				return err
			}
			if _, err := p.service.RefetchDirectory(ctx, root.RemoteName, dir); err != nil {
				log.Printf("syncindex poller: refetch %s:%s: %v", root.RemoteName, dir, err)
			}
		}

		// Reconcile after refetch so the reconciler acts on a freshly
		// classified view of the world. A failure here is logged per-entry
		// inside ReconcileRoot; a hard error at the root level (e.g. the
		// dirty_bit update) is logged but shouldn't block other roots.
		if p.reconciler != nil {
			if err := p.reconciler.ReconcileRoot(ctx, root); err != nil {
				log.Printf("syncindex poller: reconcile %s: %v", root.RemoteName, err)
			}
		}

		if err := dbpkg.SetSyncRootLastPollAt(p.service.database.Conn, root.ID, now); err != nil {
			log.Printf("syncindex poller: stamp last_poll_at for %s: %v", root.RemoteName, err)
		}
	}
	return nil
}

package syncindex

import (
	"context"
	"log"
	"os"
	"strconv"
	"sync"
	"time"
)

type Manager struct {
	service             *Service
	watchInterval       time.Duration
	watchRefreshTimeout time.Duration

	mu      sync.Mutex
	watched map[string]struct{}

	startOnce sync.Once
	stopOnce  sync.Once
	stop      chan struct{}
	done      chan struct{}
}

func NewManager(service *Service, watchInterval time.Duration) *Manager {
	if watchInterval <= 0 {
		watchInterval = watchIntervalFromEnv(30)
	}
	return &Manager{
		service:             service,
		watchInterval:       watchInterval,
		watchRefreshTimeout: pollRefetchTimeoutForInterval(watchInterval),
		watched:             map[string]struct{}{},
		stop:                make(chan struct{}),
		done:                make(chan struct{}),
	}
}

func watchIntervalFromEnv(defaultSec int) time.Duration {
	if s := os.Getenv("MISTY_SYNC_WATCH_POLL_SEC"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	if defaultSec <= 0 {
		defaultSec = 30
	}
	return time.Duration(defaultSec) * time.Second
}

func (m *Manager) Start() {
	if m == nil {
		return
	}
	m.startOnce.Do(func() {
		if err := m.reloadWatchedDirs(); err != nil {
			log.Printf("syncindex: load watched dirs: %v", err)
		}
		go m.run()
	})
}

func (m *Manager) Stop() {
	if m == nil {
		return
	}
	m.stopOnce.Do(func() {
		close(m.stop)
	})
	<-m.done
}

func (m *Manager) RefreshDirectory(ctx context.Context, remoteName, dirPath string) (*DirectoryResponse, error) {
	if m == nil || m.service == nil {
		return nil, nil
	}
	return m.service.RefetchDirectory(ctx, remoteName, dirPath)
}

func (m *Manager) MarkLocalDirty(ctx context.Context, remoteName, relPath string, localExists, isDir bool, mtime string, size int64) error {
	if m == nil || m.service == nil {
		return nil
	}
	return m.service.MarkLocalDirty(ctx, remoteName, relPath, localExists, isDir, mtime, size)
}

func (m *Manager) MarkLocalSynced(ctx context.Context, remoteName, relPath string) error {
	if m == nil || m.service == nil {
		return nil
	}
	return m.service.MarkLocalSynced(ctx, remoteName, relPath)
}

func (m *Manager) WatchDir(remoteName, dirPath string) error {
	if m == nil || m.service == nil {
		return nil
	}
	if err := m.service.WatchDir(remoteName, dirPath); err != nil {
		return err
	}
	m.mu.Lock()
	m.watched[watchKey(remoteName, dirPath)] = struct{}{}
	m.mu.Unlock()
	return nil
}

func (m *Manager) UnwatchDir(remoteName, dirPath string) error {
	if m == nil || m.service == nil {
		return nil
	}
	if err := m.service.UnwatchDir(remoteName, dirPath); err != nil {
		return err
	}
	m.mu.Lock()
	delete(m.watched, watchKey(remoteName, dirPath))
	m.mu.Unlock()
	return nil
}

func (m *Manager) reloadWatchedDirs() error {
	if m == nil || m.service == nil {
		return nil
	}
	rows, err := m.service.ListWatchedDirs()
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.watched = map[string]struct{}{}
	for _, row := range rows {
		m.watched[watchKey(row.RemoteName, row.RelPath)] = struct{}{}
	}
	return nil
}

func (m *Manager) run() {
	defer close(m.done)
	<-m.stop
}

func (m *Manager) tickWatched() {
	// Automatic watched-directory refresh is intentionally disabled.
	// Remote revalidation should only happen through explicit user actions
	// such as Sync Now.
}

func watchKey(remoteName, dirPath string) string {
	return remoteName + "\x00" + dirPath
}

func parseWatchKey(key string) (string, string) {
	for i := 0; i < len(key); i++ {
		if key[i] == 0 {
			return key[:i], key[i+1:]
		}
	}
	return key, ""
}

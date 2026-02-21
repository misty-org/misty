package auth

import (
	"sync"
	"time"
)

type blacklistEntry struct {
	expiry time.Time
}

var (
	blacklist   = make(map[string]blacklistEntry)
	blacklistMu sync.RWMutex
)

func init() {
	go cleanupLoop()
}

func BlacklistToken(tokenID string, expiry time.Time) {
	blacklistMu.Lock()
	defer blacklistMu.Unlock()
	blacklist[tokenID] = blacklistEntry{expiry: expiry}
}

func IsBlacklisted(tokenID string) bool {
	blacklistMu.RLock()
	defer blacklistMu.RUnlock()
	_, exists := blacklist[tokenID]
	return exists
}

func cleanupLoop() {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		blacklistMu.Lock()
		now := time.Now()
		for id, entry := range blacklist {
			if now.After(entry.expiry) {
				delete(blacklist, id)
			}
		}
		blacklistMu.Unlock()
	}
}

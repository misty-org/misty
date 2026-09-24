package db

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"sync"
	"time"
)

const SessionTTL = 30 * 24 * time.Hour

type cachedSession struct {
	userID    string
	expiresAt time.Time
}

type sessionCache struct {
	mu      sync.RWMutex
	entries map[string]cachedSession
}

const sessionCacheTTL = 30 * time.Second

var defaultSessionCache = &sessionCache{
	entries: make(map[string]cachedSession),
}

func (c *sessionCache) get(tokenHash string, now time.Time) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.entries[tokenHash]
	if !ok || now.After(entry.expiresAt) {
		return "", false
	}
	return entry.userID, true
}

func (c *sessionCache) set(tokenHash, userID string, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) > 10000 {
		for k, v := range c.entries {
			if now.After(v.expiresAt) {
				delete(c.entries, k)
			}
		}
		if len(c.entries) > 10000 {
			for k := range c.entries {
				delete(c.entries, k)
				if len(c.entries) <= 5000 {
					break
				}
			}
		}
	}
	c.entries[tokenHash] = cachedSession{
		userID:    userID,
		expiresAt: now.Add(sessionCacheTTL),
	}
}

func (c *sessionCache) delete(tokenHash string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, tokenHash)
}

func TestingClearSessionCache() {
	defaultSessionCache.mu.Lock()
	defer defaultSessionCache.mu.Unlock()
	defaultSessionCache.entries = make(map[string]cachedSession)
}

func (db *Database) CreateSession(tokenHash, userID string) error {
	return db.CreateSessionWithTTL(tokenHash, userID, SessionTTL)
}

// CreateSessionWithTTL backs CreateSession and lets callers that did not verify
// a password — the desktop-to-browser handoff — mint a shorter-lived session.
func (db *Database) CreateSessionWithTTL(tokenHash, userID string, ttl time.Duration) error {
	now := time.Now()
	expiresAt := now.Add(ttl)
	err := db.TestingWithRLSContext(context.Background(), sessionCreateRLSSettings(tokenHash, userID), func(tx *sql.Tx) error {
		_, err := tx.ExecContext(
			context.Background(),
			`INSERT INTO sessions (token_hash, user_id, expires_at)
			 SELECT $1,$2,$3 FROM users
			 WHERE id=$2 AND lifecycle_state='active'`,
			tokenHash, userID, expiresAt,
		)
		return err
	})
	if err != nil {
		log.Println("Failed to create session:", err)
		return err
	}
	defaultSessionCache.set(tokenHash, userID, now)
	return nil
}

func (db *Database) GetSessionUserID(tokenHash string) (string, error) {
	return db.GetSessionUserIDContext(context.Background(), tokenHash)
}

func (db *Database) GetSessionUserIDContext(ctx context.Context, tokenHash string) (string, error) {
	now := time.Now()
	if userID, ok := defaultSessionCache.get(tokenHash, now); ok {
		return userID, nil
	}

	var userID string
	err := db.TestingWithRLSContext(ctx, sessionRLSSettings(tokenHash), func(tx *sql.Tx) error {
		return tx.QueryRowContext(
			ctx,
			`SELECT user_id FROM sessions
			 WHERE token_hash=$1 AND expires_at>NOW()`,
			tokenHash,
		).Scan(&userID)
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return "", err
		}
		log.Println("Failed to get session:", err)
		return "", err
	}
	if userID != "" {
		defaultSessionCache.set(tokenHash, userID, now)
	}
	return userID, nil
}

func (db *Database) DeleteSession(tokenHash string) error {
	defaultSessionCache.delete(tokenHash)
	err := db.TestingWithRLSContext(context.Background(), sessionRLSSettings(tokenHash), func(tx *sql.Tx) error {
		_, err := tx.ExecContext(context.Background(), `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
		return err
	})
	if err != nil {
		log.Println("Failed to delete session:", err)
	}
	return err
}

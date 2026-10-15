package db

import (
	"context"
	"database/sql"
	"errors"
	"math/bits"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// MemoryEvent is one thing the person read, heard or recorded.
type MemoryEvent struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	DeviceID   string    `json:"device_id,omitempty"`
	URL        string    `json:"url,omitempty"`
	Site       string    `json:"site,omitempty"`
	Title      string    `json:"title"`
	Body       string    `json:"body,omitempty"`
	Simhash    string    `json:"simhash,omitempty"`
	SameAs     string    `json:"same_as,omitempty"`
	RefID      string    `json:"ref_id,omitempty"`
	DwellMS    int64     `json:"dwell_ms"`
	OccurredAt time.Time `json:"occurred_at"`
}

// ErrMemoryBacklogFull means more is waiting to be remembered than the cap
// allows; nothing new is kept until the backlog drains.
var ErrMemoryBacklogFull = errors.New("memory backlog full")

// A revisit within this many simhash bits is the same page.
const memorySameBits = 6

var memoryKinds = map[string]bool{"page": true, "voice": true, "recording": true, "note": true}

// MemorySite is the host a page belongs to, without "www.".
func MemorySite(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
}

// SimhashDistance is how many bits two 16-digit hex simhashes differ by, or
// 64 when either is missing or malformed.
func SimhashDistance(left, right string) int {
	a, errA := strconv.ParseUint(left, 16, 64)
	b, errB := strconv.ParseUint(right, 16, 64)
	if errA != nil || errB != nil || len(left) != 16 || len(right) != 16 {
		return 64
	}
	return bits.OnesCount64(a ^ b)
}

func validMemoryEvent(e MemoryEvent) bool {
	if e.ID == "" || !memoryKinds[e.Kind] || len(e.URL) > 2048 || len(e.Title) > 300 || len(e.Body) > 20000 || len(e.DeviceID) > 200 || len(e.RefID) > 200 || e.DwellMS < 0 || e.OccurredAt.IsZero() {
		return false
	}
	if e.Simhash != "" && SimhashDistance(e.Simhash, e.Simhash) == 64 {
		return false
	}
	if e.Kind == "page" {
		parsed, err := url.Parse(e.URL)
		return err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != ""
	}
	return true
}

// RecordMemoryEvent keeps one event. A page revisit that barely changed
// points at the visit holding its text instead of storing it again. Events
// with text join the embedding backlog; past backlogCap nothing is kept.
func (db *Database) RecordMemoryEvent(ctx context.Context, user string, e MemoryEvent, backlogCap int) (MemoryEvent, error) {
	if user == "" || !validMemoryEvent(e) {
		return e, ErrSpaceInvalid
	}
	if e.Kind == "page" {
		e.Site = MemorySite(e.URL)
	}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		if e.Kind == "page" && e.Simhash != "" {
			var holder, hash string
			err := tx.QueryRowContext(ctx, `SELECT id, simhash FROM memory_events
 WHERE owner_user_id=$1 AND url=$2 AND same_as IS NULL AND simhash <> '' ORDER BY occurred_at DESC LIMIT 1`, user, e.URL).Scan(&holder, &hash)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if err == nil && SimhashDistance(hash, e.Simhash) <= memorySameBits {
				e.SameAs, e.Body = holder, ""
			}
		}
		queued := e.SameAs == "" && strings.TrimSpace(e.Title+e.Body) != ""
		if queued {
			var waiting int
			if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM memory_backlog WHERE owner_user_id=$1`, user).Scan(&waiting); err != nil {
				return err
			}
			if waiting >= backlogCap {
				return ErrMemoryBacklogFull
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO memory_events(id,owner_user_id,kind,device_id,url,site,title,body,simhash,same_as,ref_id,dwell_ms,occurred_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,'')::uuid,$11,$12,$13)`, e.ID, user, e.Kind, e.DeviceID, e.URL, e.Site, e.Title, e.Body, e.Simhash, e.SameAs, e.RefID, e.DwellMS, e.OccurredAt); err != nil {
			return err
		}
		if !queued {
			return nil
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO memory_backlog(event_id,owner_user_id) VALUES($1,$2)`, e.ID, user)
		return err
	})
	return e, err
}

// MemoryQuery narrows a timeline or a search.
type MemoryQuery struct {
	From, To time.Time
	Site     string
	Kind     string
	Text     string
	Limit    int
}

// MemoryEvents lists the person's events newest first. With Text it is a
// word search over titles and text; revisits carry the text they point at.
func (db *Database) MemoryEvents(ctx context.Context, user string, q MemoryQuery) ([]MemoryEvent, error) {
	if q.Limit <= 0 || q.Limit > 200 {
		q.Limit = 50
	}
	if q.To.IsZero() {
		q.To = time.Now().Add(time.Minute)
	}
	out := []MemoryEvent{}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT e.id,e.kind,e.device_id,e.url,e.site,e.title,COALESCE(h.body,e.body),e.simhash,COALESCE(e.same_as::text,''),e.ref_id,e.dwell_ms,e.occurred_at
 FROM memory_events e LEFT JOIN memory_events h ON h.id=e.same_as
 WHERE e.owner_user_id=$1 AND e.occurred_at >= $2 AND e.occurred_at < $3
   AND ($4='' OR e.site=$4 OR e.site LIKE '%.'||$4) AND ($5='' OR e.kind=$5)
   AND ($6='' OR to_tsvector('simple', e.title||' '||COALESCE(h.body,e.body)) @@ plainto_tsquery('simple',$6))
 ORDER BY e.occurred_at DESC LIMIT $7`, user, q.From, q.To, strings.ToLower(strings.TrimSpace(q.Site)), q.Kind, strings.TrimSpace(q.Text), q.Limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e MemoryEvent
			if err := rows.Scan(&e.ID, &e.Kind, &e.DeviceID, &e.URL, &e.Site, &e.Title, &e.Body, &e.Simhash, &e.SameAs, &e.RefID, &e.DwellMS, &e.OccurredAt); err != nil {
				return err
			}
			out = append(out, e)
		}
		return rows.Err()
	})
	return out, err
}

// MemoryForget says what to forget: everything, one site, or a time range.
type MemoryForget struct {
	All      bool
	Site     string
	From, To time.Time
}

// ForgetMemory deletes the matching events and their place in the backlog.
// A later revisit outside the range keeps the text it pointed at.
func (db *Database) ForgetMemory(ctx context.Context, user string, f MemoryForget) (int64, error) {
	site := strings.ToLower(strings.TrimSpace(f.Site))
	if !f.All && site == "" && (f.From.IsZero() || f.To.IsZero() || !f.To.After(f.From)) {
		return 0, ErrSpaceInvalid
	}
	var deleted int64
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		match := `owner_user_id=$1 AND ($2 OR (($3='' OR site=$3 OR site LIKE '%.'||$3) AND ($4::timestamptz IS NULL OR occurred_at >= $4) AND ($5::timestamptz IS NULL OR occurred_at < $5)))`
		args := []any{user, f.All, site, nullableTime(f.From), nullableTime(f.To)}
		// Promoted revisits hold the text now, so they need an embedding.
		if _, err := tx.ExecContext(ctx, `WITH promoted AS (
 UPDATE memory_events k SET body=h.body, same_as=NULL
 FROM memory_events h WHERE k.same_as=h.id AND k.owner_user_id=$1 AND h.id IN (SELECT id FROM memory_events WHERE `+match+`)
   AND k.id NOT IN (SELECT id FROM memory_events WHERE `+match+`)
 RETURNING k.id, k.owner_user_id)
 INSERT INTO memory_backlog(event_id,owner_user_id) SELECT id, owner_user_id FROM promoted ON CONFLICT DO NOTHING`, args...); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM memory_events WHERE `+match, args...)
		if err != nil {
			return err
		}
		deleted, _ = result.RowsAffected()
		return nil
	})
	return deleted, err
}

func nullableTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

// MemoryBacklogCount is how many events wait for an embedding.
func (db *Database) MemoryBacklogCount(ctx context.Context, user string) (int, error) {
	var n int
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT count(*) FROM memory_backlog WHERE owner_user_id=$1`, user).Scan(&n)
	})
	return n, err
}

// EachMemoryEvent visits every event the person has, oldest first, with the
// text revisits point at, for export.
func (db *Database) EachMemoryEvent(ctx context.Context, user string, visit func(MemoryEvent) error) error {
	return db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT e.id,e.kind,e.device_id,e.url,e.site,e.title,COALESCE(h.body,e.body),e.simhash,COALESCE(e.same_as::text,''),e.ref_id,e.dwell_ms,e.occurred_at
 FROM memory_events e LEFT JOIN memory_events h ON h.id=e.same_as WHERE e.owner_user_id=$1 ORDER BY e.occurred_at, e.id`, user)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e MemoryEvent
			if err := rows.Scan(&e.ID, &e.Kind, &e.DeviceID, &e.URL, &e.Site, &e.Title, &e.Body, &e.Simhash, &e.SameAs, &e.RefID, &e.DwellMS, &e.OccurredAt); err != nil {
				return err
			}
			if err := visit(e); err != nil {
				return err
			}
		}
		return rows.Err()
	})
}

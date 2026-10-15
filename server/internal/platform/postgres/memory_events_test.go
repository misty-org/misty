package db

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestMemoryEventsPointRevisitsStayPrivateAndForget(t *testing.T) {
	database := voiceTestDB(t)
	ctx := context.Background()
	base := time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)
	visit := func(user, address, hash, body string, at time.Duration) MemoryEvent {
		t.Helper()
		e, err := database.RecordMemoryEvent(ctx, user, MemoryEvent{ID: uuid.NewString(), Kind: "page", URL: address, Title: "Bike lanes",
			Body: body, Simhash: hash, OccurredAt: base.Add(at)}, 3)
		if err != nil {
			t.Fatal(err)
		}
		return e
	}
	first := visit("owner", "https://www.news.example/bikes", "00000000000000ff", "The council voted to expand bike lanes.", 0)
	if first.Site != "news.example" || first.SameAs != "" {
		t.Fatalf("first visit = %+v", first)
	}
	// Two bits apart: the same page, so the revisit points at the first.
	again := visit("owner", "https://www.news.example/bikes", "00000000000000fc", "The council voted to expand bike lanes. 1 minute ago", time.Hour)
	if again.SameAs != first.ID || again.Body != "" {
		t.Fatalf("revisit = %+v", again)
	}
	// Far apart: a changed page keeps its own text.
	changed := visit("owner", "https://www.news.example/bikes", "ffffffffffff0000", "Update: the vote was delayed.", 2*time.Hour)
	if changed.SameAs != "" {
		t.Fatalf("changed page pointed at %s", changed.SameAs)
	}
	if waiting, _ := database.MemoryBacklogCount(ctx, "owner"); waiting != 2 {
		t.Fatalf("backlog = %d, want 2 (revisits wait for nothing)", waiting)
	}
	// Text with a visit of its own is indexed privately; a revisit is not.
	var documents int
	var owner, privacy string
	if err := database.Conn.QueryRow(`SELECT count(*), max(owner_user_id), max(privacy_class) FROM ai_retrieval_documents WHERE source_kind='memory_page'`).Scan(&documents, &owner, &privacy); err != nil || documents != 2 || owner != "owner" || privacy != "private" {
		t.Fatalf("indexed %d documents for %q (%s), %v", documents, owner, privacy, err)
	}
	// An embedding landing takes the event off the backlog.
	if err := database.TestingWithRLSContext(ctx, TestingServiceRLSSettings(), func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE ai_retrieval_chunks SET embedding='{1}' WHERE document_id=$1`, "memory_page:"+changed.ID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if waiting, _ := database.MemoryBacklogCount(ctx, "owner"); waiting != 1 {
		t.Fatalf("backlog after an embedding = %d, want 1", waiting)
	}
	visit("owner", "https://other.example/", "0f0f0f0f0f0f0f0f", "Recipes.", 3*time.Hour)
	visit("owner", "https://third.example/", "f0f0f0f0f0f0f0f0", "Maps.", 4*time.Hour)
	// The cap is 3: the fourth event with text is refused, plainly.
	if _, err := database.RecordMemoryEvent(ctx, "owner", MemoryEvent{ID: uuid.NewString(), Kind: "page", URL: "https://x.example/", Title: "X", Body: "x", OccurredAt: base}, 3); !errors.Is(err, ErrMemoryBacklogFull) {
		t.Fatalf("over the cap = %v", err)
	}
	if _, err := database.RecordMemoryEvent(ctx, "owner", MemoryEvent{ID: uuid.NewString(), Kind: "page", URL: "file:///etc/passwd", OccurredAt: base}, 3); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("file URL = %v", err)
	}

	if events, err := database.MemoryEvents(ctx, "other", MemoryQuery{From: base.Add(-time.Hour)}); err != nil || len(events) != 0 {
		t.Fatalf("another person sees %d events, %v", len(events), err)
	}
	found, err := database.MemoryEvents(ctx, "owner", MemoryQuery{From: base.Add(-time.Hour), Text: "council", Site: "news.example"})
	if err != nil || len(found) != 2 || found[0].ID != again.ID || found[0].Body == "" {
		t.Fatalf("search = %+v, %v", found, err)
	}
	if n, err := database.ForgetMemory(ctx, "other", MemoryForget{All: true}); err != nil || n != 0 {
		t.Fatalf("another person forgot %d, %v", n, err)
	}
	// Forgetting the first hour keeps the revisit, which now holds the text.
	if n, err := database.ForgetMemory(ctx, "owner", MemoryForget{From: base, To: base.Add(30 * time.Minute)}); err != nil || n != 1 {
		t.Fatalf("forget range = %d, %v", n, err)
	}
	kept, _ := database.MemoryEvents(ctx, "owner", MemoryQuery{From: base.Add(-time.Hour), Site: "news.example"})
	if len(kept) != 2 || kept[1].ID != again.ID || kept[1].SameAs != "" || kept[1].Body == "" {
		t.Fatalf("after forgetting the range = %+v", kept)
	}
	if n, err := database.ForgetMemory(ctx, "owner", MemoryForget{Site: "news.example"}); err != nil || n != 2 {
		t.Fatalf("forget site = %d, %v", n, err)
	}
	if _, err := database.ForgetMemory(ctx, "owner", MemoryForget{}); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("forget nothing = %v", err)
	}
	if n, err := database.ForgetMemory(ctx, "owner", MemoryForget{All: true}); err != nil || n != 2 {
		t.Fatalf("forget all = %d, %v", n, err)
	}
	if waiting, _ := database.MemoryBacklogCount(ctx, "owner"); waiting != 0 {
		t.Fatalf("backlog after forgetting everything = %d", waiting)
	}
	if err := database.Conn.QueryRow(`SELECT count(*) FROM ai_retrieval_documents`).Scan(&documents); err != nil || documents != 0 {
		t.Fatalf("forgotten events left %d documents, %v", documents, err)
	}
}

func TestSimhashDistance(t *testing.T) {
	if SimhashDistance("00000000000000ff", "00000000000000fc") != 2 || SimhashDistance("zz", "00") != 64 {
		t.Fatal("simhash distance")
	}
}

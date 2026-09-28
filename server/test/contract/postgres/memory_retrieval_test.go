package db

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	. "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// Memory is indexed for its owner only, and only the recall search sees it:
// general search, which every agent can use, never returns Memory.
func TestMemoryIsIndexedPrivatelyAndOnlyRecallSearchesIt(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Memory Owner", "memory-owner@example.com", "password")
	if err != nil {
		t.Fatal(err)
	}
	other, err := database.CreateUser("Memory Other", "memory-other@example.com", "password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RecordMemoryEvent(ctx, owner.ID, MemoryEvent{ID: uuid.NewString(), Kind: "page", URL: "https://news.example/bikes",
		Title: "Bike lanes", Body: "The council voted to expand the zanzibarian bike lanes.", Simhash: "00000000000000ff", OccurredAt: time.Now()}, 10); err != nil {
		t.Fatal(err)
	}
	if hits, err := database.SearchMemoryRetrieval(ctx, owner.ID, "zanzibarian", nil, 5, ""); err != nil || len(hits) != 1 || hits[0].SourceKind != "memory_page" {
		t.Fatalf("recall search = %+v, %v", hits, err)
	}
	if hits, err := database.SearchAIRetrieval(ctx, owner.ID, "zanzibarian", nil, 5); err != nil || len(hits) != 0 {
		t.Fatalf("general search returned Memory: %+v, %v", hits, err)
	}
	if hits, err := database.SearchMemoryRetrieval(ctx, other.ID, "zanzibarian", nil, 5, ""); err != nil || len(hits) != 0 {
		t.Fatalf("another person found Memory: %+v, %v", hits, err)
	}
	if n, err := database.ForgetMemory(ctx, owner.ID, MemoryForget{All: true}); err != nil || n != 1 {
		t.Fatalf("forget = %d, %v", n, err)
	}
	if hits, _ := database.SearchMemoryRetrieval(ctx, owner.ID, "zanzibarian", nil, 5, ""); len(hits) != 0 {
		t.Fatal("forgotten Memory is still searchable")
	}
}

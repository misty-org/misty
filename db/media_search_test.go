package db

import (
	"errors"
	"strings"
	"testing"
)

func TestMediaSearchTimestampLifecycleAndTenantIsolation(t *testing.T) {
	database := openTestDatabase(t)
	user, err := database.CreateUser("Media User", "media-search@example.com", "password")
	if err != nil {
		t.Fatal(err)
	}
	other, err := database.CreateUser("Other User", "other-media@example.com", "password")
	if err != nil {
		t.Fatal(err)
	}
	asset := MediaSearchAsset{AssetID: "media_0123456789abcdef0123456789abcdef", Fingerprint: strings.Repeat("a", 64), MediaType: "video", MimeType: "video/mp4", DurationMS: 120_186}
	claimed, err := database.ClaimMediaSearchChunk(user.ID, asset, 0, 0, 30_000)
	if err != nil || !claimed {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	if _, err = database.ClaimMediaSearchChunk(user.ID, asset, 0, 0, 30_000); !errors.Is(err, ErrMediaChunkBusy) {
		t.Fatalf("duplicate claim err=%v", err)
	}
	vector := make([]float64, 768)
	vector[0] = 1
	if err = database.CompleteMediaSearchChunk(user.ID, asset.AssetID, 0, 30_000, []MediaSearchSegment{{Kind: "spoken", ChunkIndex: 0, StartMS: 1250, EndMS: 2500, Content: "hello electric world", Transcript: "hello electric world", Embedding: vector, EmbeddingModel: "test"}, {Kind: "visual", ChunkIndex: 0, StartMS: 5_000, EndMS: 15_000, Content: "red sports car on a city street", VisualDescription: "A red sports car passes buildings.", VisibleText: []string{"DOWNTOWN"}, Embedding: vector, EmbeddingModel: "test"}}); err != nil {
		t.Fatal(err)
	}
	hits, err := database.SearchMedia(user.ID, "electric", nil, 10)
	if err != nil || len(hits) != 1 || hits[0].StartMS != 1250 || hits[0].Kind != "spoken" {
		t.Fatalf("hits=%+v err=%v", hits, err)
	}
	visual, err := database.SearchMedia(user.ID, "DOWNTOWN", nil, 10)
	if err != nil || len(visual) != 1 || visual[0].Kind != "visual" {
		t.Fatalf("visual=%+v err=%v", visual, err)
	}
	isolated, err := database.SearchMedia(other.ID, "electric", nil, 10)
	if err != nil || len(isolated) != 0 {
		t.Fatalf("tenant leak=%+v err=%v", isolated, err)
	}
	claimed, err = database.ClaimMediaSearchChunk(user.ID, asset, 0, 0, 30_000)
	if err != nil || claimed {
		t.Fatalf("idempotent claim=%v err=%v", claimed, err)
	}
}

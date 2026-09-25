package db

import (
	"context"
	"github.com/kannachi323/misty/server/internal/platform/security"
	"github.com/kannachi323/misty/server/test/testkit"
	"sync"
	"testing"
	"time"
)

func TestRefreshRotationRevokesFamilyOnReplay(t *testing.T) {
	database := testkit.OpenDatabase(t)
	user, err := database.CreateUserWithUsername("Ada", "refresh_ada", "refresh@example.com", "password-long-enough")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	sid := security.HashToken("sid")
	if err := database.CreateRefreshSession(ctx, sid, security.HashToken("old"), user.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	ok, err := database.RotateRefreshSession(ctx, sid, security.HashToken("old"), security.HashToken("new"), user.ID)
	if err != nil || !ok {
		t.Fatalf("first rotation=%v %v", ok, err)
	}
	ok, err = database.RotateRefreshSession(ctx, sid, security.HashToken("old"), security.HashToken("replay"), user.ID)
	if err != nil || ok {
		t.Fatalf("replay=%v %v", ok, err)
	}
	ok, err = database.RotateRefreshSession(ctx, sid, security.HashToken("new"), security.HashToken("next"), user.ID)
	if err != nil || ok {
		t.Fatalf("revoked family accepted=%v %v", ok, err)
	}
}

func TestConcurrentRefreshOnlyOneRequestWins(t *testing.T) {
	database := testkit.OpenDatabase(t)
	user, err := database.CreateUserWithUsername("Ada", "refresh_race", "race@example.com", "password-long-enough")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	sid := security.HashToken("sid")
	if err := database.CreateRefreshSession(ctx, sid, "old", user.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan bool, 2)
	errs := make(chan error, 2)
	for _, hash := range []string{"next-a", "next-b"} {
		wg.Add(1)
		go func(hash string) {
			defer wg.Done()
			ok, err := database.RotateRefreshSession(ctx, sid, "old", hash, user.ID)
			results <- ok
			errs <- err
		}(hash)
	}
	wg.Wait()
	close(results)
	close(errs)
	wins := 0
	for ok := range results {
		if ok {
			wins++
		}
	}
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if wins != 1 {
		t.Fatalf("concurrent rotation winners=%d", wins)
	}
}

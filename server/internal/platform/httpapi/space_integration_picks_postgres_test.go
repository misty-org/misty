package api

import (
	"errors"
	"testing"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"github.com/kannachi323/misty/server/test/testkit"
)

func TestSpaceIntegrationPicksPostgres(t *testing.T) {
	database := testkit.OpenDatabase(t)
	ctx := t.Context()
	owner, err := database.CreateUser("Owner", "picks-owner@example.test", "password123")
	if err != nil {
		t.Fatal(err)
	}
	other, err := database.CreateUser("Other", "picks-other@example.test", "password123")
	if err != nil {
		t.Fatal(err)
	}
	personalID, err := database.PersonalSpaceID(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	personal := &db.Space{ID: personalID}
	work, err := database.TestingCreateSpace(ctx, owner.ID, "Work")
	if err != nil {
		t.Fatal(err)
	}
	workGmail := db.IntegrationAccount{ID: "ca_work_gmail", Toolkit: "gmail"}
	homeGmail := db.IntegrationAccount{ID: "ca_home_gmail", Toolkit: "gmail"}

	// Every account Misty sees is picked once in the personal Space.
	if err := database.SeedSpaceIntegrationPicks(ctx, owner.ID, []db.IntegrationAccount{workGmail, homeGmail}); err != nil {
		t.Fatal(err)
	}
	if picks, _ := database.SpaceIntegrationPicks(ctx, owner.ID, personal.ID); len(picks) != 2 {
		t.Fatalf("seeded personal picks = %+v", picks)
	}
	// Work uses the work Gmail; Personal keeps only the personal one, and
	// seeding again doesn't undo that.
	if err := database.SetSpaceIntegrationPicks(ctx, owner.ID, work.ID, []db.IntegrationAccount{workGmail}); err != nil {
		t.Fatal(err)
	}
	if err := database.SetSpaceIntegrationPicks(ctx, owner.ID, personal.ID, []db.IntegrationAccount{homeGmail}); err != nil {
		t.Fatal(err)
	}
	if err := database.SeedSpaceIntegrationPicks(ctx, owner.ID, []db.IntegrationAccount{workGmail, homeGmail}); err != nil {
		t.Fatal(err)
	}
	if picks, _ := database.SpaceIntegrationPicks(ctx, owner.ID, personal.ID); len(picks) != 1 || picks[0].ID != homeGmail.ID {
		t.Fatalf("personal picks after reseed = %+v", picks)
	}
	if picks, _ := database.SpaceIntegrationPicks(ctx, owner.ID, work.ID); len(picks) != 1 || picks[0].ID != workGmail.ID {
		t.Fatalf("work picks = %+v", picks)
	}
	// Adding to a Space that already has the app keeps its pick.
	if added, err := database.AddSpaceIntegrationPick(ctx, owner.ID, work.ID, homeGmail, true); err != nil || added {
		t.Fatalf("add when one exists = %v, %v", added, err)
	}

	// Nobody else reads or writes the owner's picks, even with the Space id.
	if picks, err := database.SpaceIntegrationPicks(ctx, other.ID, work.ID); err != nil || len(picks) != 0 {
		t.Fatalf("another person read picks: %+v, %v", picks, err)
	}
	if picks, err := database.SpaceIntegrationPicks(ctx, other.ID, ""); err != nil || len(picks) != 0 {
		t.Fatalf("another person listed picks: %+v, %v", picks, err)
	}
	if err := database.SetSpaceIntegrationPicks(ctx, other.ID, work.ID, []db.IntegrationAccount{{ID: "ca_other", Toolkit: "gmail"}}); !errors.Is(err, db.ErrSpaceForbidden) {
		t.Fatalf("a non-member set picks in Work: %v", err)
	}

	// Disconnecting drops the account from every Space.
	if err := database.ForgetIntegrationAccount(ctx, owner.ID, workGmail.ID); err != nil {
		t.Fatal(err)
	}
	if picks, _ := database.SpaceIntegrationPicks(ctx, owner.ID, ""); len(picks) != 1 || picks[0].ID != homeGmail.ID {
		t.Fatalf("picks after disconnect = %+v", picks)
	}
}

package db

import (
	"errors"
	. "github.com/kannachi323/misty/server/internal/platform/postgres"
	"github.com/kannachi323/misty/server/internal/platform/security"
	"testing"
	"time"
)

func TestSpaceAppsCannotGrantPersonalAuthority(t *testing.T) {
	database := openTestDatabase(t)
	ctx := t.Context()
	owner, err := database.CreateUser("Space owner", "retired-app-controls@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space := createTestSpace(t, database, ctx, owner.ID, "Family")
	spec := AppInstallSpec{ID: "journal", Version: "1", PermissionVersion: 1, Scopes: []string{"storage.read"}}
	if _, err := database.InstallSpaceApp(ctx, owner.ID, space.ID, spec, nil); !errors.Is(err, ErrAppRuntimeForbidden) {
		t.Fatalf("legacy installation grants consent: %v", err)
	}
	if _, err := database.RemoveSpaceApp(ctx, owner.ID, space.ID, spec.ID); !errors.Is(err, ErrAppRuntimeForbidden) {
		t.Fatal(err)
	}
	if err := database.ReorderSpaceApps(ctx, owner.ID, space.ID, []string{spec.ID}); !errors.Is(err, ErrAppRuntimeForbidden) {
		t.Fatal(err)
	}
	if _, err := database.InstallUserApp(ctx, owner.ID, spec.ID, spec.Version, 1, spec.Scopes); err != nil {
		t.Fatal(err)
	}
	if rows, err := database.SpaceApps(ctx, owner.ID, space.ID); err != nil || len(rows) != 0 {
		t.Fatalf("personal app exposed as Space install: %v %v", rows, err)
	}
	if _, err := database.CreateAppRuntimeSession(ctx, owner.ID, spec.ID, security.HashToken("legacy-space"), space.ID, time.Minute); !errors.Is(err, ErrAppRuntimeForbidden) {
		t.Fatal(err)
	}
	if err := database.SetSpaceMemberPermission(ctx, owner.ID, space.ID, owner.ID, PermissionAppsManage, "allow"); err == nil {
		t.Fatal("retired apps.manage permission accepted")
	}
}
func TestPersonalSpaceTemplateDoesNotCopyPersonalApps(t *testing.T) {
	database := openTestDatabase(t)
	ctx := t.Context()
	owner, err := database.CreateUser("Template owner", "personal-template-owner@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space := createTestSpace(t, database, ctx, owner.ID, "Family")
	if _, err = database.InstallUserApp(ctx, owner.ID, "journal", "1", 1, []string{"storage.read"}); err != nil {
		t.Fatal(err)
	}
	template, err := database.SavePersonalSpaceTemplate(ctx, owner.ID, "", space.ID, "Family tools", "Built-in tools")
	if err != nil {
		t.Fatal(err)
	}
	if len(template.Apps) != 0 {
		t.Fatal("personal installs copied to collaborative template")
	}
	saved, err := database.PersonalSpaceTemplates(ctx, owner.ID)
	if err != nil || len(saved) != 1 || len(saved[0].Apps) != 0 {
		t.Fatalf("template snapshot: %v %v", saved, err)
	}
}
func TestSpaceAppsTemplateCreationIgnoresLegacyInstallSelections(t *testing.T) {
	database := openTestDatabase(t)
	ctx := t.Context()
	owner, err := database.CreateUser("Template owner", "personal-create-template@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	spec := AppInstallSpec{ID: "journal", Version: "1", PermissionVersion: 1, Scopes: []string{"notes.read"}}
	first, err := database.CreateSpaceWithTemplateIdempotent(ctx, owner.ID, "Family", "family", nil, "same-request", spec)
	if err != nil {
		t.Fatal(err)
	}
	next, err := database.CreateSpaceWithTemplateIdempotent(ctx, owner.ID, "Family", "family", nil, "same-request", spec)
	if err != nil || first.Space.ID != next.Space.ID {
		t.Fatal("non-idempotent create", err)
	}
	if apps, err := database.UserApps(ctx, owner.ID); err != nil || len(apps) != 0 {
		t.Fatalf("legacy selection installed app: %v %v", apps, err)
	}
	notes, err := database.AccessibleSpaceNotes(ctx, owner.ID, first.Space.ID)
	if err != nil || len(notes) != 1 {
		t.Fatalf("built-in seeds: %v %v", notes, err)
	}
}

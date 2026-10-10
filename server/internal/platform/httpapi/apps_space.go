package api

import (
	"context"
	"log"
	"strings"

	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
	"github.com/kannachi323/misty/server/internal/integrations/composio"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// A run uses only the accounts its Space picked. Composio can pin accounts per
// toolkit on a session, but its docs don't promise that pinning excludes the
// person's other accounts, and pinning would need one session per Space. So
// Misty keeps one session per person and enforces picks here: every call names
// the picked account explicitly, and anything else is refused.

// spaceApps is what one run may use: the person's active accounts picked in
// the run's Space, and every active account they have, by app.
type spaceApps struct {
	SpaceID string
	picked  map[string][]composio.Account
	active  map[string][]composio.Account
}

// appsNeed is why a call can't run in this Space yet.
type appsNeed string

const (
	appsReady appsNeed = ""
	// appsNeedConnect: the person has no account for the app at all.
	appsNeedConnect appsNeed = "connect"
	// appsNeedPick: they have accounts, but this Space uses none of them.
	appsNeedPick appsNeed = "pick"
	// appsNeedChoose: the Space uses several and the call named none.
	appsNeedChoose appsNeed = "choose"
	// appsNeedOther: the call named an account this Space doesn't use.
	appsNeedOther appsNeed = "other"
)

func newSpaceApps(spaceID string, accounts []composio.Account, picks []db.SpaceIntegrationPick) spaceApps {
	apps := spaceApps{SpaceID: spaceID, picked: map[string][]composio.Account{}, active: map[string][]composio.Account{}}
	byID := map[string]composio.Account{}
	for _, account := range accounts {
		if account.Active() {
			byID[account.ID] = account
			apps.active[account.Toolkit.Slug] = append(apps.active[account.Toolkit.Slug], account)
		}
	}
	for _, pick := range picks {
		// A pick of a disconnected, broken or someone else's account is ignored.
		if account, ok := byID[pick.ID]; ok && pick.SpaceID == spaceID && account.Toolkit.Slug == pick.Toolkit {
			apps.picked[pick.Toolkit] = append(apps.picked[pick.Toolkit], account)
		}
	}
	return apps
}

// account resolves the account one call runs as. requested may be an account
// ID or alias; empty means the Space's only pick for the app.
func (a spaceApps) account(toolkit, requested string) (string, appsNeed) {
	picked := a.picked[toolkit]
	if len(picked) == 0 {
		if len(a.active[toolkit]) == 0 {
			return "", appsNeedConnect
		}
		return "", appsNeedPick
	}
	if requested == "" {
		if len(picked) == 1 {
			return picked[0].ID, appsReady
		}
		return "", appsNeedChoose
	}
	for _, account := range picked {
		if account.ID == requested || (account.Alias != "" && account.Alias == requested) {
			return account.ID, appsReady
		}
	}
	return "", appsNeedOther
}

// choices names the Space's picked accounts for a model-facing message.
func (a spaceApps) choices(toolkit string) string {
	names := []string{}
	for _, account := range a.picked[toolkit] {
		name := account.ID
		if account.Alias != "" {
			name += " (" + account.Alias + ")"
		}
		names = append(names, name)
	}
	return strings.Join(names, ", ")
}

// appsSpaceID is the run's Space: the Space it runs in, else the Space of the
// window it was asked from, else the personal Space.
func (s *SpacesService) appsSpaceID(ctx context.Context, invocation agenttools.Invocation) (string, error) {
	if invocation.SpaceID != "" {
		return invocation.SpaceID, nil
	}
	if invocation.MemorySpaceID != "" {
		// The window's Space, once the person is checked to belong to it.
		return s.database.MemorySpace(ctx, invocation.UserID, invocation.MemorySpaceID)
	}
	return s.database.PersonalSpaceID(ctx, invocation.UserID)
}

// loadSpaceApps reads the person's accounts and the run's Space picks. Apps
// and picks are the private layer: a run it doesn't open for gets none, even
// if an app tool reached it some other way.
func (s *SpacesService) loadSpaceApps(ctx context.Context, client *composio.Client, invocation agenttools.Invocation) (spaceApps, error) {
	if invocation.PublicLayerOnly || db.PublicLayerOnly(ctx) {
		return spaceApps{}, agenttools.ErrCapabilityDenied
	}
	spaceID, err := s.appsSpaceID(ctx, invocation)
	if err != nil {
		return spaceApps{}, err
	}
	return s.spaceAppsFor(ctx, client, invocation.UserID, spaceID)
}

func (s *SpacesService) spaceAppsFor(ctx context.Context, client *composio.Client, user, spaceID string) (spaceApps, error) {
	accounts, err := client.Accounts(ctx, composio.UserID(user), "")
	if err != nil {
		return spaceApps{}, err
	}
	s.seedAppPicks(ctx, user, accounts)
	picks, err := s.database.SpaceIntegrationPicks(ctx, user, spaceID)
	if err != nil {
		return spaceApps{}, err
	}
	return newSpaceApps(spaceID, accounts, picks), nil
}

// appPickedIn reports whether a Space now uses one of the person's accounts
// for an app. With adopt, an account connected since known was taken (the
// one the person just signed in with) becomes the Space's pick when it has
// none for that app yet.
func (s *SpacesService) appPickedIn(ctx context.Context, client *composio.Client, user, spaceID, app string, adopt bool, known map[string]bool) (bool, error) {
	apps, err := s.spaceAppsFor(ctx, client, user, spaceID)
	if err != nil || len(apps.picked[app]) > 0 || !adopt {
		return err == nil && len(apps.picked[app]) > 0, err
	}
	for _, account := range apps.active[app] {
		if known[account.ID] {
			continue
		}
		return s.database.AddSpaceIntegrationPick(ctx, user, spaceID, db.IntegrationAccount{ID: account.ID, Toolkit: app}, true)
	}
	return false, nil
}

// seedAppPicks puts accounts Misty sees for the first time in the personal
// Space. A failure only delays the seed to the next listing.
func (s *SpacesService) seedAppPicks(ctx context.Context, user string, accounts []composio.Account) {
	refs := []db.IntegrationAccount{}
	for _, account := range accounts {
		if account.Active() {
			refs = append(refs, db.IntegrationAccount{ID: account.ID, Toolkit: account.Toolkit.Slug})
		}
	}
	if err := s.database.SeedSpaceIntegrationPicks(ctx, user, refs); err != nil {
		log.Printf("app picks not seeded for %s: %v", user, err)
	}
}

// appsNeedError tells the model what to do when a call can't run in this Space.
func appsNeedError(apps spaceApps, toolkit string, need appsNeed) error {
	switch need {
	case appsNeedConnect:
		return serveragent.ErrInvalidRequest("The user has not connected " + toolkit + ". Call integration_connect with app " + toolkit + " first.")
	case appsNeedPick:
		return serveragent.ErrInvalidRequest("This Space doesn't use any of the user's " + toolkit + " accounts yet. Call integration_connect with app " + toolkit + " so they can pick one for this Space.")
	case appsNeedChoose:
		return serveragent.ErrInvalidRequest("This Space uses several " + toolkit + " accounts. Pass account as one of: " + apps.choices(toolkit) + ".")
	case appsNeedOther:
		return serveragent.ErrInvalidRequest("That " + toolkit + " account isn't used in this Space. Pass account as one of: " + apps.choices(toolkit) + ", or leave it out.")
	}
	return nil
}

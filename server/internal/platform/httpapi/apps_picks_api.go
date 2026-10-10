package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/internal/integrations/composio"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// appSpace is one Space in the integrations tree.
type appSpace struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Personal bool   `json:"personal"`
}

type appSpaceIndex map[string][]appSpace

func (index appSpaceIndex) of(account string) []appSpace {
	if spaces := index[account]; spaces != nil {
		return spaces
	}
	return []appSpace{}
}

// appSpacesByAccount maps each of the person's accounts to the Spaces, still
// theirs to use, that picked it.
func (s *SpacesService) appSpacesByAccount(ctx context.Context, user string) (appSpaceIndex, error) {
	picks, err := s.database.SpaceIntegrationPicks(ctx, user, "")
	if err != nil {
		return nil, err
	}
	spaces, err := s.database.ListSpaces(ctx, user)
	if err != nil {
		return nil, err
	}
	byID := map[string]appSpace{}
	for _, space := range spaces {
		byID[space.ID] = appSpace{ID: space.ID, Name: space.Name, Personal: space.IsDefault && space.OwnerUserID == user}
	}
	index := appSpaceIndex{}
	// Spaces keep the order ListSpaces gives them.
	for _, space := range spaces {
		for _, pick := range picks {
			if pick.SpaceID == space.ID {
				index[pick.ID] = append(index[pick.ID], byID[space.ID])
			}
		}
	}
	return index, nil
}

// ownedAccounts returns the person's connected accounts with the given IDs.
// An ID that isn't one of theirs fails the whole request.
func ownedAccounts(ctx context.Context, client *composio.Client, user string, ids []string, toolkit string) ([]db.IntegrationAccount, error) {
	accounts, err := client.Accounts(ctx, composio.UserID(user), toolkit)
	if err != nil {
		return nil, err
	}
	byID := map[string]composio.Account{}
	for _, account := range accounts {
		byID[account.ID] = account
	}
	out := []db.IntegrationAccount{}
	seen := map[string]bool{}
	for _, id := range ids {
		account, ok := byID[strings.TrimSpace(id)]
		if !ok || account.Status == "INITIATED" || account.Status == "INITIALIZING" {
			return nil, db.ErrSpaceInvalid
		}
		if !seen[account.ID] {
			seen[account.ID] = true
			out = append(out, db.IntegrationAccount{ID: account.ID, Toolkit: account.Toolkit.Slug})
		}
	}
	return out, nil
}

// SpaceAppPicks replaces which of the person's accounts one Space uses,
// PUT /integrations/apps/spaces/{spaceID} with {accounts: [id]}. Picks are the
// person's own; other members of the Space never see them.
func (s *SpacesService) SpaceAppPicks() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.appsUser(w, r)
		if !ok {
			return
		}
		var body struct {
			Accounts []string `json:"accounts"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if len(body.Accounts) > 200 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "too_many_accounts"})
			return
		}
		client, err := composioClient()
		if err != nil {
			writeAppsError(w, err)
			return
		}
		accounts, err := ownedAccounts(r.Context(), client, user, body.Accounts, "")
		if err == nil {
			err = s.database.SetSpaceIntegrationPicks(r.Context(), user, chi.URLParam(r, "spaceID"), accounts)
		}
		if err != nil {
			writeAppsError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts})
	}
}

// AppRequestPick answers a pick card with one of the person's accounts for
// the card's app, POST /me/app-requests/{requestID}/pick with {account}.
func (s *SpacesService) AppRequestPick() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.appsUser(w, r)
		if !ok {
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		var body struct {
			Account string `json:"account"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		request, err := s.database.AgentAppRequest(r.Context(), user, chi.URLParam(r, "requestID"))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if request.Kind != "pick" || request.SpaceID == "" || request.State != "pending" {
			writeJSON(w, http.StatusConflict, map[string]string{"code": "not_a_pending_pick"})
			return
		}
		client, err := composioClient()
		if err != nil {
			writeAppsError(w, err)
			return
		}
		accounts, err := ownedAccounts(r.Context(), client, user, []string{body.Account}, request.Subject)
		if err == nil {
			_, err = s.database.AddSpaceIntegrationPick(r.Context(), user, request.SpaceID, accounts[0], false)
		}
		if err != nil {
			writeAppsError(w, err)
			return
		}
		if resolved, _ := s.database.ResolveAgentAppRequest(r.Context(), user, request.ID, "pending", "connected"); resolved {
			request.State = "connected"
			s.showAppRequest(r.Context(), user, request.RunID, request)
		}
		writeJSON(w, http.StatusOK, map[string]any{"request": appRequestView(request)})
	}
}

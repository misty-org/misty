package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/kannachi323/misty/server/internal/integrations/composio"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func testAccount(t *testing.T, id, toolkit, status string) composio.Account {
	t.Helper()
	var account composio.Account
	if err := json.Unmarshal([]byte(`{"id":"`+id+`","status":"`+status+`","toolkit":{"slug":"`+toolkit+`"}}`), &account); err != nil {
		t.Fatal(err)
	}
	return account
}

func TestSpaceAppsUseOnlyTheirOwnPicks(t *testing.T) {
	accounts := []composio.Account{
		testAccount(t, "ca_work", "gmail", "ACTIVE"),
		testAccount(t, "ca_home", "gmail", "ACTIVE"),
		testAccount(t, "ca_slack", "slack", "ACTIVE"),
		testAccount(t, "ca_broken", "github", "EXPIRED"),
	}
	picks := []db.SpaceIntegrationPick{
		{SpaceID: "space_work", IntegrationAccount: db.IntegrationAccount{ID: "ca_work", Toolkit: "gmail"}},
		{SpaceID: "space_home", IntegrationAccount: db.IntegrationAccount{ID: "ca_home", Toolkit: "gmail"}},
		{SpaceID: "space_home", IntegrationAccount: db.IntegrationAccount{ID: "ca_slack", Toolkit: "slack"}},
		{SpaceID: "space_work", IntegrationAccount: db.IntegrationAccount{ID: "ca_broken", Toolkit: "github"}},
		// A pick naming the wrong app is ignored.
		{SpaceID: "space_work", IntegrationAccount: db.IntegrationAccount{ID: "ca_slack", Toolkit: "gmail"}},
	}
	work, home := newSpaceApps("space_work", accounts, picks), newSpaceApps("space_home", accounts, picks)

	cases := []struct {
		name               string
		apps               spaceApps
		toolkit, requested string
		account            string
		need               appsNeed
	}{
		{"work uses its Gmail", work, "gmail", "", "ca_work", appsReady},
		{"home uses its Gmail", home, "gmail", "", "ca_home", appsReady},
		{"work can't name the personal Gmail", work, "gmail", "ca_home", "", appsNeedOther},
		{"home can't name the work Gmail", home, "gmail", "ca_work", "", appsNeedOther},
		{"slack picked only at home asks work to pick", work, "slack", "", "", appsNeedPick},
		{"a broken pick counts as none", work, "github", "", "", appsNeedConnect},
		{"an app never connected asks to connect", home, "notion", "", "", appsNeedConnect},
	}
	for _, tc := range cases {
		account, need := tc.apps.account(tc.toolkit, tc.requested)
		if account != tc.account || need != tc.need {
			t.Errorf("%s: got %q/%q, want %q/%q", tc.name, account, need, tc.account, tc.need)
		}
	}

	both := newSpaceApps("space_work", accounts, append(picks, db.SpaceIntegrationPick{SpaceID: "space_work", IntegrationAccount: db.IntegrationAccount{ID: "ca_home", Toolkit: "gmail"}}))
	if _, need := both.account("gmail", ""); need != appsNeedChoose {
		t.Fatalf("two picks without a choice = %q", need)
	}
	if account, need := both.account("gmail", "ca_home"); account != "ca_home" || need != appsReady {
		t.Fatalf("named pick = %q/%q", account, need)
	}
	if err := appsNeedError(both, "gmail", appsNeedChoose); err == nil || !strings.Contains(err.Error(), "ca_work") || !strings.Contains(err.Error(), "ca_home") {
		t.Fatalf("choose message = %v", err)
	}
}

func TestAppsSearchViewShowsOnlyTheSpacePicks(t *testing.T) {
	var result composio.SearchResult
	if err := json.Unmarshal([]byte(`{"success":true,"toolkit_connection_statuses":[
		{"toolkit":"gmail","has_active_connection":true,"accounts":[{"id":"ca_work","status":"ACTIVE"},{"id":"ca_home","status":"ACTIVE"}]},
		{"toolkit":"slack","has_active_connection":true,"accounts":[{"id":"ca_slack","status":"ACTIVE"}]}]}`), &result); err != nil {
		t.Fatal(err)
	}
	accounts := []composio.Account{testAccount(t, "ca_work", "gmail", "ACTIVE"), testAccount(t, "ca_home", "gmail", "ACTIVE"), testAccount(t, "ca_slack", "slack", "ACTIVE")}
	work := newSpaceApps("space_work", accounts, []db.SpaceIntegrationPick{{SpaceID: "space_work", IntegrationAccount: db.IntegrationAccount{ID: "ca_work", Toolkit: "gmail"}}})
	encoded, _ := json.Marshal(appsSearchView(result, searchAppPolicy{}, work))
	text := string(encoded)
	if strings.Contains(text, "ca_home") || strings.Contains(text, "ca_slack") || !strings.Contains(text, "ca_work") {
		t.Fatalf("search leaked accounts from other Spaces: %s", text)
	}
	if !strings.Contains(text, "so they can pick one") {
		t.Fatalf("an unpicked app must ask to pick: %s", text)
	}
}

package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/kannachi323/misty/server/internal/appcatalog"
	. "github.com/kannachi323/misty/server/internal/platform/httpapi"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func TestPersonalAppHTTPBoundaryRejectsCollaborativeRoutes(t *testing.T) {
	for _, appID := range []string{"chat", "journal", "planner", "library", "files", "browser"} {
		app, ok := appcatalog.Find(appID)
		if !ok {
			t.Fatal(appID)
		}
		for _, scope := range app.Scopes {
			for _, prefix := range []string{"spaces.", "messages.", "notes.", "drawings.", "tasks.", "calendar.", "roadmaps.", "library.", "activity."} {
				if strings.HasPrefix(scope, prefix) {
					t.Fatalf("%s has shared grant %s", appID, scope)
				}
			}
		}
		for _, spaceID := range []string{"", "old-space"} {
			session := db.AppRuntimeSession{AppID: appID, SpaceID: spaceID, Scopes: append(app.Scopes, "spaces.read", "calendar.write", "activity.read", "search.read")}
			for _, path := range []string{"/v1/spaces", "/v1/spaces/old-space/notes", "/v1/spaces/old-space/calendar/events", "/v1/spaces/old-space/integrations", "/v1/search/global", "/v1/activity/inbox"} {
				for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
					if TestingAuthorizeAppRuntimeRequest(session, method, path) {
						t.Fatalf("personal app accessed %s %s", method, path)
					}
				}
			}
		}
	}
}

func TestAppStorageRequiresReadAndWriteGrants(t *testing.T) {
	for _, scope := range []string{"", "storage.read", "storage.write"} {
		session := db.AppRuntimeSession{AppID: "planner", Scopes: []string{scope}}
		for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
			path, expectedScope := "/v1/app-runtime/records", "storage.read"
			if method != http.MethodGet {
				path += "/key"
				expectedScope = "storage.write"
			}
			if got := TestingAuthorizeAppRuntimeRequest(session, method, path); got != (scope == expectedScope) {
				t.Errorf("%s %s with %q = %v", method, path, scope, got)
			}
		}
	}
}

func TestAppRuntimeAuthorizationSupportsExplicitAccountCapabilities(t *testing.T) {
	session := db.AppRuntimeSession{
		AppID:  "inbox",
		Scopes: []string{"mail.read", "mail.write", "connections.read", "profile.read", "ai.read", "ai.write", "activity.read", "activity.write"},
	}
	tests := []struct {
		method, path string
		allowed      bool
	}{
		{http.MethodGet, "/v1/mail/threads", true},
		{http.MethodPost, "/v1/mail/drafts", true},
		{http.MethodDelete, "/v1/mail/threads/thread_1", true},
		{http.MethodGet, "/v1/cloud/connections", true},
		{http.MethodDelete, "/v1/cloud/connections/cloud_1", false},
		{http.MethodGet, "/v1/me", true},
		{http.MethodPut, "/v1/me/profile", false},
		{http.MethodPost, "/v1/ai/complete", true},
		{http.MethodGet, "/v1/misty/conversations", true},
		{http.MethodPost, "/v1/misty/conversations", true},
		{http.MethodGet, "/v1/activity/inbox", false},
		{http.MethodPost, "/v1/activity/inbox/seen", false},
		{http.MethodGet, "/v1/agents", false},
		{http.MethodGet, "/v1/apps", false},
	}
	for _, test := range tests {
		if got := TestingAuthorizeAppRuntimeRequest(session, test.method, test.path); got != test.allowed {
			t.Errorf("authorize(%s %s) = %v, want %v", test.method, test.path, got, test.allowed)
		}
	}
}

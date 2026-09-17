package api

import (
	"github.com/kannachi323/misty/server/internal/capabilities"
	"net/http"
	"net/url"
	"strings"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// TestingAuthorizeAppRuntimeRequest is the server-side capability boundary for
// hosted apps. Unknown routes are denied by default, even when the token is
// otherwise valid.
func TestingAuthorizeAppRuntimeRequest(session db.AppRuntimeSession, method, path string) bool {
	path = unversionedAPIPath(path)
	// Personal app tokens never inherit collaborative Space access.
	if session.SpaceID != "" || path == "/spaces" || strings.HasPrefix(path, "/spaces/") || path == "/search/global" || path == "/activity" || strings.HasPrefix(path, "/activity/") {
		return false
	}
	// Broad agents.write must never authorize the app to approve its own work.
	if method != http.MethodGet && method != http.MethodHead {
		for _, segment := range strings.Split(strings.Trim(path, "/"), "/") {
			if segment == "approval" || segment == "approvals" || segment == "permissions" || segment == "capability-grants" {
				return false
			}
		}
	}
	if strings.HasPrefix(path, "/capabilities/") {
		// Registration is account scoped and authenticated as the installed app.
		// The handler also checks the provider owner and exact reviewed manifest.
		if path == "/capabilities/providers" {
			return method == http.MethodPost && session.SpaceID == "" && hasAppScope(session, "capabilities.providers.write")
		}
		if strings.HasPrefix(path, "/capabilities/providers/") {
			provider := strings.TrimPrefix(path, "/capabilities/providers/")
			availability := strings.HasSuffix(provider, "/availability")
			if availability {
				provider = strings.TrimSuffix(provider, "/availability")
			}
			provider, err := url.PathUnescape(provider)
			return err == nil && capabilities.ValidProviderID(provider) && strings.Split(provider, "/")[0] == session.AppID && session.SpaceID == "" && hasAppScope(session, "capabilities.providers.write") && ((availability && method == http.MethodPut) || (!availability && method == http.MethodDelete))
		}
		if path == "/capabilities/invocations" {
			return method == http.MethodPost && hasAppScope(session, "capabilities.invoke")
		}
		if strings.HasPrefix(path, "/capabilities/invocations/") {
			requestID := strings.TrimPrefix(path, "/capabilities/invocations/")
			cancel := strings.HasSuffix(requestID, "/cancel")
			if cancel {
				requestID = strings.TrimSuffix(requestID, "/cancel")
			}
			return capabilities.ValidID(requestID) && ((cancel && method == http.MethodPost && hasAppScope(session, "capabilities.invoke") && hasAppScope(session, "capabilities.read")) || (!cancel && method == http.MethodGet && hasAppScope(session, "capabilities.read")))
		}
		return (path == "/capabilities/discover" || path == "/capabilities/targets/resolve") && method == http.MethodPost && hasAppScope(session, "capabilities.read")
	}
	if path == "/billing/usage" {
		return method == http.MethodGet && hasAppScope(session, "ai.read")
	}
	if path == "/app-runtime/session" {
		return method == http.MethodGet
	}
	if path == "/app-runtime/records" {
		return method == http.MethodGet && hasAppScope(session, "storage.read")
	}
	if strings.HasPrefix(path, "/app-runtime/records/") {
		return (method == http.MethodPut || method == http.MethodDelete) && hasAppScope(session, "storage.write")
	}
	if domain := accountAppRuntimeDomain(path); domain != "" {
		access := "write"
		if method == http.MethodGet || method == http.MethodHead {
			access = "read"
		}
		return hasAppScope(session, domain+"."+access)
	}
	return false
}

func accountAppRuntimeDomain(path string) string {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	if len(segments) == 0 {
		return ""
	}
	switch segments[0] {
	case "activity":
		return "activity"
	case "me":
		if len(segments) == 1 || (len(segments) == 2 && segments[1] == "avatar") {
			return "profile"
		}
	case "mail":
		return "mail"
	case "connections", "cloud":
		return "connections"
	case "agents", "agent-runs", "agent-voice", "runs":
		return "agents"
	case "mcp":
		return "mcp"
	case "automations":
		return "automations"
	case "devices":
		return "devices"
	case "search":
		return "search"
	case "ai":
		if len(segments) > 1 && segments[1] == "media-search" {
			return "media-search"
		}
		if len(segments) > 1 && segments[1] == "smart-library" {
			return "library"
		}
		return "ai"
	case "misty":
		return "ai"
	}
	return ""
}

func hasAppScope(session db.AppRuntimeSession, expected string) bool {
	for _, scope := range session.Scopes {
		if scope == expected {
			return true
		}
	}
	return false
}

func unversionedAPIPath(path string) string {
	path = "/" + strings.TrimLeft(strings.TrimSpace(path), "/")
	if strings.HasPrefix(path, "/api/") {
		return strings.TrimPrefix(path, "/api")
	}
	if strings.HasPrefix(path, "/v1/") {
		return strings.TrimPrefix(path, "/v1")
	}
	return path
}

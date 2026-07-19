package api

import (
	"net/http/httptest"
	"testing"
)

func TestProviderOAuthAvailabilityCatalogReportsServerConfiguration(t *testing.T) {
	for _, definition := range providerOAuthCatalog {
		t.Setenv(definition.ClientIDEnv, "")
		t.Setenv(definition.ClientSecretEnv, "")
	}
	t.Setenv("GOOGLE_CLIENT_ID", "google-client")
	t.Setenv("GOOGLE_CLIENT_SECRET", "google-secret")

	providers := providerOAuthAvailabilityCatalog()
	if len(providers) != len(providerOAuthCatalog) {
		t.Fatalf("provider availability count = %d, want %d", len(providers), len(providerOAuthCatalog))
	}
	for index, provider := range providers {
		if index > 0 && providers[index-1].Provider > provider.Provider {
			t.Fatalf("provider availability is not sorted: %+v", providers)
		}
		if provider.Configured != (provider.Provider == "google") {
			t.Fatalf("provider %q configured = %v", provider.Provider, provider.Configured)
		}
	}
}

func TestGoogleProviderOAuthUsesOnlyCanonicalServerEnvironmentNames(t *testing.T) {
	t.Setenv("GOOGLE_OAUTH_CLIENT_ID", "ignored-oauth-client")
	t.Setenv("GOOGLE_OAUTH_CLIENT_SECRET", "ignored-oauth-secret")
	t.Setenv("GOOGLE_CLIENT_ID", "canonical-client")
	t.Setenv("GOOGLE_CLIENT_SECRET", "canonical-secret")

	definition := providerOAuthCatalog["google"]
	if definition.ClientIDEnv != "GOOGLE_CLIENT_ID" || definition.ClientSecretEnv != "GOOGLE_CLIENT_SECRET" {
		t.Fatalf("Google environment contract = %q/%q", definition.ClientIDEnv, definition.ClientSecretEnv)
	}
	if got := providerOAuthClientID(definition); got != "canonical-client" {
		t.Fatalf("Google client ID = %q", got)
	}
	if got := providerOAuthClientSecret(definition); got != "canonical-secret" {
		t.Fatalf("Google client secret = %q", got)
	}
	t.Setenv("GOOGLE_CLIENT_ID", "")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")
	if got := providerOAuthClientID(definition); got != "" {
		t.Fatalf("deprecated OAuth client ID was accepted: %q", got)
	}
	if got := providerOAuthClientSecret(definition); got != "" {
		t.Fatalf("deprecated OAuth client secret was accepted: %q", got)
	}
	availability := providerOAuthAvailabilityCatalog()
	for _, provider := range availability {
		if provider.Provider == "google" && provider.Configured {
			t.Fatal("Google should be unavailable when only deprecated OAuth environment names are set")
		}
	}
}

func TestProviderOAuthCatalogMatchesLaunchContract(t *testing.T) {
	want := []string{"google", "slack", "discord", "notion"}
	for _, provider := range want {
		definition, ok := providerOAuthCatalog[provider]
		if !ok || definition.AuthorizeURL == "" || definition.TokenURL == "" || definition.ClientIDEnv == "" || definition.ClientSecretEnv == "" {
			t.Fatalf("provider %q is not production-configurable: %+v", provider, definition)
		}
	}
	if len(providerOAuthCatalog) != len(want) {
		t.Fatalf("unexpected providers in catalog: got %d want %d", len(providerOAuthCatalog), len(want))
	}
	for _, forbidden := range []string{"apple_calendar", "gmail", "outlook_mail", "outlook_calendar", "microsoft_teams", "google_drive", "onedrive", "sharepoint", "dropbox", "github", "jira", "zoom", "webhook", "custom_webhook", "obsidian"} {
		if _, exists := providerOAuthCatalog[forbidden]; exists {
			t.Fatalf("forbidden provider %q is registered", forbidden)
		}
	}
}

func TestProviderReturnPathRejectsExternalAndHeaderInjection(t *testing.T) {
	for _, valid := range []string{"", "/spaces/space-1/agents", "/oauth/complete?tab=connections"} {
		if !validProviderReturnPath(valid) {
			t.Fatalf("expected %q to be valid", valid)
		}
	}
	for _, invalid := range []string{"https://example.com", "//example.com", `/\\example.com`, "/safe\r\nLocation: https://example.com"} {
		if validProviderReturnPath(invalid) {
			t.Fatalf("expected %q to be rejected", invalid)
		}
	}
}

func TestProviderCompletionReturnsToOriginatingDesktopRoute(t *testing.T) {
	t.Setenv("MISTY_DESKTOP_OAUTH_RETURN_URL", "")
	got := providerCompletionURL("notion", "/spaces/space-1/agents?tab=settings")
	want := "misty://open/spaces/space-1/agents?provider=notion&status=connected&tab=settings"
	if got != want {
		t.Fatalf("providerCompletionURL() = %q, want %q", got, want)
	}
}

func TestProviderCompletionPreservesConfiguredWebFallback(t *testing.T) {
	t.Setenv("MISTY_DESKTOP_OAUTH_RETURN_URL", "https://app.mistysys.com/oauth/complete")
	got := providerCompletionURL("slack", "/spaces/space-1/agents")
	want := "https://app.mistysys.com/oauth/complete?provider=slack&return_to=%2Fspaces%2Fspace-1%2Fagents&status=connected"
	if got != want {
		t.Fatalf("providerCompletionURL() = %q, want %q", got, want)
	}
}

func TestProviderURLsUseConfiguredFullAPIBaseWithoutDuplicatingPath(t *testing.T) {
	for _, base := range []string{"https://mistysys.com/api", "https://mistysys.com/api/v2"} {
		t.Run(base, func(t *testing.T) {
			t.Setenv("MISTY_PUBLIC_API_URL", base)
			request := httptest.NewRequest("POST", "https://internal.example/api/spaces/space-1/integrations/google/authorize", nil)
			if got, want := providerCallbackURL(request, "google"), base+"/oauth/providers/google/callback"; got != want {
				t.Fatalf("providerCallbackURL() = %q, want %q", got, want)
			}
			if got, want := providerInfrastructureURL("google", "calendar"), base+"/provider-callbacks/google/calendar"; got != want {
				t.Fatalf("providerInfrastructureURL() = %q, want %q", got, want)
			}
		})
	}
}

func TestProviderURLsKeepOriginOnlyConfigurationCompatible(t *testing.T) {
	t.Setenv("MISTY_PUBLIC_API_URL", "https://mistysys.com")
	request := httptest.NewRequest("POST", "https://internal.example/api/spaces/space-1/integrations/notion/authorize", nil)
	if got, want := providerCallbackURL(request, "notion"), "https://mistysys.com/api/oauth/providers/notion/callback"; got != want {
		t.Fatalf("providerCallbackURL() = %q, want %q", got, want)
	}
}

func TestProviderCallbackFallbackPreservesRequestAPIPrefix(t *testing.T) {
	t.Setenv("MISTY_PUBLIC_API_URL", "")
	for _, item := range []struct{ path, want string }{
		{"/api/spaces/space-1/integrations/slack/authorize", "https://mistysys.com/api/oauth/providers/slack/callback"},
		{"/api/v2/spaces/space-1/integrations/slack/authorize", "https://mistysys.com/api/v2/oauth/providers/slack/callback"},
		{"/spaces/space-1/integrations/slack/authorize", "https://mistysys.com/oauth/providers/slack/callback"},
	} {
		request := httptest.NewRequest("POST", "https://mistysys.com"+item.path, nil)
		if got := providerCallbackURL(request, "slack"); got != item.want {
			t.Fatalf("providerCallbackURL(%q) = %q, want %q", item.path, got, item.want)
		}
	}
}

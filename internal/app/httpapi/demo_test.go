package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func TestDemoServiceSafetyGates(t *testing.T) {
	database := &db.Database{}
	store := NewMemoryLibraryObjectStore()
	valid := DemoConfig{
		Mode: "local", AdminToken: strings.Repeat("a", 32),
		Environment: "development", DatabaseName: "misty_demo", StorageName: "/tmp/misty-demo-library",
	}
	if service, err := NewDemoService(database, store, valid); err != nil || service == nil {
		t.Fatalf("NewDemoService(valid) = %#v, %v", service, err)
	}

	tests := []struct {
		name   string
		mutate func(*DemoConfig)
	}{
		{name: "unknown mode", mutate: func(config *DemoConfig) { config.Mode = "preview" }},
		{name: "production", mutate: func(config *DemoConfig) { config.Environment = "production" }},
		{name: "shared database", mutate: func(config *DemoConfig) { config.DatabaseName = "misty_server" }},
		{name: "shared storage", mutate: func(config *DemoConfig) { config.StorageName = "misty-shared" }},
		{name: "short token", mutate: func(config *DemoConfig) { config.AdminToken = "too-short" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config := valid
			test.mutate(&config)
			if service, err := NewDemoService(database, store, config); err == nil || service != nil {
				t.Fatalf("NewDemoService(%s) = %#v, %v; want refusal", test.name, service, err)
			}
		})
	}
}

func TestDemoServiceAdminAuthentication(t *testing.T) {
	token := strings.Repeat("s", 32)
	service, err := NewDemoService(&db.Database{}, NewMemoryLibraryObjectStore(), DemoConfig{
		Mode: "staging", AdminToken: token, Environment: "staging",
		DatabaseName: "misty_demo_staging", StorageName: "misty-demo-staging",
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "/api/internal/demo/status", nil)
	if service.authorized(request) {
		t.Fatal("request without the admin token was authorized")
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if !service.authorized(request) {
		t.Fatal("request with the exact admin token was rejected")
	}
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("x", 32))
	if service.authorized(request) {
		t.Fatal("request with a different same-length token was authorized")
	}
}

func TestDemoServiceDisabledWithoutMode(t *testing.T) {
	service, err := NewDemoService(&db.Database{}, NewMemoryLibraryObjectStore(), DemoConfig{})
	if err != nil || service != nil {
		t.Fatalf("NewDemoService(disabled) = %#v, %v", service, err)
	}
}

func TestDemoResetBodyPinsScenarioAndConfirmation(t *testing.T) {
	body := string(demoResetRequestBody())
	if !strings.Contains(body, demoScenarioVersion) || !strings.Contains(body, demoResetConfirm) {
		t.Fatalf("demo reset body = %s", body)
	}
}

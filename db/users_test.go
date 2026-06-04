package db

import "testing"

func TestCreateUserNormalizesEmailAndCreatesLicense(t *testing.T) {
	database := openTestDatabase(t)

	user, err := database.CreateUser("Ada", "  Ada@Example.com ", "password123")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	if user.Email != "ada@example.com" {
		t.Fatalf("user.Email = %q, want %q", user.Email, "ada@example.com")
	}

	license, err := database.GetLicenseByUserID(user.ID)
	if err != nil || license == nil {
		t.Fatalf("GetLicenseByUserID() error = %v, license = %#v", err, license)
	}
	if license.ID != user.LicenseID {
		t.Fatalf("license.ID = %q, want %q", license.ID, user.LicenseID)
	}

	if _, err := database.CreateUser("Ada Duplicate", "ada@example.com", "password123"); err == nil {
		t.Fatal("CreateUser() succeeded for duplicate email")
	}
}

func TestUserSettingsDefaultAndUpdate(t *testing.T) {
	database := openTestDatabase(t)

	user, err := database.CreateUser("Ada", "ada@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	settings, err := database.GetUserSettingsByID(user.ID)
	if err != nil {
		t.Fatalf("GetUserSettingsByID() error = %v", err)
	}
	if settings == nil {
		t.Fatal("GetUserSettingsByID() returned nil settings")
	}
	if settings.EmailUpdatesEnabled {
		t.Fatal("EmailUpdatesEnabled = true, want false")
	}

	if err := database.UpdateUserSettings(user.ID, UserSettings{EmailUpdatesEnabled: true}); err != nil {
		t.Fatalf("UpdateUserSettings() error = %v", err)
	}

	settings, err = database.GetUserSettingsByID(user.ID)
	if err != nil {
		t.Fatalf("GetUserSettingsByID() after update error = %v", err)
	}
	if settings == nil || !settings.EmailUpdatesEnabled {
		t.Fatalf("settings after update = %#v, want email updates enabled", settings)
	}
}

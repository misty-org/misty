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

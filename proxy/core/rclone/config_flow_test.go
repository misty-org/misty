package rclone

import "testing"

func TestProviderNeedsFullConfig(t *testing.T) {
	if !providerNeedsFullConfig("s3") {
		t.Fatal("expected s3 to require full config")
	}
	if !providerNeedsFullConfig("sftp") {
		t.Fatal("expected sftp to require full config")
	}
	if providerNeedsFullConfig("onedrive") {
		t.Fatal("did not expect onedrive to require full config")
	}
}

func TestConfigEnvKeyNormalizesRemoteAndKey(t *testing.T) {
	got := configEnvKey("drive-alice@example.com", "config_template_file")
	want := "RCLONE_CONFIG_DRIVE_ALICE_EXAMPLE_COM_CONFIG_TEMPLATE_FILE"
	if got != want {
		t.Fatalf("configEnvKey() = %q, want %q", got, want)
	}
}

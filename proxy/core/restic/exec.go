package restic

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// passwordFileFor returns the dev-fallback password file path for a repo.
// password.go will replace this with an OS-keyring lookup once that lands.
func passwordFileFor(repo RepoConfig) string {
	return filepath.Join(registryDir, "passwords", repo.Name+".pwd")
}

// writePasswordFile persists a repo password to the dev-fallback file with
// restrictive permissions. Called once at repo init time.
func writePasswordFile(repo RepoConfig, password string) error {
	if err := Init(); err != nil {
		return err
	}
	if repo.Name == "" {
		return fmt.Errorf("repo name is required")
	}
	return os.WriteFile(passwordFileFor(repo), []byte(password), 0600)
}

// resticCmd builds an *exec.Cmd that targets the given repo. The password
// is supplied either via RESTIC_PASSWORD_COMMAND (keyring + helper binary)
// or RESTIC_PASSWORD_FILE (dev fallback) — never on argv, never in the
// environment as plaintext.
func resticCmd(ctx context.Context, repo RepoConfig, args ...string) (*exec.Cmd, error) {
	if err := Init(); err != nil {
		return nil, err
	}
	if repo.URL == "" {
		return nil, fmt.Errorf("repo URL is empty")
	}

	cmd := exec.CommandContext(ctx, binaryPath, args...)
	env := append(os.Environ(), "RESTIC_REPOSITORY="+repo.URL)

	if useKeyringFor(repo.Name) {
		// restic invokes this command with `sh -c` and reads the first
		// line of stdout as the password. Quote both args so repo names
		// with spaces or shell-meta survive intact.
		cmdLine := fmt.Sprintf("%q %q", HelperBinaryPath(), repo.Name)
		env = append(env, "RESTIC_PASSWORD_COMMAND="+cmdLine)
	} else {
		pwdFile := passwordFileFor(repo)
		if _, err := os.Stat(pwdFile); err != nil {
			return nil, fmt.Errorf("password for repo %q not found in keyring or fallback file: %w", repo.Name, err)
		}
		env = append(env, "RESTIC_PASSWORD_FILE="+pwdFile)
	}

	cmd.Env = env
	return cmd, nil
}

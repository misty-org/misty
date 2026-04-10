package restic

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func binaryNameForPlatform(base string) string {
	if runtime.GOOS == "windows" {
		return base + ".exe"
	}
	return base
}

func bundledBinaryCandidates(baseName, executablePath, workingDir, homeDir string) []string {
	name := binaryNameForPlatform(baseName)
	candidates := make([]string, 0, 6)
	seen := map[string]struct{}{}
	add := func(path string) {
		if path == "" {
			return
		}
		if _, ok := seen[path]; ok {
			return
		}
		seen[path] = struct{}{}
		candidates = append(candidates, path)
	}

	if workingDir != "" {
		if filepath.Base(workingDir) == "proxy" {
			add(filepath.Join(workingDir, "dist", name))
		} else {
			add(filepath.Join(workingDir, "proxy", "dist", name))
		}
	}

	if homeDir != "" {
		add(filepath.Join(homeDir, "misty", "bin", name))
	}

	if executablePath != "" {
		exeDir := filepath.Dir(executablePath)
		add(filepath.Join(exeDir, name))
		if runtime.GOOS == "darwin" {
			add(filepath.Join(exeDir, "..", "Resources", name))
		}
	}

	return candidates
}

func resolveBundledBinaryPath(baseName string) string {
	workingDir, _ := os.Getwd()
	homeDir, _ := os.UserHomeDir()
	executablePath, _ := os.Executable()

	for _, candidate := range bundledBinaryCandidates(baseName, executablePath, workingDir, homeDir) {
		if path, ok := executableCandidate(candidate); ok {
			return path
		}
	}
	return ""
}

func executableCandidate(path string) (string, bool) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return "", false
	}
	if info.Mode()&0111 == 0 {
		return "", false
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err == nil {
		return resolved, true
	}
	return path, true
}

func lookupPathBinary(baseName string) (string, bool) {
	path, err := exec.LookPath(binaryNameForPlatform(baseName))
	if err != nil {
		path, err = exec.LookPath(baseName)
	}
	if err != nil {
		return "", false
	}
	return path, true
}

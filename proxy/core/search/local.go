package search

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/junegunn/fzf/src/algo"
	"github.com/junegunn/fzf/src/util"
)

type Entry struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Path   string `json:"path"`
	Source string `json:"source"`
	IsDir  bool   `json:"is_dir"`
	Score  int    `json:"score"`
}

type Response struct {
	Items []Entry `json:"items"`
	Query string  `json:"query"`
	Path  string  `json:"path"`
}

var (
	initFzfOnce      sync.Once
	errSearchStopped = errors.New("search stopped")
)

const (
	maxScannedEntries = 2048
	searchTimeBudget  = 250 * time.Millisecond
)

func SearchLocal(ctx context.Context, root, query string, depth, maxResults int) ([]Entry, error) {
	root = strings.TrimSpace(root)
	query = strings.TrimSpace(query)
	if root == "" {
		return nil, errors.New("path is required")
	}
	if query == "" {
		return nil, errors.New("query is required")
	}
	if maxResults <= 0 {
		maxResults = 100
	}
	if depth < 0 {
		depth = 0
	}

	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("path must be a directory")
	}

	initFzfOnce.Do(func() {
		_ = algo.Init("path")
	})

	pattern := []rune(strings.ToLower(query))
	pattern = algo.NormalizeRunes(pattern)

	results := make([]Entry, 0, maxResults)
	deadline := time.Now().Add(searchTimeBudget)

	if depth == 0 {
		entries, err := os.ReadDir(root)
		if err != nil {
			return nil, err
		}

		scanned := 0
		for _, entry := range entries {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if scanned >= maxScannedEntries || time.Now().After(deadline) {
				break
			}
			scanned++

			name := entry.Name()
			score := scoreCandidate(name, pattern)
			if score <= 0 {
				continue
			}

			path := filepath.Join(root, name)
			absPath := path
			if resolved, err := filepath.Abs(path); err == nil {
				absPath = resolved
			}

			results = append(results, Entry{
				ID:     "local:" + absPath,
				Name:   name,
				Path:   absPath,
				Source: "LOCAL",
				IsDir:  entry.IsDir(),
				Score:  score,
			})
		}

		sortResults(results)
		if len(results) > maxResults {
			results = results[:maxResults]
		}
		return results, nil
	}

	scanned := 0
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return errSearchStopped
		}
		if scanned >= maxScannedEntries || time.Now().After(deadline) {
			return errSearchStopped
		}
		scanned++

		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		if rel == "." {
			return nil
		}

		localDepth := relativeDepth(rel)
		if d.IsDir() && localDepth >= depth {
			defer func() {
				// noop; explicit skip handled below
			}()
		}
		if localDepth > depth {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		name := d.Name()
		score := max(scoreCandidate(name, pattern), scoreCandidate(rel, pattern)-8)
		if score <= 0 {
			if d.IsDir() && localDepth >= depth {
				return filepath.SkipDir
			}
			return nil
		}

		absPath := path
		if resolved, err := filepath.Abs(path); err == nil {
			absPath = resolved
		}

		results = append(results, Entry{
			ID:     "local:" + absPath,
			Name:   name,
			Path:   absPath,
			Source: "LOCAL",
			IsDir:  d.IsDir(),
			Score:  score,
		})

		if d.IsDir() && localDepth >= depth {
			return filepath.SkipDir
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, errSearchStopped) {
		return nil, walkErr
	}
	if errors.Is(walkErr, errSearchStopped) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
	}

	sortResults(results)

	if len(results) > maxResults {
		results = results[:maxResults]
	}
	return results, nil
}

func sortResults(results []Entry) {
	sort.Slice(results, func(i, j int) bool {
		if results[i].Score != results[j].Score {
			return results[i].Score > results[j].Score
		}
		if results[i].IsDir != results[j].IsDir {
			return results[i].IsDir && !results[j].IsDir
		}
		if results[i].Name != results[j].Name {
			return strings.ToLower(results[i].Name) < strings.ToLower(results[j].Name)
		}
		return results[i].Path < results[j].Path
	})
}

func scoreCandidate(candidate string, pattern []rune) int {
	if candidate == "" || len(pattern) == 0 {
		return -1
	}
	chars := util.ToChars([]byte(candidate))
	res, _ := algo.FuzzyMatchV2(false, true, true, &chars, pattern, false, nil)
	if res.Start < 0 || res.Score <= 0 {
		return -1
	}
	return res.Score
}

func relativeDepth(rel string) int {
	if rel == "." || rel == "" {
		return -1
	}
	cleaned := filepath.Clean(rel)
	if cleaned == "." {
		return -1
	}
	return len(strings.Split(cleaned, string(filepath.Separator))) - 1
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

package search

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	coresearch "github.com/kannachi323/misty/proxy/core/search"
)

type SearchSource string

const (
	SearchSourceLocal  SearchSource = "LOCAL"
	SearchSourceRemote SearchSource = "REMOTE"
	SearchSourceAll    SearchSource = "ALL"
)

type SearchDepth string

const (
	SearchDepthCWD       SearchDepth = "CWD"
	SearchDepthDepth     SearchDepth = "DEPTH"
	SearchDepthSystem    SearchDepth = "SYSTEM"
	SearchDepthWorkspace SearchDepth = "WORKSPACE"
)

type SearchScope struct {
	Scope SearchDepth `json:"scope"`
	Depth *int        `json:"depth,omitempty"`
}

type SearchQuery struct {
	Query  string       `json:"query"`
	Path   string       `json:"path"`
	Source SearchSource `json:"source"`
	Depth  SearchScope  `json:"depth"`
}

func Search() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req SearchQuery
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		req.Query = strings.TrimSpace(req.Query)
		req.Path = strings.TrimSpace(req.Path)
		if req.Query == "" || req.Path == "" {
			http.Error(w, "query and path are required", http.StatusBadRequest)
			return
		}
		if req.Source == "" {
			req.Source = SearchSourceLocal
		}
		if req.Source != SearchSourceLocal {
			http.Error(w, "only LOCAL search is currently supported", http.StatusNotImplemented)
			return
		}

		maxResults := 100
		depth, err := normalizeDepth(req.Depth)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotImplemented)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		items, err := coresearch.SearchLocal(ctx, req.Path, req.Query, depth, maxResults)
		if err != nil {
			switch {
			case os.IsNotExist(err):
				http.Error(w, err.Error(), http.StatusNotFound)
			case errors.Is(err, os.ErrInvalid):
				http.Error(w, err.Error(), http.StatusBadRequest)
			case errors.Is(err, context.DeadlineExceeded):
				http.Error(w, "search timed out", http.StatusGatewayTimeout)
			case err.Error() == "path must be a directory":
				http.Error(w, err.Error(), http.StatusBadRequest)
			default:
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(coresearch.Response{
			Items: items,
			Query: req.Query,
			Path:  req.Path,
		})
	}
}

func normalizeDepth(scope SearchScope) (int, error) {
	switch scope.Scope {
	case "", SearchDepthCWD:
		return 0, nil
	case SearchDepthDepth:
		if scope.Depth == nil {
			return 0, nil
		}
		if *scope.Depth < 0 {
			return 0, nil
		}
		return *scope.Depth, nil
	case SearchDepthSystem:
		return 0, errors.New("SYSTEM scope is not implemented for LOCAL search")
	case SearchDepthWorkspace:
		return 0, errors.New("WORKSPACE scope is not implemented for LOCAL search")
	default:
		return 0, nil
	}
}

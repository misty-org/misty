package api

import (
	"context"

	serveragent "github.com/kannachi323/misty/server/internal/agents"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// validateCodingScope checks that a project or repository scope belongs to the
// person. Until projects register with the server, no such grant can be made.
func (s *SpacesService) validateCodingScope(ctx context.Context, user string, kind serveragent.ScopeKind, id string) error {
	return db.ErrSpaceForbidden
}

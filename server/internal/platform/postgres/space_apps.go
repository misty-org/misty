package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

const PermissionAppsManage = "apps.manage" // historical role value; grants no app authority
var ErrAppDependencies = errors.New("remove dependent apps first")

type SpaceAppInstallation struct {
	SpaceID             string          `json:"space_id"`
	AppID               string          `json:"app_id"`
	State               string          `json:"state"`
	InstalledVersion    string          `json:"installed_version"`
	PermissionVersion   int             `json:"permission_version"`
	GrantedScopes       []string        `json:"granted_scopes"`
	PinRank             int64           `json:"pin_rank"`
	AuthorityGeneration int64           `json:"authority_generation"`
	ReleaseMetadata     json.RawMessage `json:"release_metadata"`
	InstalledAt         time.Time       `json:"installed_at"`
	UninstalledAt       *time.Time      `json:"uninstalled_at,omitempty"`
	UpdatedAt           time.Time       `json:"updated_at"`
}

// Deprecated Space allowlists cannot grant personal consent. Use UserApps and
// account-owned installation methods. Historical rows are migration provenance.
func (db *Database) SpaceApps(context.Context, string, string) ([]SpaceAppInstallation, error) {
	return []SpaceAppInstallation{}, nil
}
func (db *Database) InstallSpaceApp(context.Context, string, string, AppInstallSpec, json.RawMessage) (*SpaceAppInstallation, error) {
	return nil, ErrAppRuntimeForbidden
}
func (db *Database) RemoveSpaceApp(context.Context, string, string, string) (*SpaceAppInstallation, error) {
	return nil, ErrAppRuntimeForbidden
}
func (db *Database) ReorderSpaceApps(context.Context, string, string, []string) error {
	return ErrAppRuntimeForbidden
}
func (db *Database) RequireSpaceApp(context.Context, string, string, string) error {
	return ErrAppRuntimeForbidden
}
func lockSpaceApps(ctx context.Context, tx *sql.Tx, spaceID string) error {
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "space:"+spaceID)
	return err
}

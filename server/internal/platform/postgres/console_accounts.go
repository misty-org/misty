package db

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

// Operator console queries. They run in service RLS scope because the console
// administers every account; the console process is loopback-only and never
// mounted on the public API.

type ConsoleAccount struct {
	ID         string
	Email      string
	Username   string
	Name       string
	State      string
	Tier       string
	CreatedAt  time.Time
	SelfHosted bool
	Disabled   bool
	Admin      bool
	Devices    int
	Sessions   int
}

type ConsoleDevice struct {
	Name     string
	Platform string
	LastSeen time.Time
	Revoked  bool
}

type ConsoleAccountDetail struct {
	ConsoleAccount
	LicenseStatus  string
	StorageBytes   int64
	SyncWorkspaces int // per-device-sign-in workspaces, excluding the shared one
	DeviceList     []ConsoleDevice
}

func (db *Database) consoleTx(ctx context.Context, fn func(*sql.Tx) error) error {
	return db.TestingWithRLSContext(ctx, TestingServiceRLSSettings(), fn)
}

const consoleAccountColumns = `
	u.id, u.email, u.username, u.name, u.lifecycle_state, u.created_at,
	COALESCE(l.tier, ''), sha.user_id IS NOT NULL,
	COALESCE(sha.disabled_at IS NOT NULL, false), COALESCE(sha.is_admin, false),
	(SELECT count(*) FROM trusted_devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL),
	(SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now())
	FROM users u
	LEFT JOIN licenses l ON l.id = u.license_id
	LEFT JOIN self_host_accounts sha ON sha.user_id = u.id`

func scanConsoleAccount(row interface{ Scan(...any) error }, a *ConsoleAccount) error {
	return row.Scan(&a.ID, &a.Email, &a.Username, &a.Name, &a.State, &a.CreatedAt,
		&a.Tier, &a.SelfHosted, &a.Disabled, &a.Admin, &a.Devices, &a.Sessions)
}

// ConsoleListAccounts returns the newest accounts matching an email, username
// or name fragment.
func (db *Database) ConsoleListAccounts(ctx context.Context, search string, limit int) ([]ConsoleAccount, error) {
	pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.TrimSpace(search)) + "%"
	var accounts []ConsoleAccount
	err := db.consoleTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT `+consoleAccountColumns+`
			WHERE u.lifecycle_state <> 'deleted'
			  AND (u.email ILIKE $1 OR u.username ILIKE $1 OR u.name ILIKE $1)
			ORDER BY u.created_at DESC LIMIT $2`, pattern, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a ConsoleAccount
			if err := scanConsoleAccount(rows, &a); err != nil {
				return err
			}
			accounts = append(accounts, a)
		}
		return rows.Err()
	})
	return accounts, err
}

func (db *Database) ConsoleAccountDetail(ctx context.Context, userID string) (ConsoleAccountDetail, error) {
	var d ConsoleAccountDetail
	err := db.consoleTx(ctx, func(tx *sql.Tx) error {
		row := tx.QueryRowContext(ctx, `SELECT `+consoleAccountColumns+` WHERE u.id = $1`, userID)
		if err := scanConsoleAccount(row, &d.ConsoleAccount); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE((SELECT l.status FROM licenses l JOIN users u ON u.license_id = l.id WHERE u.id = $1), ''),
			       COALESCE((SELECT used_bytes FROM owner_storage_usage WHERE owner_user_id = $1), 0),
			       (SELECT count(*) FROM browser_sync_workspaces w
			        JOIN browser_sync_vaults v ON v.vault_id = w.vault_id
			        WHERE v.user_id = $1 AND w.workspace_id <> w.vault_id)`, userID,
		).Scan(&d.LicenseStatus, &d.StorageBytes, &d.SyncWorkspaces); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT name, platform, last_seen_at, revoked_at IS NOT NULL
			FROM trusted_devices WHERE user_id = $1
			ORDER BY revoked_at IS NOT NULL, last_seen_at DESC LIMIT 20`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var device ConsoleDevice
			if err := rows.Scan(&device.Name, &device.Platform, &device.LastSeen, &device.Revoked); err != nil {
				return err
			}
			d.DeviceList = append(d.DeviceList, device)
		}
		return rows.Err()
	})
	return d, err
}

// ConsoleRevokeSessions signs the account out everywhere.
func (db *Database) ConsoleRevokeSessions(ctx context.Context, userID string) (int64, error) {
	var revoked int64
	err := db.consoleTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID)
		if err != nil {
			return err
		}
		revoked, err = result.RowsAffected()
		return err
	})
	return revoked, err
}

// ConsoleSetSelfHostDisabled disables (and signs out) or re-enables a
// self-hosted account. Hosted accounts have no disabled state.
func (db *Database) ConsoleSetSelfHostDisabled(ctx context.Context, userID string, disabled bool) error {
	return db.consoleTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `
			UPDATE self_host_accounts
			SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now()
			WHERE user_id = $1`, userID, disabled)
		if err != nil {
			return err
		}
		if rows, _ := result.RowsAffected(); rows != 1 {
			return sql.ErrNoRows
		}
		if disabled {
			_, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID)
		}
		return err
	})
}

// ConsoleInstanceBootstrapped reports whether a self-hosted instance already
// has its first administrator.
func (db *Database) ConsoleInstanceBootstrapped(ctx context.Context) (bool, error) {
	var bootstrapped bool
	err := db.consoleTx(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM self_host_accounts)`).Scan(&bootstrapped)
	})
	return bootstrapped, err
}

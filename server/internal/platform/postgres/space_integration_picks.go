package db

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
)

// The integrations tree: each Space lists which of its member's connected app
// accounts it uses. Picks are private to their owner; Composio keeps the tokens.

var (
	integrationAccountPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)
	integrationToolkitPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,63}$`)
)

// IntegrationAccount is one connected account as the picks know it.
type IntegrationAccount struct {
	ID      string `json:"id"`
	Toolkit string `json:"app"`
}

func (a IntegrationAccount) valid() bool {
	return integrationAccountPattern.MatchString(a.ID) && integrationToolkitPattern.MatchString(a.Toolkit)
}

// SpaceIntegrationPick is one account a Space uses.
type SpaceIntegrationPick struct {
	SpaceID string `json:"space_id"`
	IntegrationAccount
}

// PersonalSpaceID is the person's own default Space.
func (db *Database) PersonalSpaceID(ctx context.Context, user string) (string, error) {
	var id string
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT id FROM spaces WHERE owner_user_id=$1 AND is_default AND lifecycle_state='active'`, user).Scan(&id)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrSpaceNotFound
	}
	return id, err
}

// SpaceIntegrationPicks lists the person's picks in one Space, or in every
// Space when spaceID is empty. Nobody else's picks are ever returned.
func (db *Database) SpaceIntegrationPicks(ctx context.Context, user, spaceID string) ([]SpaceIntegrationPick, error) {
	picks := []SpaceIntegrationPick{}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT space_id,connected_account_id,toolkit FROM space_integration_picks
			WHERE owner_user_id=$1 AND ($2='' OR space_id=$2) ORDER BY space_id,toolkit,picked_at`, user, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var pick SpaceIntegrationPick
			if err := rows.Scan(&pick.SpaceID, &pick.ID, &pick.Toolkit); err != nil {
				return err
			}
			picks = append(picks, pick)
		}
		return rows.Err()
	})
	return picks, err
}

// SetSpaceIntegrationPicks replaces the person's picks in one Space they are a
// member of. The caller checks that every account is the person's own.
func (db *Database) SetSpaceIntegrationPicks(ctx context.Context, user, spaceID string, accounts []IntegrationAccount) error {
	if len(accounts) > 200 {
		return ErrSpaceInvalid
	}
	for _, account := range accounts {
		if !account.valid() {
			return ErrSpaceInvalid
		}
	}
	return db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, user); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_integration_picks WHERE space_id=$1 AND owner_user_id=$2`, spaceID, user); err != nil {
			return err
		}
		for _, account := range accounts {
			if err := insertIntegrationPickTx(ctx, tx, spaceID, user, account); err != nil {
				return err
			}
		}
		return nil
	})
}

// AddSpaceIntegrationPick adds one account to a Space the person is in, unless
// the Space already uses another account of that app. It reports whether the
// account is now picked there.
func (db *Database) AddSpaceIntegrationPick(ctx context.Context, user, spaceID string, account IntegrationAccount, onlyIfNone bool) (bool, error) {
	if !account.valid() {
		return false, ErrSpaceInvalid
	}
	picked := false
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, user); err != nil {
			return err
		}
		if onlyIfNone {
			var other bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_integration_picks WHERE space_id=$1 AND owner_user_id=$2
				AND toolkit=$3 AND connected_account_id<>$4)`, spaceID, user, account.Toolkit, account.ID).Scan(&other); err != nil || other {
				return err
			}
		}
		picked = true
		return insertIntegrationPickTx(ctx, tx, spaceID, user, account)
	})
	return picked, err
}

func insertIntegrationPickTx(ctx context.Context, tx *sql.Tx, spaceID, user string, account IntegrationAccount) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO space_integration_picks(space_id,owner_user_id,connected_account_id,toolkit)
		VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, spaceID, user, account.ID, account.Toolkit)
	return err
}

// SeedSpaceIntegrationPicks picks every account Misty hasn't seen before in the
// person's personal Space. An account is seeded once, so unpicking it there
// later sticks.
func (db *Database) SeedSpaceIntegrationPicks(ctx context.Context, user string, accounts []IntegrationAccount) error {
	if len(accounts) == 0 {
		return nil
	}
	return db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		var personal string
		err := tx.QueryRowContext(ctx, `SELECT id FROM spaces WHERE owner_user_id=$1 AND is_default AND lifecycle_state='active'`, user).Scan(&personal)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		for _, account := range accounts {
			if !account.valid() {
				continue
			}
			inserted, err := tx.ExecContext(ctx, `INSERT INTO space_integration_seen(owner_user_id,connected_account_id) VALUES($1,$2)
				ON CONFLICT DO NOTHING`, user, account.ID)
			if err != nil {
				return err
			}
			if count, _ := inserted.RowsAffected(); count == 1 {
				if err := insertIntegrationPickTx(ctx, tx, personal, user, account); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// ForgetIntegrationAccount drops a disconnected account from every Space.
func (db *Database) ForgetIntegrationAccount(ctx context.Context, user, accountID string) error {
	return db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_integration_picks WHERE owner_user_id=$1 AND connected_account_id=$2`, user, accountID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM space_integration_seen WHERE owner_user_id=$1 AND connected_account_id=$2`, user, accountID)
		return err
	})
}

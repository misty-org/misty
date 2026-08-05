package db

import (
	"context"
	"database/sql"
	"errors"
)

// PersonalAgentAccessibleSpace is the deliberately small view exposed to a
// global personal-Agent chat. It contains no Space content and cannot be used
// to enumerate Spaces where either the member or Agent lacks access.
type PersonalAgentAccessibleSpace struct {
	ID      string `json:"space_id"`
	Name    string `json:"name"`
	CanSend bool   `json:"can_send"`
}

// AccessiblePersonalAgentSpaces re-checks member permissions and the durable
// Agent membership on every call. Global Agent sessions therefore notice
// grants, revocations, disabled memberships, and permission changes without a
// session refresh.
func (db *Database) AccessiblePersonalAgentSpaces(ctx context.Context, userID, agentID string) ([]PersonalAgentAccessibleSpace, error) {
	items := []PersonalAgentAccessibleSpace{}
	err := db.TestingSpaceTx(ctx, func(tx *sql.Tx) error {
		var enabled bool
		if err := tx.QueryRowContext(ctx, `SELECT enabled FROM personal_agents
			WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, agentID, userID).Scan(&enabled); errors.Is(err, sql.ErrNoRows) {
			return ErrPersonalAgentNotFound
		} else if err != nil {
			return err
		}
		if !enabled {
			return ErrPersonalAgentNotFound
		}
		rows, err := tx.QueryContext(ctx, `SELECT s.id,s.name,g.permissions
			FROM personal_agent_space_grants g
			JOIN spaces s ON s.id=g.space_id AND s.lifecycle_state='active'
			JOIN space_members sm ON sm.space_id=s.id AND sm.user_id=$1
			WHERE g.agent_id=$2 AND g.enabled AND g.removed_at IS NULL
			ORDER BY lower(s.name),s.id`, userID, agentID)
		if err != nil {
			return err
		}
		type candidate struct {
			id, name    string
			permissions []byte
		}
		candidates := []candidate{}
		for rows.Next() {
			var item candidate
			if err := rows.Scan(&item.id, &item.name, &item.permissions); err != nil {
				rows.Close()
				return err
			}
			candidates = append(candidates, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, candidate := range candidates {
			canRun, err := hasSpacePermissionTx(ctx, tx, userID, candidate.id, PermissionAgentsRun)
			if err != nil {
				return err
			}
			if !canRun {
				continue
			}
			canReadMessages, err := hasSpacePermissionTx(ctx, tx, userID, candidate.id, PermissionMessagesRead)
			if err != nil {
				return err
			}
			canWrite, err := hasSpacePermissionTx(ctx, tx, userID, candidate.id, PermissionMessagesWrite)
			if err != nil {
				return err
			}
			items = append(items, PersonalAgentAccessibleSpace{
				ID: candidate.id, Name: candidate.name,
				CanSend: canReadMessages && canWrite && agentMembershipPermission(candidate.permissions, PermissionMessagesRead) && agentMembershipPermission(candidate.permissions, PermissionMessagesWrite),
			})
		}
		return nil
	})
	return items, err
}

// CreatePersonalAgentSpaceMessage is the global-Agent write boundary. Unlike
// the internal reply helper, it atomically requires both the triggering member
// and the Agent membership to retain messages.read/write and agents.run.
func (db *Database) CreatePersonalAgentSpaceMessage(ctx context.Context, billingUserID, spaceID, agentID, text string) (*SpaceMessage, error) {
	return db.createSpaceAgentMessageWithMembership(ctx, billingUserID, spaceID, "", agentID, text, true)
}

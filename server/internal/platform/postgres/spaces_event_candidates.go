package db

import (
	"context"
	"database/sql"
)

// SpaceEventCandidateUsers narrows fanout to current Space members. This is only
// a candidate set: EventByIDForUser must still enforce resource and conversation ACLs.
func (db *Database) SpaceEventCandidateUsers(ctx context.Context, eventID int64) ([]string, error) {
	users := []string{}
	err := db.TestingSpaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT m.user_id FROM space_members m
   JOIN space_events e ON e.space_id=m.space_id WHERE e.id=$1`, eventID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var user string
			if err := rows.Scan(&user); err != nil {
				return err
			}
			users = append(users, user)
		}
		return rows.Err()
	})
	return users, err
}

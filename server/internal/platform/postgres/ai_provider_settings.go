package db

import (
	"context"
	"database/sql"
	"errors"
	"github.com/kannachi323/misty/server/internal/aimodels"
	"strings"
)

type AIProviderConnection struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Provider   string `json:"provider"`
	BaseURL    string `json:"base_url"`
	Ciphertext []byte `json:"-"`
	Nonce      []byte `json:"-"`
}

var ErrAIConnectionInUse = errors.New("choose another connection for its tasks before removing this connection")

func (db *Database) AIProviderConnections(ctx context.Context, user string) ([]AIProviderConnection, error) {
	result := []AIProviderConnection{}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT id,name,provider,base_url FROM ai_provider_connections WHERE owner_user_id=$1 AND NOT revoked ORDER BY created_at,id`, user)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c AIProviderConnection
			if err = rows.Scan(&c.ID, &c.Name, &c.Provider, &c.BaseURL); err != nil {
				return err
			}
			result = append(result, c)
		}
		return rows.Err()
	})
	return result, err
}
func (db *Database) AIProviderConnection(ctx context.Context, user, id string) (*AIProviderConnection, error) {
	c := &AIProviderConnection{}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT id,name,provider,base_url,ciphertext,nonce FROM ai_provider_connections WHERE owner_user_id=$1 AND id=$2 AND NOT revoked`, user, id).Scan(&c.ID, &c.Name, &c.Provider, &c.BaseURL, &c.Ciphertext, &c.Nonce)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrSpaceNotFound
	}
	return c, err
}
func (db *Database) CreateAIProviderConnection(ctx context.Context, user string, c AIProviderConnection) error {
	return db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		// Serialize account mutations to bound connection count and coordinate deletes.
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "ai-providers:"+user); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM ai_provider_connections WHERE owner_user_id=$1 AND NOT revoked`, user).Scan(&count); err != nil {
			return err
		}
		if count >= 20 {
			return ErrSpaceInvalid
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO ai_provider_connections(id,owner_user_id,name,provider,base_url,ciphertext,nonce) VALUES($1,$2,$3,$4,$5,$6,$7)`, c.ID, user, c.Name, c.Provider, c.BaseURL, c.Ciphertext, c.Nonce)
		return err
	})
}
func (db *Database) RotateAIProviderKey(ctx context.Context, user, id string, ciphertext, nonce []byte) error {
	return db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		r, err := tx.ExecContext(ctx, `UPDATE ai_provider_connections SET ciphertext=$3,nonce=$4 WHERE owner_user_id=$1 AND id=$2 AND NOT revoked`, user, id, ciphertext, nonce)
		if err != nil {
			return err
		}
		n, _ := r.RowsAffected()
		if n != 1 {
			return ErrSpaceNotFound
		}
		return nil
	})
}
func (db *Database) RevokeAIProviderConnection(ctx context.Context, user, id string) error {
	return db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "ai-providers:"+user); err != nil {
			return err
		}
		var used bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM ai_model_routes WHERE owner_user_id=$1 AND connection_id=$2 AND enabled)`, user, id).Scan(&used); err != nil {
			return err
		}
		if used {
			return ErrAIConnectionInUse
		}
		if _, err := tx.ExecContext(ctx, `UPDATE ai_model_routes SET connection_id=NULL,model='',reasoning='' WHERE owner_user_id=$1 AND connection_id=$2 AND NOT enabled`, user, id); err != nil {
			return err
		}
		r, err := tx.ExecContext(ctx, `UPDATE ai_provider_connections SET revoked=true,ciphertext=''::bytea,nonce=''::bytea WHERE owner_user_id=$1 AND id=$2 AND NOT revoked`, user, id)
		if err != nil {
			return err
		}
		n, _ := r.RowsAffected()
		if n != 1 {
			return ErrSpaceNotFound
		}
		return nil
	})
}
func (db *Database) AIModelRoutes(ctx context.Context, user string) ([]aimodels.Route, error) {
	result := []aimodels.Route{}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT role,COALESCE(connection_id,''),model,reasoning,enabled FROM ai_model_routes WHERE owner_user_id=$1 ORDER BY role`, user)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r aimodels.Route
			if err = rows.Scan(&r.Role, &r.ConnectionID, &r.Model, &r.Reasoning, &r.Enabled); err != nil {
				return err
			}
			result = append(result, r)
		}
		return rows.Err()
	})
	return result, err
}
func (db *Database) SaveAIModelRoutes(ctx context.Context, user string, routes []aimodels.Route) error {
	if len(routes) != len(aimodels.Roles) {
		return ErrSpaceInvalid
	}
	return db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "ai-providers:"+user); err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, r := range routes {
			role, ok := aimodels.FindRole(r.Role)
			if !ok || seen[r.Role] || !aimodels.ValidReasoning(r.Reasoning) || (!role.Reasoning && r.Reasoning != "") || (r.Enabled && r.Model != "" && !aimodels.ValidModel(r.Model)) {
				return ErrSpaceInvalid
			}
			seen[r.Role] = true
			if r.ConnectionID == "" && (r.Model != "" || r.Reasoning != "") {
				return ErrSpaceInvalid
			}
			if r.ConnectionID != "" {
				var provider string
				if err := tx.QueryRowContext(ctx, `SELECT provider FROM ai_provider_connections WHERE owner_user_id=$1 AND id=$2 AND NOT revoked`, user, r.ConnectionID).Scan(&provider); err != nil {
					if errors.Is(err, sql.ErrNoRows) {
						return ErrSpaceNotFound
					}
					return err
				}
				if !aimodels.Supports(r.Role, provider) || !aimodels.ValidModel(r.Model) || (provider != "gateway" && !strings.HasPrefix(r.Model, provider+"/")) {
					return ErrSpaceInvalid
				}
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO ai_model_routes(owner_user_id,role,connection_id,model,reasoning,enabled) VALUES($1,$2,NULLIF($3,''),$4,$5,$6) ON CONFLICT(owner_user_id,role) DO UPDATE SET connection_id=EXCLUDED.connection_id,model=EXCLUDED.model,reasoning=EXCLUDED.reasoning,enabled=EXCLUDED.enabled`, user, r.Role, r.ConnectionID, r.Model, r.Reasoning, r.Enabled)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

// Freeze all roles together: edits cannot change the model of a running task.
func (db *Database) FreezeAIModelRoutes(ctx context.Context, user, run string, defaults []aimodels.Route, admittedReasoning ...string) ([]aimodels.Route, error) {
	result := []aimodels.Route{}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "ai-providers:"+user); err != nil {
			return err
		}
		for _, d := range defaults {
			_, err := tx.ExecContext(ctx, `INSERT INTO ai_model_run_routes(owner_user_id,run_id,role,connection_id,model,reasoning,enabled)
 SELECT $1,$2,$3,r.connection_id,COALESCE(NULLIF(r.model,''),$4),CASE WHEN r.connection_id IS NULL OR ($6 AND $3='agent') THEN $5 ELSE r.reasoning END,COALESCE(r.enabled,true) FROM (SELECT 1) seed LEFT JOIN ai_model_routes r ON r.owner_user_id=$1 AND r.role=$3
 ON CONFLICT(run_id,role) DO NOTHING`, user, run, d.Role, d.Model, d.Reasoning, len(admittedReasoning) > 0)
			if err != nil {
				return err
			}
		}
		rows, err := tx.QueryContext(ctx, `SELECT role,COALESCE(connection_id,''),model,reasoning,enabled FROM ai_model_run_routes WHERE owner_user_id=$1 AND run_id=$2 ORDER BY role`, user, run)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r aimodels.Route
			if err = rows.Scan(&r.Role, &r.ConnectionID, &r.Model, &r.Reasoning, &r.Enabled); err != nil {
				return err
			}
			result = append(result, r)
		}
		return rows.Err()
	})
	return result, err
}
func (db *Database) AIModelRunRoute(ctx context.Context, user, run, role string) (aimodels.Route, error) {
	var r aimodels.Route
	err := db.TestingWithRLSContext(ctx, userRLSSettings(user), func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT role,COALESCE(connection_id,''),model,reasoning,enabled FROM ai_model_run_routes WHERE owner_user_id=$1 AND run_id=$2 AND role=$3`, user, run, role).Scan(&r.Role, &r.ConnectionID, &r.Model, &r.Reasoning, &r.Enabled)
	})
	return r, err
}

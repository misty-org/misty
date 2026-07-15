package db

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrAgentNotFound        = errors.New("agent not found")
	ErrAgentVersionConflict = errors.New("agent definition version conflict")
	ErrDeviceNotFound       = errors.New("trusted device not found")
	ErrDeviceRequestReplay  = errors.New("trusted device request was already used")
	ErrAgentJobNotFound     = errors.New("agent job not found")
	ErrInvalidJobState      = errors.New("invalid agent job state")
	ErrInvalidLease         = errors.New("invalid or expired agent job lease")
	ErrApprovalNotFound     = errors.New("agent approval not found")
	ErrApprovalNotPending   = errors.New("agent approval is not pending")
	ErrApprovalAction       = errors.New("invalid agent approval action")
)

const (
	AgentJobQueued           = "queued"
	AgentJobLeased           = "leased"
	AgentJobRunning          = "running"
	AgentJobAwaitingApproval = "awaiting_approval"
	AgentJobCompleted        = "completed"
	AgentJobFailed           = "failed"
	AgentJobCanceled         = "canceled"
	AgentJobExpired          = "expired"
)

type TrustedDevice struct {
	ID           string          `json:"id"`
	UserID       string          `json:"userId"`
	Name         string          `json:"name"`
	PublicKey    string          `json:"publicKey"`
	KeyAlgorithm string          `json:"keyAlgorithm"`
	Capabilities json.RawMessage `json:"capabilities"`
	LastSeenAt   time.Time       `json:"lastSeenAt"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
	RevokedAt    *time.Time      `json:"revokedAt,omitempty"`
}

type AgentDefinition struct {
	ID                   string          `json:"id"`
	OwnerUserID          string          `json:"ownerUserId"`
	DeviceID             string          `json:"deviceId"`
	ScopeID              string          `json:"scopeId"`
	Name                 string          `json:"name"`
	Instructions         string          `json:"instructions"`
	Workflow             json.RawMessage `json:"workflow"`
	TrustPolicy          json.RawMessage `json:"trustPolicy"`
	WorkflowRevision     int             `json:"workflowRevision"`
	Version              int             `json:"version"`
	CloudDocumentConsent bool            `json:"cloudDocumentConsent"`
	Enabled              bool            `json:"enabled"`
	CreatedAt            time.Time       `json:"createdAt"`
	UpdatedAt            time.Time       `json:"updatedAt"`
}

type AgentMember struct {
	UserID    string    `json:"userId"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
}
type AgentTrigger struct {
	ID        string          `json:"id"`
	AgentID   string          `json:"agentId"`
	Kind      string          `json:"kind"`
	Config    json.RawMessage `json:"config"`
	Enabled   bool            `json:"enabled"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type AgentJob struct {
	ID              string          `json:"id"`
	AgentID         string          `json:"agentId,omitempty"`
	OwnerUserID     string          `json:"ownerUserId"`
	RequesterUserID string          `json:"requesterUserId"`
	DeviceID        string          `json:"deviceId"`
	TriggerKind     string          `json:"triggerKind"`
	State           string          `json:"state"`
	IdempotencyKey  string          `json:"idempotencyKey"`
	Payload         json.RawMessage `json:"payload"`
	Result          json.RawMessage `json:"result,omitempty"`
	ErrorCode       string          `json:"errorCode,omitempty"`
	ErrorMessage    string          `json:"errorMessage,omitempty"`
	Progress        int             `json:"progress"`
	AttemptCount    int             `json:"attemptCount"`
	LeaseExpiresAt  *time.Time      `json:"leaseExpiresAt,omitempty"`
	StartedAt       *time.Time      `json:"startedAt,omitempty"`
	CompletedAt     *time.Time      `json:"completedAt,omitempty"`
	CanceledAt      *time.Time      `json:"canceledAt,omitempty"`
	ExpiresAt       time.Time       `json:"expiresAt"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

type AgentApproval struct {
	ID              string          `json:"id"`
	JobID           string          `json:"jobId"`
	AgentID         string          `json:"agentId"`
	RequesterUserID string          `json:"requesterUserId"`
	ScopeID         string          `json:"scopeId"`
	ActionKind      string          `json:"actionKind"`
	ActionSummary   string          `json:"actionSummary"`
	Action          json.RawMessage `json:"action"`
	ActionDigest    string          `json:"actionDigest"`
	State           string          `json:"state"`
	ExpiresAt       time.Time       `json:"expiresAt"`
	CreatedAt       time.Time       `json:"createdAt"`
	DecidedAt       *time.Time      `json:"decidedAt,omitempty"`
}

func (db *Database) agentTx(userID string, fn func(*sql.Tx) error) error {
	return db.withRLSContext(context.Background(), userRLSSettings(userID), fn)
}

func (db *Database) RegisterTrustedDevice(userID, name, publicKey string, capabilities json.RawMessage) (*TrustedDevice, error) {
	if len(capabilities) == 0 {
		capabilities = json.RawMessage(`{}`)
	}
	device := &TrustedDevice{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		return scanDevice(tx.QueryRow(`INSERT INTO trusted_devices(id,user_id,name,public_key,capabilities) VALUES($1,$2,$3,$4,$5)
			ON CONFLICT(user_id,public_key) DO UPDATE SET name=EXCLUDED.name,capabilities=EXCLUDED.capabilities,last_seen_at=NOW(),updated_at=NOW()
			RETURNING id,user_id,name,public_key,key_algorithm,capabilities,last_seen_at,revoked_at,created_at,updated_at`,
			"device_"+uuid.NewString(), userID, name, publicKey, capabilities), device)
	})
	return device, err
}

func (db *Database) TrustedDevices(userID string) ([]TrustedDevice, error) {
	devices := []TrustedDevice{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT id,user_id,name,public_key,key_algorithm,capabilities,last_seen_at,revoked_at,created_at,updated_at FROM trusted_devices WHERE user_id=$1 ORDER BY created_at`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d TrustedDevice
			if err := scanDevice(rows, &d); err != nil {
				return err
			}
			devices = append(devices, d)
		}
		return rows.Err()
	})
	return devices, err
}

func (db *Database) HeartbeatTrustedDevice(userID, deviceID string, capabilities json.RawMessage) (*TrustedDevice, error) {
	if len(capabilities) == 0 {
		capabilities = json.RawMessage(`{}`)
	}
	device := &TrustedDevice{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		err := scanDevice(tx.QueryRow(`UPDATE trusted_devices SET capabilities=$1,last_seen_at=NOW(),updated_at=NOW() WHERE id=$2 AND user_id=$3 AND revoked_at IS NULL RETURNING id,user_id,name,public_key,key_algorithm,capabilities,last_seen_at,revoked_at,created_at,updated_at`, capabilities, deviceID, userID), device)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrDeviceNotFound
		}
		return err
	})
	return device, err
}

func (db *Database) RevokeTrustedDevice(userID, deviceID string) error {
	return db.agentTx(userID, func(tx *sql.Tx) error {
		result, err := tx.Exec(`UPDATE trusted_devices SET revoked_at=COALESCE(revoked_at,NOW()),updated_at=NOW() WHERE id=$1 AND user_id=$2`, deviceID, userID)
		if err != nil {
			return err
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			return ErrDeviceNotFound
		}
		return nil
	})
}

func (db *Database) TrustedDevicePublicKey(userID, deviceID string) (string, error) {
	var publicKey string
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		err := tx.QueryRow(`SELECT public_key FROM trusted_devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`, deviceID, userID).Scan(&publicKey)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrDeviceNotFound
		}
		return err
	})
	return publicKey, err
}

// ConsumeTrustedDeviceNonce returns the registered key only once for a fresh
// request nonce. The unique key makes replay rejection atomic across servers.
func (db *Database) ConsumeTrustedDeviceNonce(userID, deviceID, nonce string, expiresAt time.Time) (string, error) {
	var publicKey string
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM trusted_device_request_nonces WHERE owner_user_id=$1 AND expires_at <= NOW()`, userID); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT public_key FROM trusted_devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`, deviceID, userID).Scan(&publicKey); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrDeviceNotFound
			}
			return err
		}
		result, err := tx.Exec(`INSERT INTO trusted_device_request_nonces(device_id,owner_user_id,nonce,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, deviceID, userID, nonce, expiresAt)
		if err != nil {
			return err
		}
		inserted, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if inserted != 1 {
			return ErrDeviceRequestReplay
		}
		return nil
	})
	return publicKey, err
}

func (db *Database) CreateAgentDefinition(userID string, a AgentDefinition) (*AgentDefinition, error) {
	if len(a.Workflow) == 0 {
		a.Workflow = json.RawMessage(`{}`)
	}
	if len(a.TrustPolicy) == 0 {
		a.TrustPolicy = json.RawMessage(`{}`)
	}
	if a.ID == "" {
		a.ID = "agent_" + uuid.NewString()
	}
	out := &AgentDefinition{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		return scanAgent(tx.QueryRow(`INSERT INTO agent_definitions(id,owner_user_id,device_id,scope_id,name,instructions,workflow,workflow_revision,trust_policy,cloud_document_consent,enabled)
			SELECT $1,$2,d.id,$3,$4,$5,$6,$7,$8,$9,FALSE FROM trusted_devices d WHERE d.id=$10 AND d.user_id=$2 AND d.revoked_at IS NULL
			ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,instructions=EXCLUDED.instructions,workflow=EXCLUDED.workflow,workflow_revision=EXCLUDED.workflow_revision,trust_policy=EXCLUDED.trust_policy,cloud_document_consent=EXCLUDED.cloud_document_consent,version=agent_definitions.version+1,updated_at=NOW()
			WHERE agent_definitions.owner_user_id=$2 AND agent_definitions.deleted_at IS NULL
			RETURNING id,owner_user_id,device_id,scope_id,name,instructions,workflow,workflow_revision,trust_policy,cloud_document_consent,enabled,version,created_at,updated_at`,
			a.ID, userID, a.ScopeID, a.Name, a.Instructions, a.Workflow, a.WorkflowRevision, a.TrustPolicy, a.CloudDocumentConsent, a.DeviceID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrDeviceNotFound
	}
	return out, err
}

func (db *Database) AgentDefinitions(userID string) ([]AgentDefinition, error) {
	agents := []AgentDefinition{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT id,owner_user_id,device_id,scope_id,name,instructions,workflow,workflow_revision,trust_policy,cloud_document_consent,enabled,version,created_at,updated_at FROM agent_definitions WHERE deleted_at IS NULL ORDER BY updated_at DESC`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a AgentDefinition
			if err := scanAgent(rows, &a); err != nil {
				return err
			}
			agents = append(agents, a)
		}
		return rows.Err()
	})
	return agents, err
}

func (db *Database) AgentDefinition(userID, agentID string) (*AgentDefinition, error) {
	a := &AgentDefinition{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		return scanAgent(tx.QueryRow(`SELECT id,owner_user_id,device_id,scope_id,name,instructions,workflow,workflow_revision,trust_policy,cloud_document_consent,enabled,version,created_at,updated_at FROM agent_definitions WHERE id=$1 AND deleted_at IS NULL`, agentID), a)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrAgentNotFound
	}
	return a, err
}

func (db *Database) UpdateAgentDefinition(userID string, a AgentDefinition) (*AgentDefinition, error) {
	out := &AgentDefinition{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		err := scanAgent(tx.QueryRow(`UPDATE agent_definitions SET name=$1,instructions=$2,workflow=$3,workflow_revision=$4,trust_policy=$5,cloud_document_consent=$6,enabled=$7,version=version+1,updated_at=NOW() WHERE id=$8 AND owner_user_id=$9 AND version=$10 AND deleted_at IS NULL RETURNING id,owner_user_id,device_id,scope_id,name,instructions,workflow,workflow_revision,trust_policy,cloud_document_consent,enabled,version,created_at,updated_at`, a.Name, a.Instructions, a.Workflow, a.WorkflowRevision, a.TrustPolicy, a.CloudDocumentConsent, a.Enabled, a.ID, userID, a.Version), out)
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var exists bool
		if queryErr := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM agent_definitions WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL)`, a.ID, userID).Scan(&exists); queryErr != nil {
			return queryErr
		}
		if exists {
			return ErrAgentVersionConflict
		}
		return ErrAgentNotFound
	})
	return out, err
}

func (db *Database) DeleteAgentDefinition(userID, agentID string) error {
	return db.agentTx(userID, func(tx *sql.Tx) error {
		r, e := tx.Exec(`UPDATE agent_definitions SET deleted_at=NOW(),enabled=FALSE,updated_at=NOW() WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, agentID, userID)
		if e != nil {
			return e
		}
		n, _ := r.RowsAffected()
		if n == 0 {
			return ErrAgentNotFound
		}
		return nil
	})
}

func (db *Database) ReplaceAgentMembers(userID, agentID string, members []string) error {
	return db.agentTx(userID, func(tx *sql.Tx) error {
		var owner string
		if e := tx.QueryRow(`SELECT owner_user_id FROM agent_definitions WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, agentID, userID).Scan(&owner); errors.Is(e, sql.ErrNoRows) {
			return ErrAgentNotFound
		} else if e != nil {
			return e
		}
		if _, e := tx.Exec(`DELETE FROM agent_members WHERE agent_id=$1`, agentID); e != nil {
			return e
		}
		for _, member := range members {
			if _, e := tx.Exec(`INSERT INTO agent_members(agent_id,owner_user_id,user_id) VALUES($1,$2,$3)`, agentID, userID, member); e != nil {
				return e
			}
		}
		_, e := tx.Exec(`UPDATE agent_jobs SET state='canceled',canceled_at=NOW(),lease_expires_at=NULL,updated_at=NOW()
			WHERE agent_id=$1 AND owner_user_id=$2 AND requester_user_id<>$2
			AND state IN ('queued','leased','running','awaiting_approval')
			AND NOT EXISTS (SELECT 1 FROM agent_members m WHERE m.agent_id=$1 AND m.user_id=agent_jobs.requester_user_id)`, agentID, userID)
		if e != nil {
			return e
		}
		return nil
	})
}

func (db *Database) AgentMembers(userID, agentID string) ([]AgentMember, error) {
	out := []AgentMember{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		rows, e := tx.Query(`SELECT user_id,role,created_at FROM agent_members WHERE agent_id=$1 ORDER BY created_at`, agentID)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var m AgentMember
			if e := rows.Scan(&m.UserID, &m.Role, &m.CreatedAt); e != nil {
				return e
			}
			out = append(out, m)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) ReplaceAgentTriggers(userID, agentID string, triggers []AgentTrigger) error {
	return db.agentTx(userID, func(tx *sql.Tx) error {
		var owner string
		if e := tx.QueryRow(`SELECT owner_user_id FROM agent_definitions WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, agentID, userID).Scan(&owner); errors.Is(e, sql.ErrNoRows) {
			return ErrAgentNotFound
		} else if e != nil {
			return e
		}
		if _, e := tx.Exec(`DELETE FROM agent_triggers WHERE agent_id=$1`, agentID); e != nil {
			return e
		}
		for _, trigger := range triggers {
			if len(trigger.Config) == 0 {
				trigger.Config = json.RawMessage(`{}`)
			}
			if _, e := tx.Exec(`INSERT INTO agent_triggers(id,agent_id,owner_user_id,kind,config,enabled) VALUES($1,$2,$3,$4,$5,$6)`, `trigger_`+uuid.NewString(), agentID, userID, trigger.Kind, trigger.Config, trigger.Enabled); e != nil {
				return e
			}
		}
		return nil
	})
}

func (db *Database) AgentTriggers(userID, agentID string) ([]AgentTrigger, error) {
	out := []AgentTrigger{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		rows, e := tx.Query(`SELECT id,agent_id,kind,config,enabled,created_at,updated_at FROM agent_triggers WHERE agent_id=$1 ORDER BY created_at`, agentID)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var t AgentTrigger
			if e := rows.Scan(&t.ID, &t.AgentID, &t.Kind, &t.Config, &t.Enabled, &t.CreatedAt, &t.UpdatedAt); e != nil {
				return e
			}
			out = append(out, t)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) CreateAgentJob(userID, agentID, triggerKind, idempotencyKey string, payload json.RawMessage) (*AgentJob, bool, error) {
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	job := &AgentJob{}
	created := true
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		err := scanJob(tx.QueryRow(`INSERT INTO agent_jobs(id,agent_id,owner_user_id,requester_user_id,device_id,trigger_kind,idempotency_key,payload)
		SELECT $1,a.id,a.owner_user_id,$2,a.device_id,$3,$4,$5 FROM agent_definitions a JOIN trusted_devices d ON d.id=a.device_id WHERE a.id=$6 AND a.deleted_at IS NULL AND a.enabled AND d.revoked_at IS NULL
		AND (a.owner_user_id=$2 OR $3 = 'manual')
		ON CONFLICT(requester_user_id,idempotency_key) DO NOTHING RETURNING `+agentJobColumns, "job_"+uuid.NewString(), userID, triggerKind, idempotencyKey, payload, agentID), job)
		if err == nil {
			return addJobEvent(tx, job.ID, job.OwnerUserID, "queued", json.RawMessage(`{}`))
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		created = false
		err = scanJob(tx.QueryRow(`SELECT `+agentJobColumns+` FROM agent_jobs WHERE requester_user_id=$1 AND idempotency_key=$2`, userID, idempotencyKey), job)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrAgentNotFound
		}
		return err
	})
	return job, created, err
}

func (db *Database) AgentJob(userID, jobID string) (*AgentJob, error) {
	j := &AgentJob{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE agent_jobs SET state='expired',lease_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND expires_at<=NOW() AND state IN ('queued','leased','running')`, jobID); err != nil {
			return err
		}
		return scanJob(tx.QueryRow(`SELECT `+agentJobColumns+` FROM agent_jobs WHERE id=$1`, jobID), j)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrAgentJobNotFound
	}
	return j, err
}
func (db *Database) AgentJobs(userID, agentID string, limit int) ([]AgentJob, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	out := []AgentJob{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE agent_jobs SET state='expired',lease_expires_at=NULL,updated_at=NOW() WHERE expires_at<=NOW() AND state IN ('queued','leased','running')`); err != nil {
			return err
		}
		rows, e := tx.Query(`SELECT `+agentJobColumns+` FROM agent_jobs WHERE ($1='' OR agent_id=$1) ORDER BY created_at DESC LIMIT $2`, agentID, limit)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var j AgentJob
			if e := scanJob(rows, &j); e != nil {
				return e
			}
			out = append(out, j)
		}
		return rows.Err()
	})
	return out, err
}

// RetryAgentJob returns a failed run to the queue in place. The stable job ID
// keeps Run history to one row while a new lease token and the incremented
// attempt count still distinguish device executions.
func (db *Database) RetryAgentJob(userID, jobID string) (*AgentJob, error) {
	job := &AgentJob{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		err := scanJob(tx.QueryRow(`UPDATE agent_jobs j SET
			state='queued',result=NULL,error_code=NULL,error_message=NULL,progress=0,
			lease_token_hash=NULL,lease_expires_at=NULL,started_at=NULL,completed_at=NULL,canceled_at=NULL,
			expires_at=NOW()+INTERVAL '7 days',updated_at=NOW()
			FROM agent_definitions a,trusted_devices d
			WHERE j.id=$1 AND j.state='failed'
			AND (j.owner_user_id=$2 OR j.requester_user_id=$2)
			AND a.id=j.agent_id AND a.deleted_at IS NULL AND a.enabled
			AND d.id=j.device_id AND d.revoked_at IS NULL
			RETURNING `+prefixedJobColumns("j"), jobID, userID), job)
		if err == nil {
			// Any upload from the failed attempt must no longer participate in
			// document limits or envelope matching. The normal purge worker
			// removes its ciphertext and wrapped key after commit.
			if _, updateErr := tx.Exec(`UPDATE agent_attachments
				SET expires_at=LEAST(expires_at,NOW()),upload_expires_at=LEAST(upload_expires_at,NOW())
				WHERE job_id=$1 AND state<>'deleted'`, jobID); updateErr != nil {
				return updateErr
			}
			if _, updateErr := tx.Exec(`UPDATE agent_approvals SET state='expired',decided_at=COALESCE(decided_at,NOW())
				WHERE job_id=$1 AND state='pending'`, jobID); updateErr != nil {
				return updateErr
			}
			eventData, marshalErr := json.Marshal(map[string]string{"retryOf": jobID})
			if marshalErr != nil {
				return marshalErr
			}
			return addJobEvent(tx, job.ID, job.OwnerUserID, "retried", eventData)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var state string
		if lookupErr := tx.QueryRow(`SELECT state FROM agent_jobs WHERE id=$1 AND (owner_user_id=$2 OR requester_user_id=$2)`, jobID, userID).Scan(&state); lookupErr != nil {
			return lookupErr
		}
		if state != AgentJobFailed {
			return ErrInvalidJobState
		}
		return ErrAgentNotFound
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrAgentJobNotFound
	}
	return job, err
}

func (db *Database) ClaimAgentJob(userID, deviceID string, leaseDuration time.Duration) (*AgentJob, string, error) {
	if leaseDuration < 15*time.Second || leaseDuration > 5*time.Minute {
		leaseDuration = time.Minute
	}
	token, e := secureToken()
	if e != nil {
		return nil, "", e
	}
	hash := hashToken(token)
	job := &AgentJob{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		if _, e := tx.Exec(`UPDATE agent_jobs SET state='expired',lease_expires_at=NULL,updated_at=NOW() WHERE device_id=$1 AND owner_user_id=$2 AND state IN ('queued','leased','running') AND expires_at<=NOW()`, deviceID, userID); e != nil {
			return e
		}
		if _, e := tx.Exec(`UPDATE agent_jobs SET state='queued',lease_token_hash=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE device_id=$1 AND owner_user_id=$2 AND state IN ('leased','running') AND lease_expires_at<=NOW() AND expires_at>NOW()`, deviceID, userID); e != nil {
			return e
		}
		err := scanJob(tx.QueryRow(`WITH candidate AS (SELECT id FROM agent_jobs WHERE device_id=$1 AND owner_user_id=$2 AND state='queued' AND expires_at>NOW()
		AND (requester_user_id=owner_user_id OR EXISTS (SELECT 1 FROM agent_members m WHERE m.agent_id=agent_jobs.agent_id AND m.user_id=agent_jobs.requester_user_id))
		AND EXISTS(SELECT 1 FROM trusted_devices d WHERE d.id=$1 AND d.user_id=$2 AND d.revoked_at IS NULL) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE agent_jobs j SET state='leased',lease_token_hash=$3,lease_expires_at=NOW()+$4::interval,attempt_count=attempt_count+1,updated_at=NOW() FROM candidate c WHERE j.id=c.id RETURNING `+prefixedJobColumns("j"), deviceID, userID, hash, intervalString(leaseDuration)), job)
		if err == nil {
			return addJobEvent(tx, job.ID, job.OwnerUserID, "leased", json.RawMessage(`{}`))
		}
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrAgentJobNotFound
	}
	return job, token, err
}

func (db *Database) RenewAgentJobLease(userID, deviceID, jobID, leaseToken string, duration time.Duration) (*AgentJob, error) {
	if duration < 15*time.Second || duration > 5*time.Minute {
		duration = time.Minute
	}
	return db.leaseJobUpdate(userID, deviceID, jobID, leaseToken, `lease_expires_at=NOW()+$5::interval,updated_at=NOW()`, intervalString(duration))
}
func (db *Database) StartAgentJob(userID, deviceID, jobID, leaseToken string) (*AgentJob, error) {
	return db.leaseJobUpdate(userID, deviceID, jobID, leaseToken, `state='running',started_at=COALESCE(started_at,NOW()),updated_at=NOW()`, nil)
}
func (db *Database) ProgressAgentJob(userID, deviceID, jobID, leaseToken string, progress int) (*AgentJob, error) {
	return db.leaseJobUpdate(userID, deviceID, jobID, leaseToken, `state='running',progress=$5,started_at=COALESCE(started_at,NOW()),updated_at=NOW()`, progress)
}

func (db *Database) leaseJobUpdate(userID, deviceID, jobID, token, set string, arg any) (*AgentJob, error) {
	j := &AgentJob{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		query := `UPDATE agent_jobs SET ` + set + ` WHERE id=$1 AND owner_user_id=$2 AND device_id=$3 AND lease_token_hash=$4 AND state IN ('leased','running') AND lease_expires_at>NOW() RETURNING ` + agentJobColumns
		args := []any{jobID, userID, deviceID, hashToken(token)}
		if arg != nil {
			args = append(args, arg)
		}
		return scanJob(tx.QueryRow(query, args...), j)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrInvalidLease
	}
	return j, err
}

func (db *Database) CompleteAgentJob(userID, deviceID, jobID, leaseToken string, result json.RawMessage) (*AgentJob, error) {
	return db.finishAgentJob(userID, deviceID, jobID, leaseToken, AgentJobCompleted, result, "", "")
}
func (db *Database) FailAgentJob(userID, deviceID, jobID, leaseToken, code, message string) (*AgentJob, error) {
	return db.finishAgentJob(userID, deviceID, jobID, leaseToken, AgentJobFailed, nil, code, message)
}
func (db *Database) finishAgentJob(userID, deviceID, jobID, token, state string, result json.RawMessage, code, message string) (*AgentJob, error) {
	j := &AgentJob{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		err := scanJob(tx.QueryRow(`UPDATE agent_jobs SET state=$1,result=$2,error_code=NULLIF($3,''),error_message=NULLIF($4,''),progress=CASE WHEN $1='completed' THEN 100 ELSE progress END,completed_at=NOW(),lease_expires_at=NULL,updated_at=NOW() WHERE id=$5 AND owner_user_id=$6 AND device_id=$7 AND lease_token_hash=$8 AND state IN ('leased','running') AND lease_expires_at>NOW() RETURNING `+agentJobColumns, state, result, code, message, jobID, userID, deviceID, hashToken(token)), j)
		if err == nil {
			return addJobEvent(tx, j.ID, j.OwnerUserID, state, json.RawMessage(`{}`))
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		return scanJob(tx.QueryRow(`SELECT `+agentJobColumns+` FROM agent_jobs WHERE id=$1 AND owner_user_id=$2 AND device_id=$3 AND lease_token_hash=$4 AND state=$5`, jobID, userID, deviceID, hashToken(token), state), j)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrInvalidLease
	}
	return j, err
}

func (db *Database) CancelAgentJob(userID, jobID string) (*AgentJob, error) {
	j := &AgentJob{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		err := scanJob(tx.QueryRow(`UPDATE agent_jobs SET state='canceled',canceled_at=NOW(),lease_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND (owner_user_id=$2 OR requester_user_id=$2) AND state IN ('queued','leased','running','awaiting_approval') RETURNING `+agentJobColumns, jobID, userID), j)
		if err == nil {
			return addJobEvent(tx, j.ID, j.OwnerUserID, "canceled", json.RawMessage(`{}`))
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		err = scanJob(tx.QueryRow(`SELECT `+agentJobColumns+` FROM agent_jobs WHERE id=$1`, jobID), j)
		if err == nil && (j.State == AgentJobCanceled || j.State == AgentJobCompleted || j.State == AgentJobFailed || j.State == AgentJobExpired) {
			return nil
		}
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrAgentJobNotFound
	}
	return j, err
}

type agentApprovalAction struct {
	Kind                    string   `json:"kind"`
	Summary                 string   `json:"summary"`
	ScopeID                 string   `json:"scopeId"`
	RelativePaths           []string `json:"relativePaths"`
	DestinationRelativePath string   `json:"destinationRelativePath,omitempty"`
	ContentSHA256           string   `json:"contentSha256,omitempty"`
	UnixMode                *uint32  `json:"unixMode,omitempty"`
}

func canonicalAgentApprovalAction(raw json.RawMessage) (agentApprovalAction, json.RawMessage, string, error) {
	var action agentApprovalAction
	if json.Unmarshal(raw, &action) != nil || action.Kind == "" || action.Summary == "" || action.ScopeID == "" {
		return action, nil, "", ErrApprovalAction
	}
	if action.Kind == "overwrite" && (len(action.ContentSHA256) != sha256.Size*2 || strings.ToLower(action.ContentSHA256) != action.ContentSHA256) {
		return action, nil, "", ErrApprovalAction
	}
	if action.Kind == "change_permissions" && (action.UnixMode == nil || *action.UnixMode > 0o777) {
		return action, nil, "", ErrApprovalAction
	}
	canonical, err := json.Marshal(action)
	if err != nil {
		return action, nil, "", ErrApprovalAction
	}
	digest := sha256.Sum256(canonical)
	return action, canonical, hex.EncodeToString(digest[:]), nil
}

func (db *Database) CreateAgentApproval(userID, deviceID, jobID, leaseToken string, rawAction json.RawMessage) (*AgentApproval, error) {
	action, canonical, digest, err := canonicalAgentApprovalAction(rawAction)
	if err != nil {
		return nil, err
	}
	a := &AgentApproval{}
	err = db.agentTx(userID, func(tx *sql.Tx) error {
		var boundScope string
		if err := tx.QueryRow(`SELECT a.scope_id FROM agent_jobs j JOIN agent_definitions a ON a.id=j.agent_id WHERE j.id=$1 AND j.owner_user_id=$2`, jobID, userID).Scan(&boundScope); err != nil {
			return err
		}
		if boundScope != action.ScopeID {
			return ErrApprovalAction
		}
		result, e := tx.Exec(`UPDATE agent_jobs SET state='awaiting_approval',lease_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND owner_user_id=$2 AND device_id=$3 AND lease_token_hash=$4 AND state IN ('leased','running') AND lease_expires_at>NOW()`, jobID, userID, deviceID, hashToken(leaseToken))
		if e != nil {
			return e
		}
		if changed, _ := result.RowsAffected(); changed == 0 {
			return ErrInvalidLease
		}
		return tx.QueryRow(`INSERT INTO agent_approvals(id,job_id,owner_user_id,action_kind,action_summary,action,action_digest) SELECT $1,j.id,j.owner_user_id,$2,$3,$4,$5 FROM agent_jobs j WHERE j.id=$6 AND j.owner_user_id=$7 AND j.state='awaiting_approval' RETURNING id,job_id,action_kind,action_summary,action,action_digest,state,expires_at,decided_at,created_at`, `approval_`+uuid.NewString(), action.Kind, action.Summary, canonical, digest, jobID, userID).Scan(&a.ID, &a.JobID, &a.ActionKind, &a.ActionSummary, &a.Action, &a.ActionDigest, &a.State, &a.ExpiresAt, &a.DecidedAt, &a.CreatedAt)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrAgentJobNotFound
	}
	return a, err
}
func (db *Database) AgentApprovals(userID string) ([]AgentApproval, error) {
	out := []AgentApproval{}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`WITH expired AS (UPDATE agent_approvals SET state='expired',decided_at=NOW() WHERE owner_user_id=$1 AND state='pending' AND expires_at<=NOW() RETURNING job_id) UPDATE agent_jobs SET state='canceled',canceled_at=NOW(),updated_at=NOW() WHERE id IN (SELECT job_id FROM expired) AND state='awaiting_approval'`, userID); err != nil {
			return err
		}
		rows, err := tx.Query(`SELECT p.id,p.job_id,COALESCE(j.agent_id,''),j.requester_user_id,COALESCE(a.scope_id,''),p.action_kind,p.action_summary,p.action,p.action_digest,p.state,p.expires_at,p.decided_at,p.created_at FROM agent_approvals p JOIN agent_jobs j ON j.id=p.job_id LEFT JOIN agent_definitions a ON a.id=j.agent_id WHERE p.owner_user_id=$1 ORDER BY p.created_at DESC LIMIT 100`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var approval AgentApproval
			if err := rows.Scan(&approval.ID, &approval.JobID, &approval.AgentID, &approval.RequesterUserID, &approval.ScopeID, &approval.ActionKind, &approval.ActionSummary, &approval.Action, &approval.ActionDigest, &approval.State, &approval.ExpiresAt, &approval.DecidedAt, &approval.CreatedAt); err != nil {
				return err
			}
			out = append(out, approval)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) DecideAgentApproval(userID, approvalID, actionDigest string, approve bool) (*AgentApproval, error) {
	a := &AgentApproval{}
	state := "rejected"
	if approve {
		state = "approved"
	}
	err := db.agentTx(userID, func(tx *sql.Tx) error {
		if _, e := tx.Exec(`WITH expired AS (UPDATE agent_approvals SET state='expired',decided_at=NOW() WHERE owner_user_id=$1 AND state='pending' AND expires_at<=NOW() RETURNING job_id) UPDATE agent_jobs SET state='canceled',canceled_at=NOW(),updated_at=NOW() WHERE id IN (SELECT job_id FROM expired) AND state='awaiting_approval'`, userID); e != nil {
			return e
		}
		err := tx.QueryRow(`UPDATE agent_approvals SET state=$1,decided_at=NOW() WHERE id=$2 AND owner_user_id=$3 AND action_digest=$4 AND state='pending' AND expires_at>NOW() RETURNING id,job_id,action_kind,action_summary,action,action_digest,state,expires_at,decided_at,created_at`, state, approvalID, userID, actionDigest).Scan(&a.ID, &a.JobID, &a.ActionKind, &a.ActionSummary, &a.Action, &a.ActionDigest, &a.State, &a.ExpiresAt, &a.DecidedAt, &a.CreatedAt)
		if err != nil {
			return err
		}
		next := "canceled"
		if approve {
			next = "queued"
		}
		_, err = tx.Exec(`UPDATE agent_jobs SET state=$1,canceled_at=CASE WHEN $1='canceled' THEN NOW() ELSE canceled_at END,updated_at=NOW() WHERE id=$2 AND owner_user_id=$3 AND state='awaiting_approval'`, next, a.JobID, userID)
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrApprovalNotPending
	}
	return a, err
}

const agentJobColumns = `id,COALESCE(agent_id,''),owner_user_id,requester_user_id,device_id,trigger_kind,state,idempotency_key,payload,result,COALESCE(error_code,''),COALESCE(error_message,''),progress,attempt_count,lease_expires_at,started_at,completed_at,canceled_at,expires_at,created_at,updated_at`

func prefixedJobColumns(p string) string {
	return p + `.id,COALESCE(` + p + `.agent_id,''),` + p + `.owner_user_id,` + p + `.requester_user_id,` + p + `.device_id,` + p + `.trigger_kind,` + p + `.state,` + p + `.idempotency_key,` + p + `.payload,` + p + `.result,COALESCE(` + p + `.error_code,''),COALESCE(` + p + `.error_message,''),` + p + `.progress,` + p + `.attempt_count,` + p + `.lease_expires_at,` + p + `.started_at,` + p + `.completed_at,` + p + `.canceled_at,` + p + `.expires_at,` + p + `.created_at,` + p + `.updated_at`
}

type scanner interface{ Scan(...any) error }

func scanDevice(s scanner, d *TrustedDevice) error {
	return s.Scan(&d.ID, &d.UserID, &d.Name, &d.PublicKey, &d.KeyAlgorithm, &d.Capabilities, &d.LastSeenAt, &d.RevokedAt, &d.CreatedAt, &d.UpdatedAt)
}
func scanAgent(s scanner, a *AgentDefinition) error {
	return s.Scan(&a.ID, &a.OwnerUserID, &a.DeviceID, &a.ScopeID, &a.Name, &a.Instructions, &a.Workflow, &a.WorkflowRevision, &a.TrustPolicy, &a.CloudDocumentConsent, &a.Enabled, &a.Version, &a.CreatedAt, &a.UpdatedAt)
}
func scanJob(s scanner, j *AgentJob) error {
	var result []byte
	err := s.Scan(&j.ID, &j.AgentID, &j.OwnerUserID, &j.RequesterUserID, &j.DeviceID, &j.TriggerKind, &j.State, &j.IdempotencyKey, &j.Payload, &result, &j.ErrorCode, &j.ErrorMessage, &j.Progress, &j.AttemptCount, &j.LeaseExpiresAt, &j.StartedAt, &j.CompletedAt, &j.CanceledAt, &j.ExpiresAt, &j.CreatedAt, &j.UpdatedAt)
	if err == nil && result != nil {
		j.Result = json.RawMessage(result)
	}
	return err
}
func addJobEvent(tx *sql.Tx, jobID, owner, event string, data json.RawMessage) error {
	_, err := tx.Exec(`INSERT INTO agent_job_events(job_id,owner_user_id,event_type,data) VALUES($1,$2,$3,$4)`, jobID, owner, event, data)
	return err
}
func secureToken() (string, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func hashToken(v string) string             { sum := sha256.Sum256([]byte(v)); return hex.EncodeToString(sum[:]) }
func intervalString(d time.Duration) string { return d.String() }

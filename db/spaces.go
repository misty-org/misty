package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	workflowv2 "github.com/kannachi323/misty/server/workflow"
)

const (
	MaxSpaceNodes        = 5000
	MaxMessageChars      = 4000
	MaxMessageFiles      = 5
	MaxSpaceStorageBytes = int64(1_000_000_000)
)

var (
	ErrSpaceNotFound        = errors.New("space not found")
	ErrSpaceForbidden       = errors.New("space permission denied")
	ErrSpaceLimit           = errors.New("space limit reached")
	ErrSpaceOwnershipLimit  = errors.New("space ownership limit reached")
	ErrSpacePeopleLimit     = errors.New("space member limit reached")
	ErrSpaceNodeLimit       = errors.New("space node limit reached")
	ErrSpaceConflict        = errors.New("space resource version conflict")
	ErrSpaceInviteNotFound  = errors.New("space invitation not found")
	ErrSpaceInviteeNotFound = errors.New("no misty account found for invitee email")
	ErrSpaceInviteExpired   = errors.New("space invitation expired")
	ErrSpaceInvalid         = errors.New("invalid space data")
)

type Space struct {
	ID               string          `json:"id"`
	SecurityDomainID string          `json:"security_domain_id"`
	OwnerUserID      string          `json:"owner_user_id"`
	Name             string          `json:"name"`
	Role             string          `json:"role"`
	MemberCount      int             `json:"member_count"`
	PendingCount     int             `json:"pending_count"`
	IsPersonal       bool            `json:"is_personal"`
	IsShared         bool            `json:"is_shared"`
	Permissions      map[string]bool `json:"permissions"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type SpaceMember struct {
	SpaceID  string    `json:"space_id"`
	UserID   string    `json:"user_id"`
	Name     string    `json:"name"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joined_at"`
	ReadSeq  int64     `json:"read_message_seq"`
}

type SpaceInvitation struct {
	ID              string    `json:"id"`
	SpaceID         string    `json:"space_id"`
	SpaceName       string    `json:"space_name"`
	InvitedUserID   string    `json:"invited_user_id"`
	InvitedUserName string    `json:"invited_user_name"`
	InvitedEmail    string    `json:"invited_email"`
	InvitedByUserID string    `json:"invited_by_user_id"`
	ExpiresAt       time.Time `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
}

type MessageSpan struct {
	Type    string `json:"type"`
	Text    string `json:"text,omitempty"`
	UserID  string `json:"user_id,omitempty"`
	AgentID string `json:"agent_id,omitempty"`
	Label   string `json:"label,omitempty"`
}

type SpaceMessage struct {
	Seq                 int64               `json:"seq"`
	ID                  string              `json:"id"`
	SpaceID             string              `json:"space_id"`
	ConversationID      string              `json:"conversation_id,omitempty"`
	SenderUserID        string              `json:"sender_user_id"`
	SenderName          string              `json:"sender_name"`
	SenderAvatarVersion int64               `json:"sender_avatar_version,omitempty"`
	SenderKind          string              `json:"sender_kind"`
	SenderAgentID       string              `json:"sender_agent_id,omitempty"`
	Content             []MessageSpan       `json:"content"`
	FileNodeIDs         []string            `json:"file_node_ids"`
	LibraryItemIDs      []string            `json:"library_item_ids"`
	Attachments         []MessageAttachment `json:"attachments"`
	ReplyToMessageID    string              `json:"reply_to_message_id,omitempty"`
	EditedAt            *time.Time          `json:"edited_at,omitempty"`
	// Provenance for a mirrored message. Absent means Misty-native chat, so
	// every existing client stays valid and "no origin" reads as "ours".
	Origin    json.RawMessage `json:"origin,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

type SpaceNode struct {
	ID             string          `json:"id"`
	SpaceID        string          `json:"space_id"`
	ParentID       string          `json:"parent_id,omitempty"`
	Kind           string          `json:"kind"`
	DisplayName    string          `json:"display_name"`
	UploaderUserID string          `json:"uploader_user_id"`
	MIMEType       string          `json:"mime_type"`
	SizeBytes      *int64          `json:"size_bytes,omitempty"`
	Stale          bool            `json:"stale"`
	Metadata       json.RawMessage `json:"metadata"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	TargetCipher   []byte          `json:"-"`
	TargetNonce    []byte          `json:"-"`
	KeyVersion     int16           `json:"-"`
}

type SpaceEvent struct {
	ID          int64           `json:"id"`
	SpaceID     string          `json:"space_id"`
	EventType   string          `json:"type"`
	ActorUserID string          `json:"actor_user_id,omitempty"`
	EntityID    string          `json:"entity_id,omitempty"`
	Payload     json.RawMessage `json:"payload"`
	CreatedAt   time.Time       `json:"created_at"`
}

type SpaceInboxItem struct {
	ID        int64           `json:"id"`
	SpaceID   string          `json:"space_id"`
	SpaceName string          `json:"space_name"`
	Kind      string          `json:"kind"`
	MessageID string          `json:"message_id,omitempty"`
	EventID   *int64          `json:"event_id,omitempty"`
	Payload   json.RawMessage `json:"payload"`
	SeenAt    *time.Time      `json:"seen_at,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

type SpaceStudioResource struct {
	ID                      string           `json:"id"`
	SpaceID                 string           `json:"space_id"`
	CreatorUserID           string           `json:"creator_user_id"`
	Kind                    string           `json:"kind"`
	Name                    string           `json:"name"`
	Description             string           `json:"description,omitempty"`
	Icon                    string           `json:"icon,omitempty"`
	ModelMode               string           `json:"model_mode,omitempty"`
	ModelID                 string           `json:"model_id,omitempty"`
	Instructions            string           `json:"instructions,omitempty"`
	Definition              json.RawMessage  `json:"definition,omitempty"`
	Enabled                 bool             `json:"enabled"`
	Status                  string           `json:"status,omitempty"`
	RuntimeKind             string           `json:"runtime_kind,omitempty"`
	Version                 int64            `json:"version"`
	SchedulesEnabled        bool             `json:"schedules_enabled"`
	StableIdentifier        string           `json:"stable_identifier,omitempty"`
	ActiveWorkflowVersionID string           `json:"active_workflow_version_id,omitempty"`
	ActiveWorkflow          *WorkflowVersion `json:"active_workflow,omitempty"`
	AccessPolicy            json.RawMessage  `json:"access_policy,omitempty"`
	CreatedAt               time.Time        `json:"created_at"`
	UpdatedAt               time.Time        `json:"updated_at"`
}

type SpaceRun struct {
	ID                   string          `json:"id"`
	SpaceID              string          `json:"space_id"`
	ResourceKind         string          `json:"resource_kind"`
	ResourceID           string          `json:"resource_id"`
	InitiatedByUserID    string          `json:"initiated_by_user_id"`
	BillingUserID        string          `json:"billing_user_id"`
	TriggerKind          string          `json:"trigger_kind"`
	State                string          `json:"state"`
	Input                json.RawMessage `json:"input"`
	Result               json.RawMessage `json:"result"`
	ErrorCode            string          `json:"error_code,omitempty"`
	CreatedAt            time.Time       `json:"created_at"`
	CompletedAt          *time.Time      `json:"completed_at,omitempty"`
	RequestingMemberID   string          `json:"requesting_member_id"`
	SourceConversationID string          `json:"source_conversation_id,omitempty"`
	SourceType           string          `json:"source_type"`
	AgentID              string          `json:"agent_id,omitempty"`
	WorkflowIdentifier   string          `json:"workflow_identifier,omitempty"`
	WorkflowVersionID    string          `json:"workflow_version_id,omitempty"`
	WorkflowVersion      string          `json:"workflow_version,omitempty"`
	CapabilityID         string          `json:"capability_id,omitempty"`
	Progress             int             `json:"progress"`
	Outputs              json.RawMessage `json:"outputs"`
	Artifacts            json.RawMessage `json:"artifacts"`
	ErrorMessage         string          `json:"error_message,omitempty"`
	RetryOfRunID         string          `json:"retry_of_run_id,omitempty"`
	CanceledAt           *time.Time      `json:"canceled_at,omitempty"`
	UpdatedAt            time.Time       `json:"updated_at"`
	AgentInstanceID      string          `json:"agent_instance_id,omitempty"`
	AgentVersionID       string          `json:"agent_version_id,omitempty"`
	Attempt              int             `json:"attempt"`
	NextRetryAt          *time.Time      `json:"next_retry_at,omitempty"`
}

func (db *Database) spaceTx(ctx context.Context, fn func(*sql.Tx) error) error {
	return db.withRLSContext(ctx, serviceRLSSettings(), fn)
}

func normalizeSpaceName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if len([]rune(name)) < 1 || len([]rune(name)) > 80 {
		return "", ErrSpaceInvalid
	}
	return name, nil
}

func defaultPersonalSpaceName(userName string) string {
	const suffix = "'s Space"
	name := strings.TrimSpace(userName)
	if name == "" {
		return "My Space"
	}
	runes := []rune(name)
	maximumNameRunes := 80 - len([]rune(suffix))
	if len(runes) > maximumNameRunes {
		runes = runes[:maximumNameRunes]
	}
	return string(runes) + suffix
}

func requireSpaceMemberTx(ctx context.Context, tx *sql.Tx, spaceID, userID string) (string, error) {
	var role string
	err := tx.QueryRowContext(ctx, `SELECT m.role FROM space_members m JOIN spaces s ON s.id=m.space_id WHERE m.space_id=$1 AND m.user_id=$2 AND s.lifecycle_state='active'`, spaceID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrSpaceForbidden
	}
	return role, err
}

// IsSpaceMember reports whether userID is an active member of spaceID. It
// exists for callers outside the normal request/response flow (the realtime
// WebSocket handler, checking a client-claimed "viewing" space) that need a
// lightweight membership check without an otherwise-unused mutation.
func (db *Database) IsSpaceMember(ctx context.Context, userID, spaceID string) (bool, error) {
	var isMember bool
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		_, memberErr := requireSpaceMemberTx(ctx, tx, spaceID, userID)
		if errors.Is(memberErr, ErrSpaceForbidden) {
			isMember = false
			return nil
		}
		if memberErr != nil {
			return memberErr
		}
		isMember = true
		return nil
	})
	return isMember, err
}

func requireSpaceOwnerTx(ctx context.Context, tx *sql.Tx, spaceID, userID string) error {
	role, err := requireSpaceMemberTx(ctx, tx, spaceID, userID)
	if err != nil {
		return err
	}
	if role != "owner" {
		return ErrSpaceForbidden
	}
	return nil
}

func recordSpaceEventTx(ctx context.Context, tx *sql.Tx, spaceID, userID, eventType, entityID string, payload any) (int64, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	var id int64
	err = tx.QueryRowContext(ctx, `INSERT INTO space_events(space_id,event_type,actor_user_id,entity_id,payload)
		VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5) RETURNING id`, spaceID, eventType, userID, entityID, raw).Scan(&id)
	if err != nil {
		return 0, err
	}
	_, err = tx.ExecContext(ctx, `SELECT pg_notify('misty_space_events',$1)`, fmt.Sprint(id))
	return id, err
}

func notifySpaceControlTx(ctx context.Context, tx *sql.Tx, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `SELECT pg_notify('misty_space_control',$1)`, string(raw))
	return err
}

func (db *Database) CreateSpace(ctx context.Context, userID, name string) (*Space, error) {
	if err := db.ensurePersonalSpace(ctx, userID); err != nil {
		return nil, err
	}
	name, err := normalizeSpaceName(name)
	if err != nil {
		return nil, err
	}
	out := &Space{ID: "space_" + uuid.NewString(), SecurityDomainID: "sd_" + uuid.NewString(), OwnerUserID: userID, Name: name, Role: "owner", MemberCount: 1}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "spaces:owner:"+userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO security_domains(id,kind,owner_user_id,space_id) VALUES($1,'space',$2,$3)`, out.SecurityDomainID, userID, out.ID); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO spaces(id,owner_user_id,name,security_domain_id) VALUES($1,$2,$3,$4) RETURNING created_at,updated_at`, out.ID, userID, name, out.SecurityDomainID).Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_storage_usage(space_id) VALUES($1)`, out.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner')`, out.ID, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_roles(id,space_id,name,is_everyone,permissions) VALUES($1,$2,'@everyone',TRUE,'["space.view","messages.read","messages.write","library.view","library.download","storage.view_own_usage","studio.view","studio.manage","agents.run","tasks.view","tasks.manage","integrations.manage"]'::jsonb)`, "role_"+uuid.NewString(), out.ID); err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, out.ID, userID, "space.created", out.ID, map[string]any{"name": name})
		return err
	})
	return out, err
}

func (db *Database) ensurePersonalSpace(ctx context.Context, userID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "spaces:owner:"+userID); err != nil {
			return err
		}
		var userName string
		if err := tx.QueryRowContext(ctx, `SELECT name FROM users WHERE id=$1`, userID).Scan(&userName); err != nil {
			return err
		}
		personalName := defaultPersonalSpaceName(userName)
		var existingID, existingName string
		err := tx.QueryRowContext(ctx, `SELECT id,name FROM spaces WHERE owner_user_id=$1 AND is_personal LIMIT 1 FOR UPDATE`, userID).Scan(&existingID, &existingName)
		if err == nil {
			if existingName != "Default space" && existingName != "Personal" {
				return nil
			}
			if _, err := tx.ExecContext(ctx, `UPDATE spaces SET name=$1,updated_at=NOW() WHERE id=$2`, personalName, existingID); err != nil {
				return err
			}
			_, err = recordSpaceEventTx(ctx, tx, existingID, userID, "space.updated", existingID, map[string]any{"name": personalName, "automatic_default_name": true})
			return err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		spaceID, domainID := "space_"+uuid.NewString(), "sd_"+uuid.NewString()
		if _, err := tx.ExecContext(ctx, `INSERT INTO security_domains(id,kind,owner_user_id) VALUES($1,'personal',$2) ON CONFLICT (owner_user_id) WHERE kind='personal' DO NOTHING`, domainID, userID); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT id FROM security_domains WHERE kind='personal' AND owner_user_id=$1`, userID).Scan(&domainID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO spaces(id,owner_user_id,name,is_personal,security_domain_id) VALUES($1,$2,$3,TRUE,$4)`, spaceID, userID, personalName, domainID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_storage_usage(space_id) VALUES($1)`, spaceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner')`, spaceID, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_roles(id,space_id,name,is_everyone,permissions) VALUES($1,$2,'@everyone',TRUE,'["space.view","messages.read","messages.write","library.view","library.download","storage.view_own_usage","studio.view","studio.manage","agents.run","tasks.view","tasks.manage","integrations.manage"]'::jsonb)`, "role_"+uuid.NewString(), spaceID); err != nil {
			return err
		}
		_, err = recordSpaceEventTx(ctx, tx, spaceID, userID, "space.created", spaceID, map[string]any{"name": personalName, "is_personal": true})
		return err
	})
}

func (db *Database) ListSpaces(ctx context.Context, userID string) ([]Space, error) {
	if err := db.ensurePersonalSpace(ctx, userID); err != nil {
		return nil, err
	}
	spaces := []Space{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT s.id,s.security_domain_id,s.owner_user_id,s.name,m.role,
			(SELECT count(*) FROM space_members sm WHERE sm.space_id=s.id),
			(SELECT count(*) FROM space_invitations si WHERE si.space_id=s.id AND si.expires_at>NOW()),
			s.is_personal,
			(EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=s.id AND sm.role='member') OR
			 EXISTS(SELECT 1 FROM space_invitations si WHERE si.space_id=s.id AND si.expires_at>NOW())),
			s.created_at,s.updated_at
			FROM spaces s JOIN space_members m ON m.space_id=s.id
			WHERE m.user_id=$1 AND s.lifecycle_state='active' ORDER BY s.is_personal DESC,s.updated_at DESC`, userID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var space Space
			if err := rows.Scan(&space.ID, &space.SecurityDomainID, &space.OwnerUserID, &space.Name, &space.Role, &space.MemberCount, &space.PendingCount, &space.IsPersonal, &space.IsShared, &space.CreatedAt, &space.UpdatedAt); err != nil {
				rows.Close()
				return err
			}
			spaces = append(spaces, space)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for index := range spaces {
			if err := populateSpacePermissionsTx(ctx, tx, userID, &spaces[index]); err != nil {
				return err
			}
		}
		return nil
	})
	return spaces, err
}

func (db *Database) SpaceByID(ctx context.Context, userID, spaceID string) (*Space, error) {
	out := &Space{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `SELECT s.id,s.security_domain_id,s.owner_user_id,s.name,m.role,
			(SELECT count(*) FROM space_members sm WHERE sm.space_id=s.id),
			(SELECT count(*) FROM space_invitations si WHERE si.space_id=s.id AND si.expires_at>NOW()),
			s.is_personal,
			(EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=s.id AND sm.role='member') OR
			 EXISTS(SELECT 1 FROM space_invitations si WHERE si.space_id=s.id AND si.expires_at>NOW())),
			s.created_at,s.updated_at
			FROM spaces s JOIN space_members m ON m.space_id=s.id
			WHERE s.id=$1 AND m.user_id=$2 AND s.lifecycle_state='active'`, spaceID, userID).Scan(&out.ID, &out.SecurityDomainID, &out.OwnerUserID, &out.Name, &out.Role, &out.MemberCount, &out.PendingCount, &out.IsPersonal, &out.IsShared, &out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		return populateSpacePermissionsTx(ctx, tx, userID, out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	if err != nil {
		return nil, err
	}
	return out, err
}

func populateSpacePermissionsTx(ctx context.Context, tx *sql.Tx, userID string, space *Space) error {
	space.Permissions = make(map[string]bool, len(configurableSpacePermissions))
	for _, permission := range configurableSpacePermissions {
		allowed, err := hasSpacePermissionTx(ctx, tx, userID, space.ID, permission)
		if err != nil {
			return err
		}
		space.Permissions[permission] = allowed
	}
	applySpacePermissionDependencies(space.Permissions)
	return nil
}

func (db *Database) RenameSpace(ctx context.Context, userID, spaceID, name string) (*Space, error) {
	name, err := normalizeSpaceName(name)
	if err != nil {
		return nil, err
	}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceOwnerTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE spaces SET name=$1,updated_at=NOW() WHERE id=$2`, name, spaceID); err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "space.updated", spaceID, map[string]any{"name": name})
		return err
	})
	if err != nil {
		return nil, err
	}
	return db.SpaceByID(ctx, userID, spaceID)
}

func (db *Database) DeleteSpace(ctx context.Context, userID, spaceID, confirmation string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceOwnerTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		var name string
		var isPersonal bool
		if err := tx.QueryRowContext(ctx, `SELECT name,is_personal FROM spaces WHERE id=$1 FOR UPDATE`, spaceID).Scan(&name, &isPersonal); err != nil {
			return err
		}
		if isPersonal {
			return ErrSpaceForbidden
		}
		if confirmation != name {
			return ErrSpaceInvalid
		}
		rows, err := tx.QueryContext(ctx, `SELECT user_id FROM space_members WHERE space_id=$1`, spaceID)
		if err != nil {
			return err
		}
		memberIDs := []string{}
		for rows.Next() {
			var memberID string
			if err := rows.Scan(&memberID); err != nil {
				rows.Close()
				return err
			}
			memberIDs = append(memberIDs, memberID)
		}
		rows.Close()
		if err := notifySpaceControlTx(ctx, tx, map[string]any{"type": "space.deleted", "space_id": spaceID, "user_ids": memberIDs}); err != nil {
			return err
		}
		if _, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "space.deletion_requested", spaceID, map[string]any{"recover_days": 30}); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE spaces SET lifecycle_state='pending_deletion',deletion_requested_at=NOW(),permanent_delete_after=NOW()+INTERVAL '30 days',updated_at=NOW() WHERE id=$1`, spaceID)
		return err
	})
}

func (db *Database) SpaceMembers(ctx context.Context, userID, spaceID string) ([]SpaceMember, error) {
	members := []SpaceMember{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT m.space_id,m.user_id,u.name,u.email,m.role,m.joined_at,m.read_message_seq
			FROM space_members m JOIN users u ON u.id=m.user_id WHERE m.space_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,u.name`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m SpaceMember
			if err := rows.Scan(&m.SpaceID, &m.UserID, &m.Name, &m.Email, &m.Role, &m.JoinedAt, &m.ReadSeq); err != nil {
				return err
			}
			members = append(members, m)
		}
		return rows.Err()
	})
	return members, err
}

// SpaceMemberAvatarMeta permission-checks the requester and target within a Space
// and returns the member's avatar version (0 when unset). The bytes themselves are
// streamed from the object store (R2).
func (db *Database) SpaceMemberAvatarMeta(ctx context.Context, requestingUserID, spaceID, memberID string) (int64, error) {
	var version int64
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, requestingUserID); err != nil {
			return err
		}
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, memberID); err != nil {
			return err
		}
		err := tx.QueryRowContext(ctx, `SELECT avatar_version FROM users WHERE id=$1`, memberID).Scan(&version)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	})
	return version, err
}

func (db *Database) InviteToSpace(ctx context.Context, ownerID, spaceID, email string) (*SpaceInvitation, error) {
	if err := db.ensurePersonalSpace(ctx, ownerID); err != nil {
		return nil, err
	}
	email = normalizeEmail(email)
	if email == "" {
		return nil, ErrSpaceInvalid
	}
	out := &SpaceInvitation{ID: "invite_" + uuid.NewString(), SpaceID: spaceID, InvitedByUserID: ownerID, ExpiresAt: time.Now().UTC().Add(7 * 24 * time.Hour)}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceOwnerTx(ctx, tx, spaceID, ownerID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "spaces:owner:"+ownerID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "spaces:people:"+spaceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_invitations WHERE expires_at<=NOW()`); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT id,name,email FROM users WHERE lower(email)=$1`, email).Scan(&out.InvitedUserID, &out.InvitedUserName, &out.InvitedEmail); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceInviteeNotFound
		} else if err != nil {
			return err
		}
		var already bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2)`, spaceID, out.InvitedUserID).Scan(&already); err != nil {
			return err
		}
		if already {
			return ErrSpaceConflict
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_invitations(id,space_id,invited_user_id,invited_by_user_id,expires_at)
			VALUES($1,$2,$3,$4,$5) ON CONFLICT(space_id,invited_user_id) DO UPDATE SET invited_by_user_id=excluded.invited_by_user_id,expires_at=excluded.expires_at,created_at=NOW()
			RETURNING created_at`, out.ID, spaceID, out.InvitedUserID, ownerID, out.ExpiresAt).Scan(&out.CreatedAt); err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, spaceID, ownerID, "member.invited", out.InvitedUserID, map[string]any{"invite_id": out.ID})
		return err
	})
	return out, err
}

func (db *Database) IncomingSpaceInvites(ctx context.Context, userID string) ([]SpaceInvitation, error) {
	items := []SpaceInvitation{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_invitations WHERE expires_at<=NOW()`); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT i.id,i.space_id,s.name,i.invited_user_id,u.name,u.email,i.invited_by_user_id,i.expires_at,i.created_at
			FROM space_invitations i JOIN spaces s ON s.id=i.space_id JOIN users u ON u.id=i.invited_user_id
			WHERE i.invited_user_id=$1 ORDER BY i.created_at DESC`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceInvitation
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.SpaceName, &item.InvitedUserID, &item.InvitedUserName, &item.InvitedEmail, &item.InvitedByUserID, &item.ExpiresAt, &item.CreatedAt); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) RespondToSpaceInvite(ctx context.Context, userID, inviteID string, accept bool) (*Space, error) {
	var spaceID string
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var expires time.Time
		if err := tx.QueryRowContext(ctx, `SELECT space_id,expires_at FROM space_invitations WHERE id=$1 AND invited_user_id=$2 FOR UPDATE`, inviteID, userID).Scan(&spaceID, &expires); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceInviteNotFound
		} else if err != nil {
			return err
		}
		if time.Now().After(expires) {
			_, _ = tx.ExecContext(ctx, `DELETE FROM space_invitations WHERE id=$1`, inviteID)
			return ErrSpaceInviteExpired
		}
		if !accept {
			_, err := tx.ExecContext(ctx, `DELETE FROM space_invitations WHERE id=$1`, inviteID)
			return err
		}
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "spaces:member:"+userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'member')`, spaceID, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_invitations WHERE id=$1`, inviteID); err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "member.joined", userID, map[string]any{})
		return err
	})
	if err != nil || !accept {
		return nil, err
	}
	return db.SpaceByID(ctx, userID, spaceID)
}

func (db *Database) RemoveSpaceMember(ctx context.Context, ownerID, spaceID, memberID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceOwnerTx(ctx, tx, spaceID, ownerID); err != nil {
			return err
		}
		if ownerID == memberID {
			return ErrSpaceInvalid
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_conversation_members cm USING space_conversations c WHERE cm.conversation_id=c.id AND c.space_id=$1 AND cm.user_id=$2`, spaceID, memberID); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM space_members WHERE space_id=$1 AND user_id=$2 AND role='member'`, spaceID, memberID)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			return ErrSpaceNotFound
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_agents SET schedules_enabled=FALSE WHERE space_id=$1 AND creator_user_id=$2`, spaceID, memberID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_workflows SET schedules_enabled=FALSE WHERE space_id=$1 AND creator_user_id=$2`, spaceID, memberID); err != nil {
			return err
		}
		if _, err = recordSpaceEventTx(ctx, tx, spaceID, ownerID, "member.removed", memberID, map[string]any{}); err != nil {
			return err
		}
		return notifySpaceControlTx(ctx, tx, map[string]any{"type": "member.removed", "space_id": spaceID, "user_ids": []string{memberID}})
	})
}

func (db *Database) LeaveSpace(ctx context.Context, userID, spaceID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		role, err := requireSpaceMemberTx(ctx, tx, spaceID, userID)
		if err != nil {
			return err
		}
		if role == "owner" {
			return ErrSpaceInvalid
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_conversation_members cm USING space_conversations c WHERE cm.conversation_id=c.id AND c.space_id=$1 AND cm.user_id=$2`, spaceID, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_members WHERE space_id=$1 AND user_id=$2`, spaceID, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_agents SET schedules_enabled=FALSE WHERE space_id=$1 AND creator_user_id=$2`, spaceID, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_workflows SET schedules_enabled=FALSE WHERE space_id=$1 AND creator_user_id=$2`, spaceID, userID); err != nil {
			return err
		}
		if _, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "member.left", userID, map[string]any{}); err != nil {
			return err
		}
		return notifySpaceControlTx(ctx, tx, map[string]any{"type": "member.left", "space_id": spaceID, "user_ids": []string{userID}})
	})
}

func (db *Database) TransferSpaceOwnership(ctx context.Context, ownerID, spaceID, memberID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "spaces:owner:"+memberID); err != nil {
			return err
		}
		if err := requireSpaceOwnerTx(ctx, tx, spaceID, ownerID); err != nil {
			return err
		}
		var isPersonal bool
		if err := tx.QueryRowContext(ctx, `SELECT is_personal FROM spaces WHERE id=$1 FOR UPDATE`, spaceID).Scan(&isPersonal); err != nil {
			return err
		}
		if isPersonal {
			return ErrSpaceForbidden
		}
		var role string
		if err := tx.QueryRowContext(ctx, `SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2 FOR UPDATE`, spaceID, memberID).Scan(&role); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		} else if err != nil {
			return err
		}
		if role != "member" {
			return ErrSpaceInvalid
		}
		storageLockOwners := []string{ownerID, memberID}
		if storageLockOwners[1] < storageLockOwners[0] {
			storageLockOwners[0], storageLockOwners[1] = storageLockOwners[1], storageLockOwners[0]
		}
		for _, storageOwnerID := range storageLockOwners {
			if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "owner-storage:"+storageOwnerID); err != nil {
				return err
			}
		}
		var activeReservations int
		if err := tx.QueryRowContext(ctx, `SELECT
			(SELECT count(*) FROM space_upload_reservations WHERE space_id=$1 AND state='active')+
			(SELECT count(*) FROM space_rendition_reservations WHERE space_id=$1 AND state='active')`, spaceID).Scan(&activeReservations); err != nil {
			return err
		}
		if activeReservations > 0 {
			return ErrSpaceConflict
		}
		incoming, err := ownerStorageUsageTx(ctx, tx, memberID, true)
		if err != nil {
			return err
		}
		// Use the authoritative per-Space rows for the transfer decision. The
		// owner aggregate is maintained by triggers, but transfer must remain
		// correct even if an older deployment left that cache stale.
		var incomingUsed, incomingReserved int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(u.used_bytes),0),COALESCE(SUM(u.reserved_bytes),0)
			FROM spaces s JOIN space_storage_usage u ON u.space_id=s.id
			WHERE s.owner_user_id=$1 AND s.lifecycle_state='active'`, memberID).Scan(&incomingUsed, &incomingReserved); err != nil {
			return err
		}
		var spaceUsed, spaceReserved int64
		if err := tx.QueryRowContext(ctx, `SELECT used_bytes,reserved_bytes FROM space_storage_usage WHERE space_id=$1`, spaceID).Scan(&spaceUsed, &spaceReserved); errors.Is(err, sql.ErrNoRows) {
			spaceUsed, spaceReserved = 0, 0
		} else if err != nil {
			return err
		}
		if incomingUsed+incomingReserved+spaceUsed+spaceReserved > incoming.LimitBytes {
			return ErrLibraryQuota
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_members SET role='member' WHERE space_id=$1 AND user_id=$2`, spaceID, ownerID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_members SET role='owner' WHERE space_id=$1 AND user_id=$2`, spaceID, memberID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE spaces SET owner_user_id=$1,updated_at=NOW() WHERE id=$2`, memberID, spaceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE security_domains SET owner_user_id=$1,version=version+1,updated_at=NOW() WHERE space_id=$2 AND kind='space'`, memberID, spaceID); err != nil {
			return err
		}
		_, err = recordSpaceEventTx(ctx, tx, spaceID, ownerID, "owner.transferred", memberID, map[string]any{})
		return err
	})
}

func validateMessage(content []MessageSpan, fileNodeIDs []string) error {
	return validateMessageWithReferences(content, len(fileNodeIDs))
}

func requireSpaceMessageWriteTx(ctx context.Context, tx *sql.Tx, userID, spaceID string) error {
	if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
		return err
	}
	return requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesWrite)
}

func validateMessageWithReferences(content []MessageSpan, referenceCount int) error {
	if referenceCount > MaxMessageFiles || len(content) == 0 && referenceCount == 0 {
		return ErrSpaceInvalid
	}
	chars := 0
	for _, span := range content {
		switch span.Type {
		case "text":
			chars += len([]rune(span.Text))
		case "mention":
			if (span.UserID == "") == (span.AgentID == "") {
				return ErrSpaceInvalid
			}
			chars += len([]rune(span.Label))
		default:
			return ErrSpaceInvalid
		}
	}
	if chars > MaxMessageChars || chars < 1 && referenceCount == 0 {
		return ErrSpaceInvalid
	}
	return nil
}

func messagePreview(content []MessageSpan) string {
	var builder strings.Builder
	for _, span := range content {
		if span.Type == "text" {
			builder.WriteString(span.Text)
		} else {
			builder.WriteString("@")
			builder.WriteString(span.Label)
		}
	}
	preview := []rune(strings.TrimSpace(builder.String()))
	if len(preview) > 180 {
		preview = append(preview[:177], '.', '.', '.')
	}
	return string(preview)
}

func (db *Database) CreateSpaceMessage(ctx context.Context, userID, spaceID string, content []MessageSpan, fileNodeIDs []string) (*SpaceMessage, []string, error) {
	return db.CreateSpaceMessageWithReferences(ctx, userID, spaceID, content, fileNodeIDs, nil, nil, "")
}

func (db *Database) CreateSpaceMessageWithReferences(ctx context.Context, userID, spaceID string, content []MessageSpan, fileNodeIDs, attachmentIDs, libraryItemIDs []string, replyToMessageID string) (*SpaceMessage, []string, error) {
	return db.createSpaceMessageWithReferences(ctx, userID, spaceID, "", content, fileNodeIDs, attachmentIDs, libraryItemIDs, replyToMessageID)
}

func (db *Database) CreateSpaceConversationMessageWithReferences(ctx context.Context, userID, spaceID, conversationID string, content []MessageSpan, fileNodeIDs, attachmentIDs, libraryItemIDs []string, replyToMessageID string) (*SpaceMessage, []string, error) {
	return db.createSpaceMessageWithReferences(ctx, userID, spaceID, conversationID, content, fileNodeIDs, attachmentIDs, libraryItemIDs, replyToMessageID)
}

func (db *Database) createSpaceMessageWithReferences(ctx context.Context, userID, spaceID, conversationID string, content []MessageSpan, fileNodeIDs, attachmentIDs, libraryItemIDs []string, replyToMessageID string) (*SpaceMessage, []string, error) {
	if err := validateMessageWithReferences(content, len(fileNodeIDs)+len(attachmentIDs)+len(libraryItemIDs)); err != nil {
		return nil, nil, err
	}
	out := &SpaceMessage{ID: "msg_" + uuid.NewString(), SpaceID: spaceID, ConversationID: conversationID, SenderUserID: userID, SenderKind: "person", Content: content, FileNodeIDs: fileNodeIDs, LibraryItemIDs: uniqueSpaceIDs(libraryItemIDs), Attachments: []MessageAttachment{}, ReplyToMessageID: replyToMessageID}
	attachmentIDs = uniqueSpaceIDs(attachmentIDs)
	agentMentions := []string{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceMessageWriteTx(ctx, tx, userID, spaceID); err != nil {
			return err
		}
		if conversationID != "" {
			if err := requireSpaceConversationMemberTx(ctx, tx, userID, spaceID, conversationID); err != nil {
				return err
			}
		}
		if len(out.LibraryItemIDs) > 0 {
			if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
				return err
			}
		}
		for _, nodeID := range fileNodeIDs {
			var ok bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_nodes WHERE id=$1 AND space_id=$2 AND kind='link')`, nodeID, spaceID).Scan(&ok); err != nil || !ok {
				return ErrSpaceInvalid
			}
		}
		if replyToMessageID != "" {
			var exists bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_messages WHERE id=$1 AND space_id=$2 AND COALESCE(conversation_id,'')=$3)`, replyToMessageID, spaceID, conversationID).Scan(&exists); err != nil || !exists {
				return ErrSpaceInvalid
			}
		}
		for _, itemID := range out.LibraryItemIDs {
			var exists bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_library_items WHERE id=$1 AND space_id=$2 AND lifecycle_state='ready')`, itemID, spaceID).Scan(&exists); err != nil || !exists {
				return ErrSpaceInvalid
			}
		}
		for _, attachmentID := range attachmentIDs {
			var attachment MessageAttachment
			if err := scanMessageAttachment(tx.QueryRowContext(ctx, `SELECT id,space_id,COALESCE(message_id,''),file_id,upload_id,uploader_user_id,display_name,COALESCE(promoted_item_id,''),lifecycle_state,created_at,deleted_at,recover_until FROM space_message_attachments WHERE id=$1 AND space_id=$2 AND uploader_user_id=$3 AND message_id IS NULL AND lifecycle_state='ready' FOR UPDATE`, attachmentID, spaceID, userID), &attachment); err != nil {
				return ErrSpaceInvalid
			}
			out.Attachments = append(out.Attachments, attachment)
		}
		mentionUsers := map[string]bool{}
		for _, span := range content {
			if span.UserID != "" {
				var ok bool
				query := `SELECT EXISTS(SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2)`
				args := []any{spaceID, span.UserID}
				if conversationID != "" {
					query = `SELECT EXISTS(SELECT 1 FROM space_conversation_members cm JOIN space_conversations c ON c.id=cm.conversation_id WHERE c.space_id=$1 AND cm.user_id=$2 AND cm.conversation_id=$3)`
					args = append(args, conversationID)
				}
				if err := tx.QueryRowContext(ctx, query, args...).Scan(&ok); err != nil || !ok {
					return ErrSpaceInvalid
				}
				mentionUsers[span.UserID] = true
			}
			if span.AgentID != "" {
				if _, personalErr := personalAgentAllowedTx(ctx, tx, userID, spaceID, span.AgentID); personalErr != nil {
					var ok bool
					if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_agents WHERE space_id=$1 AND id=$2 AND enabled AND (creator_user_id=$3 OR access_policy->>'mode'='space' OR access_policy->'allowedUserIds' ? $3))`, spaceID, span.AgentID, userID).Scan(&ok); err != nil || !ok {
						return ErrSpaceInvalid
					}
				}
				agentMentions = append(agentMentions, span.AgentID)
			}
		}
		raw, _ := json.Marshal(content)
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_messages(id,space_id,conversation_id,sender_user_id,content,file_node_ids,reply_to_message_id)
			VALUES($1,$2,NULLIF($3,''),$4,$5,$6,NULLIF($7,'')) RETURNING seq,created_at`, out.ID, spaceID, conversationID, userID, raw, pqStringArray(fileNodeIDs), replyToMessageID).Scan(&out.Seq, &out.CreatedAt); err != nil {
			return err
		}
		for _, attachmentID := range attachmentIDs {
			if _, err := tx.ExecContext(ctx, `UPDATE space_message_attachments SET message_id=$1 WHERE id=$2`, out.ID, attachmentID); err != nil {
				return err
			}
		}
		for _, itemID := range out.LibraryItemIDs {
			var referenceAllowed bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_library_items WHERE id=$1 AND space_id=$2 AND lifecycle_state='ready' AND hidden=FALSE)`, itemID, spaceID).Scan(&referenceAllowed); err != nil {
				return err
			}
			if !referenceAllowed {
				return ErrLibraryNotFound
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO space_message_library_references(message_id,space_id,space_library_item_id,created_by_user_id) VALUES($1,$2,$3,$4)`, out.ID, spaceID, itemID, userID); err != nil {
				return err
			}
		}
		if err := tx.QueryRowContext(ctx, `SELECT name,avatar_version FROM users WHERE id=$1`, userID).Scan(&out.SenderName, &out.SenderAvatarVersion); err != nil {
			return err
		}
		eventID, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "message.created", out.ID, out)
		if err != nil {
			return err
		}
		inboxPayload, _ := json.Marshal(map[string]any{"sender_name": out.SenderName, "preview": messagePreview(content), "conversation_id": conversationID})
		recipientsQuery := `SELECT user_id FROM space_members WHERE space_id=$1 AND user_id<>$2`
		recipientArgs := []any{spaceID, userID}
		if conversationID != "" {
			recipientsQuery = `SELECT cm.user_id FROM space_conversation_members cm JOIN space_conversations c ON c.id=cm.conversation_id WHERE c.space_id=$1 AND cm.user_id<>$2 AND cm.conversation_id=$3`
			recipientArgs = append(recipientArgs, conversationID)
		}
		rows, err := tx.QueryContext(ctx, recipientsQuery, recipientArgs...)
		if err != nil {
			return err
		}
		recipientIDs := []string{}
		for rows.Next() {
			var memberID string
			if err := rows.Scan(&memberID); err != nil {
				rows.Close()
				return err
			}
			recipientIDs = append(recipientIDs, memberID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, memberID := range recipientIDs {
			allowed, err := hasSpacePermissionTx(ctx, tx, memberID, spaceID, PermissionMessagesRead)
			if err != nil {
				return err
			}
			if !allowed {
				continue
			}
			kind := "unread"
			if mentionUsers[memberID] {
				kind = "mention"
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO space_inbox_items(user_id,space_id,kind,message_id,event_id,payload) VALUES($1,$2,$3,$4,$5,$6)`, memberID, spaceID, kind, out.ID, eventID, inboxPayload); err != nil {
				return err
			}
		}
		return nil
	})
	return out, agentMentions, err
}

func uniqueSpaceIDs(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

// pqStringArray intentionally returns a PostgreSQL array literal without
// importing pq into the public data model. IDs are server-generated and cannot
// contain quotes, commas, or braces.
func pqStringArray(values []string) string {
	if len(values) == 0 {
		return "{}"
	}
	return "{" + strings.Join(values, ",") + "}"
}

func scanSpaceMessage(scanner interface{ Scan(...any) error }, out *SpaceMessage) error {
	var raw []byte
	var files string
	var agentID sql.NullString
	var origin []byte
	if err := scanner.Scan(&out.Seq, &out.ID, &out.SpaceID, &out.ConversationID, &out.SenderUserID, &out.SenderName, &out.SenderAvatarVersion, &out.SenderKind, &agentID, &raw, &files, &out.EditedAt, &out.CreatedAt, &out.ReplyToMessageID, &origin); err != nil {
		return err
	}
	out.SenderAgentID = agentID.String
	if len(origin) > 0 {
		out.Origin = append(json.RawMessage(nil), origin...)
	}
	if err := json.Unmarshal(raw, &out.Content); err != nil {
		return err
	}
	out.FileNodeIDs = parsePGTextArray(files)
	return nil
}

func parsePGTextArray(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" {
		return []string{}
	}
	return strings.Split(strings.TrimSuffix(strings.TrimPrefix(raw, "{"), "}"), ",")
}

const spaceMessageColumns = `m.seq,m.id,m.space_id,COALESCE(m.conversation_id,''),m.sender_user_id,CASE WHEN m.origin->>'author_name' IS NOT NULL AND m.origin->>'author_name'<>'' THEN m.origin->>'author_name' WHEN m.sender_kind='agent' THEN COALESCE(a.name,'Misty Agent') ELSE COALESCE(u.name,'Misty') END,CASE WHEN m.sender_kind='person' AND COALESCE(m.origin->>'author_name','')='' THEN COALESCE(u.avatar_version,0) ELSE 0 END,m.sender_kind,m.sender_agent_id,m.content,m.file_node_ids::text,m.edited_at,m.created_at,COALESCE(m.reply_to_message_id,''),m.origin`

func (db *Database) SpaceMessages(ctx context.Context, userID, spaceID string, before int64, limit int) ([]SpaceMessage, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	items := []SpaceMessage{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceMessageColumns+` FROM space_messages m
			LEFT JOIN users u ON u.id=m.sender_user_id LEFT JOIN space_agents a ON a.id=m.sender_agent_id
			WHERE m.space_id=$1 AND m.conversation_id IS NULL AND ($2=0 OR m.seq<$2) ORDER BY m.seq DESC LIMIT $3`, spaceID, before, limit)
		if err != nil {
			return err
		}
		for rows.Next() {
			var item SpaceMessage
			if err := scanSpaceMessage(rows, &item); err != nil {
				rows.Close()
				return err
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for index := range items {
			if err := loadSpaceMessageReferencesTx(ctx, tx, &items[index]); err != nil {
				return err
			}
		}
		return nil
	})
	return items, err
}

func loadSpaceMessageReferencesTx(ctx context.Context, tx *sql.Tx, message *SpaceMessage) error {
	message.LibraryItemIDs = []string{}
	message.Attachments = []MessageAttachment{}
	rows, err := tx.QueryContext(ctx, `SELECT space_library_item_id FROM space_message_library_references WHERE message_id=$1 ORDER BY created_at`, message.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		message.LibraryItemIDs = append(message.LibraryItemIDs, id)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	rows, err = tx.QueryContext(ctx, `SELECT id,space_id,COALESCE(message_id,''),file_id,upload_id,uploader_user_id,display_name,COALESCE(promoted_item_id,''),lifecycle_state,created_at,deleted_at,recover_until FROM space_message_attachments WHERE message_id=$1 AND lifecycle_state='ready' ORDER BY created_at`, message.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var attachment MessageAttachment
		if err := scanMessageAttachment(rows, &attachment); err != nil {
			return err
		}
		message.Attachments = append(message.Attachments, attachment)
	}
	return rows.Err()
}

func (db *Database) UpdateSpaceMessage(ctx context.Context, userID, spaceID, messageID string, content []MessageSpan, fileNodeIDs []string) (*SpaceMessage, error) {
	return db.updateSpaceMessage(ctx, userID, spaceID, "", messageID, content, fileNodeIDs)
}

func (db *Database) UpdateSpaceConversationMessage(ctx context.Context, userID, spaceID, conversationID, messageID string, content []MessageSpan, fileNodeIDs []string) (*SpaceMessage, error) {
	return db.updateSpaceMessage(ctx, userID, spaceID, conversationID, messageID, content, fileNodeIDs)
}

func (db *Database) updateSpaceMessage(ctx context.Context, userID, spaceID, conversationID, messageID string, content []MessageSpan, fileNodeIDs []string) (*SpaceMessage, error) {
	if err := validateMessage(content, fileNodeIDs); err != nil {
		return nil, err
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceMessageWriteTx(ctx, tx, userID, spaceID); err != nil {
			return err
		}
		if conversationID != "" {
			if err := requireSpaceConversationMemberTx(ctx, tx, userID, spaceID, conversationID); err != nil {
				return err
			}
		}
		var sender string
		if err := tx.QueryRowContext(ctx, `SELECT sender_user_id FROM space_messages WHERE id=$1 AND space_id=$2 AND COALESCE(conversation_id,'')=$3 FOR UPDATE`, messageID, spaceID, conversationID).Scan(&sender); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		} else if err != nil {
			return err
		}
		if sender != userID {
			return ErrSpaceForbidden
		}
		raw, _ := json.Marshal(content)
		if _, err := tx.ExecContext(ctx, `UPDATE space_messages SET content=$1,file_node_ids=$2,edited_at=NOW() WHERE id=$3`, raw, pqStringArray(fileNodeIDs), messageID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_inbox_items WHERE message_id=$1 AND kind='mention'`, messageID); err != nil {
			return err
		}
		for _, span := range content {
			if span.UserID != "" && span.UserID != sender {
				memberQuery := `SELECT EXISTS(SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2)`
				memberArgs := []any{spaceID, span.UserID}
				if conversationID != "" {
					memberQuery = `SELECT EXISTS(SELECT 1 FROM space_conversation_members cm JOIN space_conversations c ON c.id=cm.conversation_id WHERE c.space_id=$1 AND cm.user_id=$2 AND cm.conversation_id=$3)`
					memberArgs = append(memberArgs, conversationID)
				}
				var allowed bool
				if err := tx.QueryRowContext(ctx, memberQuery, memberArgs...).Scan(&allowed); err != nil {
					return err
				}
				if !allowed {
					return ErrSpaceInvalid
				}
				payload, _ := json.Marshal(map[string]string{"conversation_id": conversationID})
				if _, err := tx.ExecContext(ctx, `INSERT INTO space_inbox_items(user_id,space_id,kind,message_id,payload) VALUES($1,$2,'mention',$3,$4)`, span.UserID, spaceID, messageID, payload); err != nil {
					return err
				}
			}
		}
		_, eventErr := recordSpaceEventTx(ctx, tx, spaceID, userID, "message.updated", messageID, map[string]any{"conversation_id": conversationID})
		return eventErr
	})
	if err != nil {
		return nil, err
	}
	out := &SpaceMessage{}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		if err := scanSpaceMessage(tx.QueryRowContext(ctx, `SELECT `+spaceMessageColumns+` FROM space_messages m LEFT JOIN users u ON u.id=m.sender_user_id LEFT JOIN space_agents a ON a.id=m.sender_agent_id WHERE m.id=$1 AND m.space_id=$2 AND COALESCE(m.conversation_id,'')=$3`, messageID, spaceID, conversationID), out); err != nil {
			return err
		}
		return loadSpaceMessageReferencesTx(ctx, tx, out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) DeleteSpaceMessage(ctx context.Context, userID, spaceID, messageID string) error {
	return db.deleteSpaceMessage(ctx, userID, spaceID, "", messageID)
}

func (db *Database) DeleteSpaceConversationMessage(ctx context.Context, userID, spaceID, conversationID, messageID string) error {
	return db.deleteSpaceMessage(ctx, userID, spaceID, conversationID, messageID)
}

func (db *Database) deleteSpaceMessage(ctx context.Context, userID, spaceID, conversationID, messageID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceMessageWriteTx(ctx, tx, userID, spaceID); err != nil {
			return err
		}
		if conversationID != "" {
			if err := requireSpaceConversationMemberTx(ctx, tx, userID, spaceID, conversationID); err != nil {
				return err
			}
		}
		role, err := requireSpaceMemberTx(ctx, tx, spaceID, userID)
		if err != nil {
			return err
		}
		var sender string
		if err := tx.QueryRowContext(ctx, `SELECT sender_user_id FROM space_messages WHERE id=$1 AND space_id=$2 AND COALESCE(conversation_id,'')=$3 FOR UPDATE`, messageID, spaceID, conversationID).Scan(&sender); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		} else if err != nil {
			return err
		}
		if sender != userID && role != "owner" {
			return ErrSpaceForbidden
		}
		if _, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "message.deleted", messageID, map[string]any{"conversation_id": conversationID}); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM space_messages WHERE id=$1`, messageID)
		return err
	})
}

func (db *Database) CreateSpaceAgentMessage(ctx context.Context, billingUserID, spaceID, agentID, text string) (*SpaceMessage, error) {
	return db.createSpaceAgentMessage(ctx, billingUserID, spaceID, "", agentID, text)
}

func (db *Database) CreateSpaceConversationAgentMessage(ctx context.Context, billingUserID, spaceID, conversationID, agentID, text string) (*SpaceMessage, error) {
	return db.createSpaceAgentMessage(ctx, billingUserID, spaceID, conversationID, agentID, text)
}

func (db *Database) createSpaceAgentMessage(ctx context.Context, billingUserID, spaceID, conversationID, agentID, text string) (*SpaceMessage, error) {
	content := []MessageSpan{{Type: "text", Text: strings.TrimSpace(text)}}
	if err := validateMessage(content, nil); err != nil {
		return nil, err
	}
	out := &SpaceMessage{ID: "msg_" + uuid.NewString(), SpaceID: spaceID, ConversationID: conversationID, SenderUserID: billingUserID, SenderKind: "agent", SenderAgentID: agentID, Content: content, FileNodeIDs: []string{}, LibraryItemIDs: []string{}, Attachments: []MessageAttachment{}}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceMessageWriteTx(ctx, tx, billingUserID, spaceID); err != nil {
			return err
		}
		if conversationID != "" {
			if err := requireSpaceConversationMemberTx(ctx, tx, billingUserID, spaceID, conversationID); err != nil {
				return err
			}
		}
		raw, _ := json.Marshal(content)
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_messages(id,space_id,conversation_id,sender_user_id,sender_kind,sender_agent_id,content)
			VALUES($1,$2,NULLIF($3,''),$4,'agent',$5,$6) RETURNING seq,created_at`, out.ID, spaceID, conversationID, billingUserID, agentID, raw).Scan(&out.Seq, &out.CreatedAt); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT name FROM personal_agents WHERE id=$1 AND deleted_at IS NULL UNION ALL SELECT name FROM space_agents WHERE id=$1 AND space_id=$2 LIMIT 1`, agentID, spaceID).Scan(&out.SenderName); err != nil {
			return err
		}
		eventID, err := recordSpaceEventTx(ctx, tx, spaceID, billingUserID, "message.created", out.ID, out)
		if err != nil {
			return err
		}
		inboxPayload, _ := json.Marshal(map[string]any{"sender_name": out.SenderName, "preview": messagePreview(content), "conversation_id": conversationID})
		recipientsQuery := `SELECT user_id FROM space_members WHERE space_id=$1`
		recipientArgs := []any{spaceID}
		if conversationID != "" {
			recipientsQuery = `SELECT cm.user_id FROM space_conversation_members cm JOIN space_conversations c ON c.id=cm.conversation_id WHERE c.space_id=$1 AND cm.conversation_id=$2`
			recipientArgs = append(recipientArgs, conversationID)
		}
		rows, err := tx.QueryContext(ctx, recipientsQuery, recipientArgs...)
		if err != nil {
			return err
		}
		recipientIDs := []string{}
		for rows.Next() {
			var memberID string
			if err := rows.Scan(&memberID); err != nil {
				rows.Close()
				return err
			}
			recipientIDs = append(recipientIDs, memberID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, memberID := range recipientIDs {
			allowed, err := hasSpacePermissionTx(ctx, tx, memberID, spaceID, PermissionMessagesRead)
			if err != nil {
				return err
			}
			if !allowed {
				continue
			}
			kind := "unread"
			if memberID == billingUserID {
				kind = "agent"
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO space_inbox_items(user_id,space_id,kind,message_id,event_id,payload) VALUES($1,$2,$3,$4,$5,$6)`, memberID, spaceID, kind, out.ID, eventID, inboxPayload); err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

func (db *Database) UpsertSpaceNode(ctx context.Context, userID string, node SpaceNode) (*SpaceNode, error) {
	node.DisplayName = strings.TrimSpace(node.DisplayName)
	if node.ID == "" {
		node.ID = "node_" + uuid.NewString()
	}
	if len([]rune(node.DisplayName)) < 1 || len([]rune(node.DisplayName)) > 255 || (node.Kind != "folder" && node.Kind != "link") {
		return nil, ErrSpaceInvalid
	}
	if node.Kind == "link" && (len(node.TargetCipher) == 0 || len(node.TargetNonce) == 0) {
		return nil, ErrSpaceInvalid
	}
	node.UploaderUserID = userID
	if len(node.Metadata) == 0 {
		node.Metadata = json.RawMessage(`{}`)
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceMessageWriteTx(ctx, tx, userID, node.SpaceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "spaces:nodes:"+node.SpaceID); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM space_nodes WHERE space_id=$1`, node.SpaceID).Scan(&count); err != nil {
			return err
		}
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_nodes WHERE id=$1 AND space_id=$2)`, node.ID, node.SpaceID).Scan(&exists); err != nil {
			return err
		}
		if !exists && count >= MaxSpaceNodes {
			return ErrSpaceNodeLimit
		}
		if node.ParentID != "" {
			if node.ParentID == node.ID {
				return ErrSpaceInvalid
			}
			var parentOK bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_nodes WHERE id=$1 AND space_id=$2 AND kind='folder')`, node.ParentID, node.SpaceID).Scan(&parentOK); err != nil || !parentOK {
				return ErrSpaceInvalid
			}
			if exists && node.Kind == "folder" {
				var cycle bool
				if err := tx.QueryRowContext(ctx, `WITH RECURSIVE descendants AS (
					SELECT id FROM space_nodes WHERE parent_id=$1 AND space_id=$2
					UNION ALL SELECT child.id FROM space_nodes child JOIN descendants parent ON child.parent_id=parent.id WHERE child.space_id=$2
				) SELECT EXISTS(SELECT 1 FROM descendants WHERE id=$3)`, node.ID, node.SpaceID, node.ParentID).Scan(&cycle); err != nil {
					return err
				}
				if cycle {
					return ErrSpaceInvalid
				}
			}
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_nodes(id,space_id,parent_id,kind,display_name,uploader_user_id,target_ciphertext,target_nonce,target_key_version,mime_type,size_bytes,metadata)
			VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,NULLIF($9,0),$10,$11,$12)
			ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,display_name=excluded.display_name,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,metadata=excluded.metadata,updated_at=NOW()
			WHERE space_nodes.space_id=excluded.space_id
			RETURNING created_at,updated_at`, node.ID, node.SpaceID, node.ParentID, node.Kind, node.DisplayName, userID, nullableBytes(node.TargetCipher), nullableBytes(node.TargetNonce), node.KeyVersion, node.MIMEType, node.SizeBytes, node.Metadata).Scan(&node.CreatedAt, &node.UpdatedAt); err != nil {
			return err
		}
		eventType := "node.updated"
		if !exists {
			eventType = "node.created"
		}
		_, err := recordSpaceEventTx(ctx, tx, node.SpaceID, userID, eventType, node.ID, node)
		return err
	})
	return &node, err
}

func nullableBytes(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

func (db *Database) SpaceNodes(ctx context.Context, userID, spaceID string) ([]SpaceNode, error) {
	items := []SpaceNode{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,COALESCE(parent_id,''),kind,display_name,uploader_user_id,mime_type,size_bytes,stale,metadata,created_at,updated_at
			FROM space_nodes WHERE space_id=$1 ORDER BY parent_id NULLS FIRST,kind,display_name`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceNode
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.ParentID, &item.Kind, &item.DisplayName, &item.UploaderUserID, &item.MIMEType, &item.SizeBytes, &item.Stale, &item.Metadata, &item.CreatedAt, &item.UpdatedAt); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) SpaceNodeSecret(ctx context.Context, userID, spaceID, nodeID string) (*SpaceNode, error) {
	out := &SpaceNode{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT id,space_id,COALESCE(parent_id,''),kind,display_name,uploader_user_id,mime_type,size_bytes,stale,metadata,created_at,updated_at,target_ciphertext,target_nonce,COALESCE(target_key_version,0)
			FROM space_nodes WHERE id=$1 AND space_id=$2`, nodeID, spaceID).Scan(&out.ID, &out.SpaceID, &out.ParentID, &out.Kind, &out.DisplayName, &out.UploaderUserID, &out.MIMEType, &out.SizeBytes, &out.Stale, &out.Metadata, &out.CreatedAt, &out.UpdatedAt, &out.TargetCipher, &out.TargetNonce, &out.KeyVersion)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	if err != nil {
		return nil, err
	}
	return out, err
}

func (db *Database) DeleteSpaceNode(ctx context.Context, userID, spaceID, nodeID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceMessageWriteTx(ctx, tx, userID, spaceID); err != nil {
			return err
		}
		if _, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "node.removed", nodeID, map[string]any{}); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM space_nodes WHERE id=$1 AND space_id=$2`, nodeID, spaceID)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			return ErrSpaceNotFound
		}
		return nil
	})
}

func (db *Database) MarkSpaceNodeStale(ctx context.Context, userID, spaceID, nodeID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceMessageWriteTx(ctx, tx, userID, spaceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_nodes SET stale=TRUE,updated_at=NOW() WHERE id=$1 AND space_id=$2`, nodeID, spaceID); err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "node.stale", nodeID, map[string]any{})
		return err
	})
}

func (db *Database) SpaceInbox(ctx context.Context, userID, tab string, limit int) ([]SpaceInboxItem, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	items := []SpaceInboxItem{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		where := "i.kind='unread'"
		if tab == "mentions" {
			where = "i.kind IN ('mention','agent','approval','workflow')"
		}
		rows, err := tx.QueryContext(ctx, `SELECT i.id,i.space_id,s.name,i.kind,COALESCE(i.message_id,''),i.event_id,i.payload,i.seen_at,i.created_at
			FROM space_inbox_items i JOIN spaces s ON s.id=i.space_id
			WHERE i.user_id=$1 AND `+where+`
			AND EXISTS(SELECT 1 FROM space_members current_member WHERE current_member.space_id=i.space_id AND current_member.user_id=$1)
			AND (i.message_id IS NULL OR s.owner_user_id=$1
				OR EXISTS(SELECT 1 FROM space_member_permission_overrides mpo WHERE mpo.space_id=i.space_id AND mpo.user_id=$1 AND mpo.permission=$3 AND mpo.effect='allow')
				OR (NOT EXISTS(SELECT 1 FROM space_member_permission_overrides mpo WHERE mpo.space_id=i.space_id AND mpo.user_id=$1 AND mpo.permission=$3)
					AND EXISTS(SELECT 1 FROM space_roles role LEFT JOIN space_member_roles mr ON mr.role_id=role.id AND mr.space_id=role.space_id AND mr.user_id=$1 WHERE role.space_id=i.space_id AND (role.is_everyone OR mr.user_id IS NOT NULL) AND role.permissions ? $3)))
			ORDER BY i.id DESC LIMIT $2`, userID, limit, PermissionMessagesRead)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceInboxItem
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.SpaceName, &item.Kind, &item.MessageID, &item.EventID, &item.Payload, &item.SeenAt, &item.CreatedAt); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) MarkSpaceInboxSeen(ctx context.Context, userID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE space_inbox_items SET seen_at=NOW() WHERE user_id=$1 AND seen_at IS NULL`, userID)
		return err
	})
}

func (db *Database) ClearSpaceInbox(ctx context.Context, userID, tab string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		where := "kind='unread'"
		if tab == "mentions" {
			where = "kind IN ('mention','agent','approval','workflow')"
		}
		if tab == "unreads" {
			if _, err := tx.ExecContext(ctx, `UPDATE space_members m SET read_message_seq=GREATEST(m.read_message_seq,COALESCE((SELECT max(seq) FROM space_messages WHERE space_id=m.space_id),0)) WHERE m.user_id=$1`, userID); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM space_inbox_items WHERE user_id=$1 AND `+where, userID)
		return err
	})
}

func (db *Database) MarkSpaceRead(ctx context.Context, userID, spaceID string, seq int64) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_members SET read_message_seq=GREATEST(read_message_seq,$1) WHERE space_id=$2 AND user_id=$3`, seq, spaceID, userID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM space_inbox_items i USING space_messages m WHERE i.user_id=$1 AND i.space_id=$2 AND i.message_id=m.id AND m.seq<=$3 AND i.kind='unread'`, userID, spaceID, seq)
		return err
	})
}

func (db *Database) CreateRealtimeTicket(ctx context.Context, userID, tokenHash string, after int64, expires time.Time) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO realtime_tickets(token_hash,user_id,after_cursor,expires_at) VALUES($1,$2,$3,$4)`, tokenHash, userID, after, expires)
		return err
	})
}

func (db *Database) ConsumeRealtimeTicket(ctx context.Context, tokenHash string) (string, int64, error) {
	var userID string
	var after int64
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `UPDATE realtime_tickets SET consumed_at=NOW() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id,after_cursor`, tokenHash).Scan(&userID, &after)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, ErrSpaceForbidden
	}
	return userID, after, err
}

func (db *Database) SpaceEventsAfter(ctx context.Context, userID string, after int64, limit int) ([]SpaceEvent, bool, error) {
	if limit < 1 || limit > 1000 {
		limit = 500
	}
	events := []SpaceEvent{}
	resync := false
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if after > 0 {
			var oldest sql.NullInt64
			if err := tx.QueryRowContext(ctx, `SELECT min(id) FROM space_events WHERE created_at>NOW()-INTERVAL '7 days'`).Scan(&oldest); err != nil {
				return err
			}
			resync = oldest.Valid && after < oldest.Int64-1
		}
		permissionCache := map[string]bool{}
		cursor := after
		const batchSize = 500
		for len(events) < limit {
			rows, err := tx.QueryContext(ctx, `SELECT e.id,e.space_id,e.event_type,COALESCE(e.actor_user_id,''),COALESCE(e.entity_id,''),e.payload,e.created_at
				FROM space_events e JOIN space_members m ON m.space_id=e.space_id
				WHERE m.user_id=$1 AND e.id>$2 AND e.created_at>NOW()-INTERVAL '7 days'
				ORDER BY e.id LIMIT $3`, userID, cursor, batchSize)
			if err != nil {
				return err
			}
			batch := make([]SpaceEvent, 0, batchSize)
			for rows.Next() {
				var event SpaceEvent
				if err := rows.Scan(&event.ID, &event.SpaceID, &event.EventType, &event.ActorUserID, &event.EntityID, &event.Payload, &event.CreatedAt); err != nil {
					rows.Close()
					return err
				}
				batch = append(batch, event)
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return err
			}
			if err := rows.Close(); err != nil {
				return err
			}
			for _, event := range batch {
				cursor = event.ID
				visible, err := spaceEventVisibleToUserTx(ctx, tx, userID, event, permissionCache)
				if err != nil {
					return err
				}
				if visible {
					events = append(events, event)
					if len(events) == limit {
						break
					}
				}
			}
			if len(batch) < batchSize {
				break
			}
		}
		return nil
	})
	return events, resync, err
}

func (db *Database) EventByIDForUser(ctx context.Context, userID string, eventID int64) (*SpaceEvent, error) {
	out := &SpaceEvent{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `SELECT e.id,e.space_id,e.event_type,COALESCE(e.actor_user_id,''),COALESCE(e.entity_id,''),e.payload,e.created_at
			FROM space_events e JOIN space_members m ON m.space_id=e.space_id
			WHERE e.id=$1 AND m.user_id=$2`, eventID, userID).Scan(&out.ID, &out.SpaceID, &out.EventType, &out.ActorUserID, &out.EntityID, &out.Payload, &out.CreatedAt); err != nil {
			return err
		}
		visible, err := spaceEventVisibleToUserTx(ctx, tx, userID, *out, map[string]bool{})
		if err != nil {
			return err
		}
		if !visible {
			return sql.ErrNoRows
		}
		return nil
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func spaceEventVisibleToUserTx(ctx context.Context, tx *sql.Tx, userID string, event SpaceEvent, permissionCache map[string]bool) (bool, error) {
	permission := ""
	switch {
	case strings.HasPrefix(event.EventType, "message."):
		var payload struct {
			ConversationID string `json:"conversation_id"`
		}
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return false, err
		}
		if payload.ConversationID != "" {
			var member bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(
				SELECT 1 FROM space_conversation_members cm
				JOIN space_conversations c ON c.id=cm.conversation_id
				WHERE cm.conversation_id=$1 AND cm.user_id=$2 AND c.space_id=$3
			)`, payload.ConversationID, userID, event.SpaceID).Scan(&member); err != nil {
				return false, err
			}
			if !member {
				return false, nil
			}
		}
		permission = PermissionMessagesRead
	case strings.HasPrefix(event.EventType, "node."):
		permission = PermissionMessagesRead
	case strings.HasPrefix(event.EventType, "library."):
		permission = PermissionLibraryView
	case strings.HasPrefix(event.EventType, "agent.run."), strings.HasPrefix(event.EventType, "workflow.run."):
		run := &SpaceRun{}
		if err := scanSpaceRun(tx.QueryRowContext(ctx, `SELECT `+spaceRunColumns+` FROM space_runs WHERE id=$1`, event.EntityID), run); errors.Is(err, sql.ErrNoRows) {
			// Retain requester-only visibility for legacy run events that predate
			// canonical space_runs rows. Never expose another member's orphaned
			// event through Studio visibility alone.
			if event.ActorUserID != userID {
				return false, nil
			}
			permission = PermissionAgentsRun
		} else if err != nil {
			return false, err
		} else {
			visible, err := sharedSpaceRunVisibleToUserTx(ctx, tx, run, userID)
			if err != nil || !visible {
				return false, err
			}
			if run.RequestingMemberID == userID {
				permission = PermissionAgentsRun
			} else {
				permission = PermissionStudioView
			}
		}
	case strings.HasPrefix(event.EventType, "agent."), strings.HasPrefix(event.EventType, "workflow."):
		permission = PermissionStudioView
	default:
		return true, nil
	}
	key := event.SpaceID + "\x00" + permission
	if allowed, ok := permissionCache[key]; ok {
		return allowed, nil
	}
	allowed, err := hasSpacePermissionTx(ctx, tx, userID, event.SpaceID, permission)
	if err != nil {
		return false, err
	}
	permissionCache[key] = allowed
	return allowed, nil
}

func (db *Database) CreateResolveTicket(ctx context.Context, userID, spaceID, nodeID, disposition, tokenHash string, expires time.Time) error {
	if disposition != "open" && disposition != "download" {
		return ErrSpaceInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		var ok bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_nodes WHERE id=$1 AND space_id=$2 AND kind='link')`, nodeID, spaceID).Scan(&ok); err != nil || !ok {
			return ErrSpaceNotFound
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO space_resolve_tickets(token_hash,user_id,space_id,node_id,disposition,expires_at) VALUES($1,$2,$3,$4,$5,$6)`, tokenHash, userID, spaceID, nodeID, disposition, expires)
		return err
	})
}

func (db *Database) ConsumeResolveTicket(ctx context.Context, tokenHash string) (string, string, string, error) {
	var userID, spaceID, nodeID string
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `UPDATE space_resolve_tickets SET consumed_at=NOW() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW()
			AND EXISTS(SELECT 1 FROM space_members m WHERE m.space_id=space_resolve_tickets.space_id AND m.user_id=space_resolve_tickets.user_id)
			RETURNING user_id,space_id,node_id`, tokenHash).Scan(&userID, &spaceID, &nodeID)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", "", ErrSpaceForbidden
	}
	return userID, spaceID, nodeID, err
}

func (db *Database) SpaceStudioResources(ctx context.Context, userID, spaceID, kind string) ([]SpaceStudioResource, error) {
	items := []SpaceStudioResource{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioView); err != nil {
			return err
		}
		if kind == "agent" {
			rows, err := tx.QueryContext(ctx, `SELECT id,space_id,creator_user_id,name,description,icon,instructions,enabled,status,runtime_kind,version,schedules_enabled,COALESCE(active_workflow_version_id,''),access_policy,created_at,updated_at FROM space_agents WHERE space_id=$1 ORDER BY updated_at DESC`, spaceID)
			if err != nil {
				return err
			}
			for rows.Next() {
				var item SpaceStudioResource
				item.Kind = "agent"
				if err := rows.Scan(&item.ID, &item.SpaceID, &item.CreatorUserID, &item.Name, &item.Description, &item.Icon, &item.Instructions, &item.Enabled, &item.Status, &item.RuntimeKind, &item.Version, &item.SchedulesEnabled, &item.ActiveWorkflowVersionID, &item.AccessPolicy, &item.CreatedAt, &item.UpdatedAt); err != nil {
					rows.Close()
					return err
				}
				items = append(items, item)
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return err
			}
			if err := rows.Close(); err != nil {
				return err
			}
			for index := range items {
				if items[index].ActiveWorkflowVersionID != "" {
					items[index].ActiveWorkflow, err = loadWorkflowVersionTx(ctx, tx, items[index].ActiveWorkflowVersionID)
					if err != nil {
						return err
					}
				}
			}
			return nil
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,creator_user_id,name,description,definition,enabled,version,schedules_enabled,stable_identifier,created_at,updated_at FROM space_workflows WHERE space_id=$1 ORDER BY updated_at DESC`, spaceID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var item SpaceStudioResource
			item.Kind = "workflow"
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.CreatorUserID, &item.Name, &item.Description, &item.Definition, &item.Enabled, &item.Version, &item.SchedulesEnabled, &item.StableIdentifier, &item.CreatedAt, &item.UpdatedAt); err != nil {
				rows.Close()
				return err
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for index := range items {
			workflow, workflowErr := loadLatestWorkflowVersionTx(ctx, tx, items[index].ID)
			if workflowErr == nil {
				items[index].ActiveWorkflow = workflow
			} else if !errors.Is(workflowErr, sql.ErrNoRows) {
				return workflowErr
			}
		}
		return nil
	})
	return items, err
}

func (db *Database) SpaceChatAgents(ctx context.Context, userID, spaceID string) ([]SpaceStudioResource, error) {
	items := []SpaceStudioResource{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		personalRows, err := tx.QueryContext(ctx, `SELECT `+personalAgentColumns+` FROM personal_agents a WHERE a.enabled AND a.deleted_at IS NULL AND (a.owner_user_id=$1 OR EXISTS(
			SELECT 1 FROM personal_agent_space_grants g WHERE g.agent_id=a.id AND g.space_id=$2 AND (g.all_members OR EXISTS(SELECT 1 FROM personal_agent_member_grants mg WHERE mg.grant_id=g.id AND mg.user_id=$1)))) ORDER BY lower(a.name),a.id`, userID, spaceID)
		if err != nil {
			return err
		}
		for personalRows.Next() {
			var personal PersonalAgent
			if err := scanPersonalAgent(personalRows, &personal); err != nil {
				personalRows.Close()
				return err
			}
			item := SpaceStudioResource{ID: personal.ID, SpaceID: spaceID, CreatorUserID: personal.OwnerUserID, Kind: "agent", Name: personal.Name, Description: personal.Description, Icon: personal.Icon, Enabled: personal.Enabled, Status: "available", RuntimeKind: "cloud", Version: personal.Version, CreatedAt: personal.CreatedAt, UpdatedAt: personal.UpdatedAt}
			// Model choice is private configuration. Shared members only need the
			// presentation data required by the mention picker.
			if personal.OwnerUserID == userID {
				item.ModelMode = personal.ModelMode
				item.ModelID = personal.ModelID
			}
			items = append(items, item)
		}
		if err := personalRows.Close(); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,creator_user_id,name,description,icon,enabled,status,runtime_kind,version,created_at,updated_at FROM space_agents legacy WHERE space_id=$1 AND enabled AND (creator_user_id=$2 OR access_policy->>'mode'='space' OR access_policy->'allowedUserIds' ? $2) AND NOT EXISTS(SELECT 1 FROM personal_agents p WHERE p.source_space_agent_id=legacy.id AND p.deleted_at IS NULL) ORDER BY name,id`, spaceID, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceStudioResource
			item.Kind = "agent"
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.CreatorUserID, &item.Name, &item.Description, &item.Icon, &item.Enabled, &item.Status, &item.RuntimeKind, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) SaveSpaceStudioResource(ctx context.Context, userID string, item SpaceStudioResource) (*SpaceStudioResource, error) {
	item.Name = strings.TrimSpace(item.Name)
	if item.Version == 0 {
		item.ID = item.Kind + "_" + uuid.NewString()
	} else if item.ID == "" {
		item.ID = item.Kind + "_" + uuid.NewString()
	}
	if len([]rune(item.Name)) < 1 || len([]rune(item.Name)) > 80 || (item.Kind != "agent" && item.Kind != "workflow") {
		return nil, ErrSpaceInvalid
	}
	if len(item.Definition) == 0 {
		item.Definition = json.RawMessage(`{}`)
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, item.SpaceID, PermissionStudioManage); err != nil {
			return err
		}
		if item.Kind == "agent" {
			if len(item.AccessPolicy) == 0 {
				item.AccessPolicy = json.RawMessage(`{"mode":"space","allowedUserIds":[]}`)
			}
			var access workflowv2.AgentAccessPolicy
			if json.Unmarshal(item.AccessPolicy, &access) != nil || !validAgentAccess(access) {
				return ErrSpaceInvalid
			}
			if item.Icon == "" {
				item.Icon = "bot"
			}
			if item.Status == "" {
				item.Status = "draft"
			}
			if item.RuntimeKind == "" {
				item.RuntimeKind = "cloud"
			}
			if item.Version == 0 {
				item.CreatorUserID = userID
				return tx.QueryRowContext(ctx, `INSERT INTO space_agents(id,space_id,creator_user_id,name,description,icon,instructions,enabled,status,runtime_kind,schedules_enabled,active_workflow_version_id,access_policy,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$3) RETURNING version,created_at,updated_at`, item.ID, item.SpaceID, userID, item.Name, item.Description, item.Icon, item.Instructions, item.Enabled, item.Status, item.RuntimeKind, item.SchedulesEnabled, item.AccessPolicy).Scan(&item.Version, &item.CreatedAt, &item.UpdatedAt)
			}
			var creatorID string
			if err := tx.QueryRowContext(ctx, `SELECT creator_user_id FROM space_agents WHERE id=$1 AND space_id=$2`, item.ID, item.SpaceID).Scan(&creatorID); err != nil {
				return err
			}
			if creatorID != userID {
				return ErrSpaceForbidden
			}
			result, err := tx.ExecContext(ctx, `UPDATE space_agents SET name=$1,description=$2,icon=$3,instructions=$4,enabled=$5,status=$6,schedules_enabled=$7,access_policy=$8,updated_by_user_id=$9,version=version+1,updated_at=NOW() WHERE id=$10 AND space_id=$11 AND version=$12`, item.Name, item.Description, item.Icon, item.Instructions, item.Enabled, item.Status, item.SchedulesEnabled, item.AccessPolicy, userID, item.ID, item.SpaceID, item.Version)
			if err != nil {
				return err
			}
			if n, _ := result.RowsAffected(); n == 0 {
				return ErrSpaceConflict
			}
			item.Version++
			return tx.QueryRowContext(ctx, `SELECT creator_user_id,runtime_kind,COALESCE(active_workflow_version_id,''),access_policy,created_at,updated_at FROM space_agents WHERE id=$1`, item.ID).Scan(&item.CreatorUserID, &item.RuntimeKind, &item.ActiveWorkflowVersionID, &item.AccessPolicy, &item.CreatedAt, &item.UpdatedAt)
		}
		if validateWorkflowV2Tx(ctx, tx, item.SpaceID, item.Definition) != nil {
			return ErrSpaceInvalid
		}
		if item.Version == 0 {
			item.CreatorUserID = userID
			item.StableIdentifier = "space." + item.SpaceID + ".workflow." + item.ID
			if err := tx.QueryRowContext(ctx, `INSERT INTO space_workflows(id,space_id,creator_user_id,name,description,definition,enabled,schedules_enabled,stable_identifier,author_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Misty member') RETURNING version,created_at,updated_at`, item.ID, item.SpaceID, userID, item.Name, item.Description, item.Definition, item.Enabled, item.SchedulesEnabled, item.StableIdentifier).Scan(&item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
				return err
			}
			return nil
		}
		var creatorID string
		if err := tx.QueryRowContext(ctx, `SELECT creator_user_id FROM space_workflows WHERE id=$1 AND space_id=$2`, item.ID, item.SpaceID).Scan(&creatorID); err != nil {
			return err
		}
		if creatorID != userID {
			return ErrSpaceForbidden
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_workflows SET name=$1,description=$2,definition=$3,enabled=$4,schedules_enabled=$5,version=version+1,updated_at=NOW() WHERE id=$6 AND space_id=$7 AND version=$8`, item.Name, item.Description, item.Definition, item.Enabled, item.SchedulesEnabled, item.ID, item.SpaceID, item.Version)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			return ErrSpaceConflict
		}
		item.Version++
		if err := tx.QueryRowContext(ctx, `SELECT creator_user_id,stable_identifier,created_at,updated_at FROM space_workflows WHERE id=$1`, item.ID).Scan(&item.CreatorUserID, &item.StableIdentifier, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = db.spaceTx(ctx, func(tx *sql.Tx) error {
		_, e := recordSpaceEventTx(ctx, tx, item.SpaceID, userID, item.Kind+".updated", item.ID, item)
		return e
	})
	if item.Kind == "agent" && item.ActiveWorkflowVersionID != "" {
		item.ActiveWorkflow, _ = db.WorkflowVersion(ctx, userID, item.SpaceID, item.ActiveWorkflowVersionID)
	}
	return &item, nil
}

func (db *Database) SpaceStudioResourceByID(ctx context.Context, userID, spaceID, kind, id string) (*SpaceStudioResource, error) {
	out := &SpaceStudioResource{Kind: kind}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioView); err != nil {
			return err
		}
		if kind == "agent" {
			if err := tx.QueryRowContext(ctx, `SELECT id,space_id,creator_user_id,name,description,icon,instructions,enabled,status,runtime_kind,version,schedules_enabled,COALESCE(active_workflow_version_id,''),access_policy,created_at,updated_at FROM space_agents WHERE id=$1 AND space_id=$2`, id, spaceID).Scan(&out.ID, &out.SpaceID, &out.CreatorUserID, &out.Name, &out.Description, &out.Icon, &out.Instructions, &out.Enabled, &out.Status, &out.RuntimeKind, &out.Version, &out.SchedulesEnabled, &out.ActiveWorkflowVersionID, &out.AccessPolicy, &out.CreatedAt, &out.UpdatedAt); err != nil {
				return err
			}
			if out.ActiveWorkflowVersionID != "" {
				workflow, err := loadWorkflowVersionTx(ctx, tx, out.ActiveWorkflowVersionID)
				out.ActiveWorkflow = workflow
				return err
			}
			return nil
		}
		if kind != "workflow" {
			return ErrSpaceInvalid
		}
		if err := tx.QueryRowContext(ctx, `SELECT id,space_id,creator_user_id,name,description,definition,enabled,version,schedules_enabled,stable_identifier,created_at,updated_at FROM space_workflows WHERE id=$1 AND space_id=$2`, id, spaceID).Scan(&out.ID, &out.SpaceID, &out.CreatorUserID, &out.Name, &out.Description, &out.Definition, &out.Enabled, &out.Version, &out.SchedulesEnabled, &out.StableIdentifier, &out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		workflow, err := loadLatestWorkflowVersionTx(ctx, tx, out.ID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		out.ActiveWorkflow = workflow
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) CreateSpaceRun(ctx context.Context, userID, spaceID, kind, resourceID, triggerKind, capabilityID string, input json.RawMessage) (*SpaceRun, error) {
	if kind == "agent" {
		sourceType := "direct"
		if triggerKind == "mention" {
			sourceType = "group_mention"
		}
		if triggerKind == "schedule" {
			sourceType = "schedule"
		}
		if triggerKind == "test" {
			sourceType = "studio_test"
		}
		return db.CreateAgentRun(ctx, AgentRunRequest{RequestingMemberID: userID, SpaceID: spaceID, AgentID: resourceID, SourceType: sourceType, CapabilityID: capabilityID, Input: input, TriggerKind: triggerKind})
	}
	// Workflows are immutable plans attached to an Agent. They never execute as
	// standalone principals, including Studio tests.
	return nil, ErrSpaceInvalid
}

func (db *Database) FinishSpaceRun(ctx context.Context, runID, state string, result json.RawMessage, errorCode string) (*SpaceRun, error) {
	if state != "completed" && state != "completed_with_errors" && state != "failed" && state != "canceled" && state != "rejected" {
		return nil, ErrSpaceInvalid
	}
	if len(result) == 0 {
		result = json.RawMessage(`{}`)
	}
	out := &SpaceRun{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		progress := 0
		if state == "completed" || state == "completed_with_errors" {
			progress = 100
		}
		if err := scanSpaceRun(tx.QueryRowContext(ctx, `UPDATE space_runs SET state=$1,result=$2,outputs=$2,error_code=NULLIF($3,''),error_message=CASE WHEN $1='failed' THEN COALESCE(($2::jsonb)->>'message','Execution failed') ELSE NULL END,progress=$4,completed_at=NOW(),updated_at=NOW()
			WHERE id=$5 AND state IN ('queued','running','cooldown') RETURNING `+spaceRunColumns, state, result, errorCode, progress, runID), out); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		} else if err != nil {
			return err
		}
		eventID, err := recordSpaceEventTx(ctx, tx, out.SpaceID, out.InitiatedByUserID, out.ResourceKind+".run."+state, out.ID, out)
		if err != nil {
			return err
		}
		if out.SourceType == "schedule" || out.TriggerKind != "manual" && out.TriggerKind != "mika" && out.TriggerKind != "mention" {
			payload := mustJSON(map[string]any{"run_id": out.ID, "agent_id": out.AgentID, "state": out.State, "outputs": out.Outputs, "error_code": out.ErrorCode})
			_, err = tx.ExecContext(ctx, `INSERT INTO space_inbox_items(user_id,space_id,kind,event_id,payload) VALUES($1,$2,'workflow',$3,$4)`, out.RequestingMemberID, out.SpaceID, eventID, payload)
		}
		return err
	})
	return out, err
}

func (db *Database) DeleteSpaceStudioResource(ctx context.Context, userID, spaceID, kind, id string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioManage); err != nil {
			return err
		}
		table := "space_agents"
		if kind == "workflow" {
			table = "space_workflows"
		} else if kind != "agent" {
			return ErrSpaceInvalid
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_run_approvals SET state='canceled',decided_by_user_id=$1,decided_at=NOW() WHERE state='pending' AND run_id IN (SELECT id FROM space_runs WHERE space_id=$2 AND resource_kind=$3 AND resource_id=$4 AND state IN ('queued','running','awaiting_approval','cooldown'))`, userID, spaceID, kind, id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_runs SET state='canceled',canceled_at=NOW(),completed_at=NOW(),updated_at=NOW() WHERE space_id=$1 AND resource_kind=$2 AND resource_id=$3 AND state IN ('queued','running','awaiting_approval','cooldown')`, spaceID, kind, id); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE id=$1 AND space_id=$2 AND creator_user_id=$3`, id, spaceID, userID)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			return ErrSpaceNotFound
		}
		_, err = recordSpaceEventTx(ctx, tx, spaceID, userID, kind+".deleted", id, map[string]any{})
		return err
	})
}

func (db *Database) SpaceAgentPrompt(ctx context.Context, userID, spaceID, agentID string) (string, string, error) {
	var name, instructions string
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT name,instructions FROM space_agents WHERE id=$1 AND space_id=$2 AND enabled`, agentID, spaceID).Scan(&name, &instructions)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrSpaceNotFound
	}
	return name, instructions, err
}

func (db *Database) PurgeExpiredSpaceData(ctx context.Context) (int64, error) {
	var purged int64
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		for _, query := range []string{
			`DELETE FROM space_messages WHERE expires_at<=NOW()`,
			`DELETE FROM space_invitations WHERE expires_at<=NOW()`,
			`DELETE FROM realtime_tickets WHERE expires_at<=NOW() OR consumed_at IS NOT NULL`,
			`DELETE FROM space_resolve_tickets WHERE expires_at<=NOW() OR consumed_at IS NOT NULL`,
			`DELETE FROM space_events WHERE created_at<=NOW()-INTERVAL '7 days'`,
		} {
			result, err := tx.ExecContext(ctx, query)
			if err != nil {
				return err
			}
			n, _ := result.RowsAffected()
			purged += n
		}
		return nil
	})
	return purged, err
}

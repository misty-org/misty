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
)

const (
	MaxOwnedSpacesPerUser = 3
	MaxSpacesPerUser      = 5
	MaxSpacePeople        = 5
	MaxSpaceNodes         = 5000
	MaxMessageChars       = 4000
	MaxMessageFiles       = 5
	MaxSpaceStorageBytes  = int64(1_000_000_000)
)

var (
	ErrSpaceNotFound       = errors.New("space not found")
	ErrSpaceForbidden      = errors.New("space permission denied")
	ErrSpaceLimit          = errors.New("space limit reached")
	ErrSpaceOwnershipLimit = errors.New("space ownership limit reached")
	ErrSpacePeopleLimit    = errors.New("space member limit reached")
	ErrSpaceNodeLimit      = errors.New("space node limit reached")
	ErrSpaceConflict       = errors.New("space resource version conflict")
	ErrSpaceInviteNotFound = errors.New("space invitation not found")
	ErrSpaceInviteExpired  = errors.New("space invitation expired")
	ErrSpaceInvalid        = errors.New("invalid space data")
)

type Space struct {
	ID               string    `json:"id"`
	SecurityDomainID string    `json:"security_domain_id"`
	OwnerUserID      string    `json:"owner_user_id"`
	Name             string    `json:"name"`
	Role             string    `json:"role"`
	MemberCount      int       `json:"member_count"`
	PendingCount     int       `json:"pending_count"`
	IsPersonal       bool      `json:"is_personal"`
	IsShared         bool      `json:"is_shared"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
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
	Seq              int64               `json:"seq"`
	ID               string              `json:"id"`
	SpaceID          string              `json:"space_id"`
	SenderUserID     string              `json:"sender_user_id"`
	SenderName       string              `json:"sender_name"`
	SenderKind       string              `json:"sender_kind"`
	SenderAgentID    string              `json:"sender_agent_id,omitempty"`
	Content          []MessageSpan       `json:"content"`
	FileNodeIDs      []string            `json:"file_node_ids"`
	LibraryItemIDs   []string            `json:"library_item_ids"`
	Attachments      []MessageAttachment `json:"attachments"`
	ReplyToMessageID string              `json:"reply_to_message_id,omitempty"`
	EditedAt         *time.Time          `json:"edited_at,omitempty"`
	CreatedAt        time.Time           `json:"created_at"`
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
		var owned int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM spaces WHERE owner_user_id=$1`, userID).Scan(&owned); err != nil {
			return err
		}
		if owned >= MaxOwnedSpacesPerUser {
			return ErrSpaceOwnershipLimit
		}
		var memberships int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM space_members m JOIN spaces s ON s.id=m.space_id
			WHERE m.user_id=$1 AND NOT (s.is_personal AND s.owner_user_id=$1)`, userID).Scan(&memberships); err != nil {
			return err
		}
		if memberships >= MaxSpacesPerUser {
			return ErrSpaceOwnershipLimit
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO security_domains(id,kind,owner_user_id,space_id) VALUES($1,'space',$2,$3)`, out.SecurityDomainID, userID, out.ID); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO spaces(id,owner_user_id,name,security_domain_id) VALUES($1,$2,$3,$4) RETURNING created_at,updated_at`, out.ID, userID, name, out.SecurityDomainID).Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner')`, out.ID, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_roles(id,space_id,name,is_everyone,permissions) VALUES($1,$2,'@everyone',TRUE,'["space.view","messages.read","library.view","library.download","storage.view_own_usage","studio.view","studio.manage","agents.run"]'::jsonb)`, "role_"+uuid.NewString(), out.ID); err != nil {
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
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner')`, spaceID, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_roles(id,space_id,name,is_everyone,permissions) VALUES($1,$2,'@everyone',TRUE,'["space.view","messages.read","library.view","library.download","storage.view_own_usage","studio.view","studio.manage","agents.run"]'::jsonb)`, "role_"+uuid.NewString(), spaceID); err != nil {
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
		defer rows.Close()
		for rows.Next() {
			var space Space
			if err := rows.Scan(&space.ID, &space.SecurityDomainID, &space.OwnerUserID, &space.Name, &space.Role, &space.MemberCount, &space.PendingCount, &space.IsPersonal, &space.IsShared, &space.CreatedAt, &space.UpdatedAt); err != nil {
				return err
			}
			spaces = append(spaces, space)
		}
		return rows.Err()
	})
	return spaces, err
}

func (db *Database) SpaceByID(ctx context.Context, userID, spaceID string) (*Space, error) {
	out := &Space{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT s.id,s.security_domain_id,s.owner_user_id,s.name,m.role,
			(SELECT count(*) FROM space_members sm WHERE sm.space_id=s.id),
			(SELECT count(*) FROM space_invitations si WHERE si.space_id=s.id AND si.expires_at>NOW()),
			s.is_personal,
			(EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=s.id AND sm.role='member') OR
			 EXISTS(SELECT 1 FROM space_invitations si WHERE si.space_id=s.id AND si.expires_at>NOW())),
			s.created_at,s.updated_at
			FROM spaces s JOIN space_members m ON m.space_id=s.id
			WHERE s.id=$1 AND m.user_id=$2 AND s.lifecycle_state='active'`, spaceID, userID).Scan(&out.ID, &out.SecurityDomainID, &out.OwnerUserID, &out.Name, &out.Role, &out.MemberCount, &out.PendingCount, &out.IsPersonal, &out.IsShared, &out.CreatedAt, &out.UpdatedAt)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
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
		var anotherOwnedSpaceShared bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(
			SELECT 1 FROM spaces s WHERE s.owner_user_id=$1 AND s.id<>$2 AND (
				EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=s.id AND sm.role='member') OR
				EXISTS(SELECT 1 FROM space_invitations si WHERE si.space_id=s.id AND si.expires_at>NOW())
			))`, ownerID, spaceID).Scan(&anotherOwnedSpaceShared); err != nil {
			return err
		}
		if anotherOwnedSpaceShared {
			return ErrSpaceLimit
		}
		if err := tx.QueryRowContext(ctx, `SELECT id,name,email FROM users WHERE lower(email)=$1`, email).Scan(&out.InvitedUserID, &out.InvitedUserName, &out.InvitedEmail); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceInviteNotFound
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
		var people, memberships int
		if err := tx.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM space_members WHERE space_id=$1)+(SELECT count(*) FROM space_invitations WHERE space_id=$1 AND expires_at>NOW())`, spaceID).Scan(&people); err != nil {
			return err
		}
		if people >= MaxSpacePeople {
			return ErrSpacePeopleLimit
		}
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM space_members m JOIN spaces s ON s.id=m.space_id
			WHERE m.user_id=$1 AND NOT (s.is_personal AND s.owner_user_id=$1)`, out.InvitedUserID).Scan(&memberships); err != nil {
			return err
		}
		if memberships >= MaxSpacesPerUser {
			return ErrSpaceLimit
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
		var memberships, people int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM space_members m JOIN spaces s ON s.id=m.space_id
			WHERE m.user_id=$1 AND NOT (s.is_personal AND s.owner_user_id=$1)`, userID).Scan(&memberships); err != nil {
			return err
		}
		if memberships >= MaxSpacesPerUser {
			return ErrSpaceLimit
		}
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM space_members WHERE space_id=$1`, spaceID).Scan(&people); err != nil {
			return err
		}
		if people >= MaxSpacePeople {
			return ErrSpacePeopleLimit
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
		var owns int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM spaces WHERE owner_user_id=$1`, memberID).Scan(&owns); err != nil {
			return err
		}
		if owns >= MaxOwnedSpacesPerUser {
			return ErrSpaceOwnershipLimit
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
		_, err := recordSpaceEventTx(ctx, tx, spaceID, ownerID, "owner.transferred", memberID, map[string]any{})
		return err
	})
}

func validateMessage(content []MessageSpan, fileNodeIDs []string) error {
	return validateMessageWithReferences(content, len(fileNodeIDs))
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
	if err := validateMessageWithReferences(content, len(fileNodeIDs)+len(attachmentIDs)+len(libraryItemIDs)); err != nil {
		return nil, nil, err
	}
	out := &SpaceMessage{ID: "msg_" + uuid.NewString(), SpaceID: spaceID, SenderUserID: userID, SenderKind: "person", Content: content, FileNodeIDs: fileNodeIDs, LibraryItemIDs: uniqueSpaceIDs(libraryItemIDs), Attachments: []MessageAttachment{}, ReplyToMessageID: replyToMessageID}
	attachmentIDs = uniqueSpaceIDs(attachmentIDs)
	agentMentions := []string{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		for _, nodeID := range fileNodeIDs {
			var ok bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_nodes WHERE id=$1 AND space_id=$2 AND kind='link')`, nodeID, spaceID).Scan(&ok); err != nil || !ok {
				return ErrSpaceInvalid
			}
		}
		if replyToMessageID != "" {
			var exists bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_messages WHERE id=$1 AND space_id=$2)`, replyToMessageID, spaceID).Scan(&exists); err != nil || !exists {
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
				if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2)`, spaceID, span.UserID).Scan(&ok); err != nil || !ok {
					return ErrSpaceInvalid
				}
				mentionUsers[span.UserID] = true
			}
			if span.AgentID != "" {
				var ok bool
				if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_agents WHERE space_id=$1 AND id=$2 AND enabled)`, spaceID, span.AgentID).Scan(&ok); err != nil || !ok {
					return ErrSpaceInvalid
				}
				agentMentions = append(agentMentions, span.AgentID)
			}
		}
		raw, _ := json.Marshal(content)
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_messages(id,space_id,sender_user_id,content,file_node_ids,reply_to_message_id)
			VALUES($1,$2,$3,$4,$5,NULLIF($6,'')) RETURNING seq,created_at`, out.ID, spaceID, userID, raw, pqStringArray(fileNodeIDs), replyToMessageID).Scan(&out.Seq, &out.CreatedAt); err != nil {
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
		if err := tx.QueryRowContext(ctx, `SELECT name FROM users WHERE id=$1`, userID).Scan(&out.SenderName); err != nil {
			return err
		}
		eventID, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "message.created", out.ID, out)
		if err != nil {
			return err
		}
		inboxPayload, _ := json.Marshal(map[string]any{"sender_name": out.SenderName, "preview": messagePreview(content)})
		rows, err := tx.QueryContext(ctx, `SELECT user_id FROM space_members WHERE space_id=$1 AND user_id<>$2`, spaceID, userID)
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
	if err := scanner.Scan(&out.Seq, &out.ID, &out.SpaceID, &out.SenderUserID, &out.SenderName, &out.SenderKind, &agentID, &raw, &files, &out.EditedAt, &out.CreatedAt, &out.ReplyToMessageID); err != nil {
		return err
	}
	out.SenderAgentID = agentID.String
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

const spaceMessageColumns = `m.seq,m.id,m.space_id,m.sender_user_id,CASE WHEN m.sender_kind='agent' THEN COALESCE(a.name,'Misty Agent') ELSE COALESCE(u.name,'Misty') END,m.sender_kind,m.sender_agent_id,m.content,m.file_node_ids::text,m.edited_at,m.created_at,COALESCE(m.reply_to_message_id,'')`

func (db *Database) SpaceMessages(ctx context.Context, userID, spaceID string, before int64, limit int) ([]SpaceMessage, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	items := []SpaceMessage{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceMessageColumns+` FROM space_messages m
			LEFT JOIN users u ON u.id=m.sender_user_id LEFT JOIN space_agents a ON a.id=m.sender_agent_id
			WHERE m.space_id=$1 AND ($2=0 OR m.seq<$2) ORDER BY m.seq DESC LIMIT $3`, spaceID, before, limit)
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
	if err := validateMessage(content, fileNodeIDs); err != nil {
		return nil, err
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		var sender string
		if err := tx.QueryRowContext(ctx, `SELECT sender_user_id FROM space_messages WHERE id=$1 AND space_id=$2 FOR UPDATE`, messageID, spaceID).Scan(&sender); errors.Is(err, sql.ErrNoRows) {
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
				if _, err := tx.ExecContext(ctx, `INSERT INTO space_inbox_items(user_id,space_id,kind,message_id,payload) SELECT $1,$2,'mention',$3,'{}'::jsonb WHERE EXISTS(SELECT 1 FROM space_members WHERE space_id=$2 AND user_id=$1)`, span.UserID, spaceID, messageID); err != nil {
					return err
				}
			}
		}
		_, eventErr := recordSpaceEventTx(ctx, tx, spaceID, userID, "message.updated", messageID, map[string]any{})
		return eventErr
	})
	if err != nil {
		return nil, err
	}
	out := &SpaceMessage{}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		if err := scanSpaceMessage(tx.QueryRowContext(ctx, `SELECT `+spaceMessageColumns+` FROM space_messages m LEFT JOIN users u ON u.id=m.sender_user_id LEFT JOIN space_agents a ON a.id=m.sender_agent_id WHERE m.id=$1 AND m.space_id=$2`, messageID, spaceID), out); err != nil {
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
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		role, err := requireSpaceMemberTx(ctx, tx, spaceID, userID)
		if err != nil {
			return err
		}
		var sender string
		if err := tx.QueryRowContext(ctx, `SELECT sender_user_id FROM space_messages WHERE id=$1 AND space_id=$2 FOR UPDATE`, messageID, spaceID).Scan(&sender); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		} else if err != nil {
			return err
		}
		if sender != userID && role != "owner" {
			return ErrSpaceForbidden
		}
		if _, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "message.deleted", messageID, map[string]any{}); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM space_messages WHERE id=$1`, messageID)
		return err
	})
}

func (db *Database) CreateSpaceAgentMessage(ctx context.Context, billingUserID, spaceID, agentID, text string) (*SpaceMessage, error) {
	content := []MessageSpan{{Type: "text", Text: strings.TrimSpace(text)}}
	if err := validateMessage(content, nil); err != nil {
		return nil, err
	}
	out := &SpaceMessage{ID: "msg_" + uuid.NewString(), SpaceID: spaceID, SenderUserID: billingUserID, SenderKind: "agent", SenderAgentID: agentID, Content: content, FileNodeIDs: []string{}, LibraryItemIDs: []string{}, Attachments: []MessageAttachment{}}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, billingUserID); err != nil {
			return err
		}
		raw, _ := json.Marshal(content)
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_messages(id,space_id,sender_user_id,sender_kind,sender_agent_id,content)
			VALUES($1,$2,$3,'agent',$4,$5) RETURNING seq,created_at`, out.ID, spaceID, billingUserID, agentID, raw).Scan(&out.Seq, &out.CreatedAt); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT name FROM space_agents WHERE id=$1 AND space_id=$2`, agentID, spaceID).Scan(&out.SenderName); err != nil {
			return err
		}
		eventID, err := recordSpaceEventTx(ctx, tx, spaceID, billingUserID, "message.created", out.ID, out)
		if err != nil {
			return err
		}
		inboxPayload, _ := json.Marshal(map[string]any{"sender_name": out.SenderName, "preview": messagePreview(content)})
		rows, err := tx.QueryContext(ctx, `SELECT user_id FROM space_members WHERE space_id=$1`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var memberID string
			if err := rows.Scan(&memberID); err != nil {
				return err
			}
			kind := "unread"
			if memberID == billingUserID {
				kind = "agent"
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO space_inbox_items(user_id,space_id,kind,message_id,event_id,payload) VALUES($1,$2,$3,$4,$5,$6)`, memberID, spaceID, kind, out.ID, eventID, inboxPayload); err != nil {
				return err
			}
		}
		return rows.Err()
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
		if _, err := requireSpaceMemberTx(ctx, tx, node.SpaceID, userID); err != nil {
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
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
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
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT id,space_id,COALESCE(parent_id,''),kind,display_name,uploader_user_id,mime_type,size_bytes,stale,metadata,created_at,updated_at,target_ciphertext,target_nonce,COALESCE(target_key_version,0)
			FROM space_nodes WHERE id=$1 AND space_id=$2`, nodeID, spaceID).Scan(&out.ID, &out.SpaceID, &out.ParentID, &out.Kind, &out.DisplayName, &out.UploaderUserID, &out.MIMEType, &out.SizeBytes, &out.Stale, &out.Metadata, &out.CreatedAt, &out.UpdatedAt, &out.TargetCipher, &out.TargetNonce, &out.KeyVersion)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) DeleteSpaceNode(ctx context.Context, userID, spaceID, nodeID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
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
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
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
			FROM space_inbox_items i JOIN spaces s ON s.id=i.space_id WHERE i.user_id=$1 AND `+where+` ORDER BY i.id DESC LIMIT $2`, userID, limit)
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
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
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
		rows, err := tx.QueryContext(ctx, `SELECT e.id,e.space_id,e.event_type,COALESCE(e.actor_user_id,''),COALESCE(e.entity_id,''),e.payload,e.created_at
			FROM space_events e JOIN space_members m ON m.space_id=e.space_id
			WHERE m.user_id=$1 AND e.id>$2 AND e.created_at>NOW()-INTERVAL '7 days' ORDER BY e.id LIMIT $3`, userID, after, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var event SpaceEvent
			if err := rows.Scan(&event.ID, &event.SpaceID, &event.EventType, &event.ActorUserID, &event.EntityID, &event.Payload, &event.CreatedAt); err != nil {
				return err
			}
			events = append(events, event)
		}
		return rows.Err()
	})
	return events, resync, err
}

func (db *Database) EventByIDForUser(ctx context.Context, userID string, eventID int64) (*SpaceEvent, error) {
	out := &SpaceEvent{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT e.id,e.space_id,e.event_type,COALESCE(e.actor_user_id,''),COALESCE(e.entity_id,''),e.payload,e.created_at
			FROM space_events e JOIN space_members m ON m.space_id=e.space_id WHERE e.id=$1 AND m.user_id=$2`, eventID, userID).Scan(&out.ID, &out.SpaceID, &out.EventType, &out.ActorUserID, &out.EntityID, &out.Payload, &out.CreatedAt)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) CreateResolveTicket(ctx context.Context, userID, spaceID, nodeID, disposition, tokenHash string, expires time.Time) error {
	if disposition != "open" && disposition != "download" {
		return ErrSpaceInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
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
			rows, err := tx.QueryContext(ctx, `SELECT id,space_id,creator_user_id,name,description,icon,instructions,enabled,status,runtime_kind,version,schedules_enabled,active_workflow_version_id,created_at,updated_at FROM space_agents WHERE space_id=$1 ORDER BY updated_at DESC`, spaceID)
			if err != nil {
				return err
			}
			for rows.Next() {
				var item SpaceStudioResource
				item.Kind = "agent"
				if err := rows.Scan(&item.ID, &item.SpaceID, &item.CreatorUserID, &item.Name, &item.Description, &item.Icon, &item.Instructions, &item.Enabled, &item.Status, &item.RuntimeKind, &item.Version, &item.SchedulesEnabled, &item.ActiveWorkflowVersionID, &item.CreatedAt, &item.UpdatedAt); err != nil {
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
				items[index].ActiveWorkflow, err = loadWorkflowVersionTx(ctx, tx, items[index].ActiveWorkflowVersionID)
				if err != nil {
					return err
				}
			}
			return nil
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,creator_user_id,name,description,definition,enabled,version,schedules_enabled,stable_identifier,created_at,updated_at FROM space_workflows WHERE space_id=$1 ORDER BY updated_at DESC`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceStudioResource
			item.Kind = "workflow"
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.CreatorUserID, &item.Name, &item.Description, &item.Definition, &item.Enabled, &item.Version, &item.SchedulesEnabled, &item.StableIdentifier, &item.CreatedAt, &item.UpdatedAt); err != nil {
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
				if err := createDefaultAgentWorkflowTx(ctx, tx, userID, &item); err != nil {
					return err
				}
				return tx.QueryRowContext(ctx, `INSERT INTO space_agents(id,space_id,creator_user_id,name,description,icon,instructions,enabled,status,runtime_kind,schedules_enabled,active_workflow_version_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$3) RETURNING version,created_at,updated_at`, item.ID, item.SpaceID, userID, item.Name, item.Description, item.Icon, item.Instructions, item.Enabled, item.Status, item.RuntimeKind, item.SchedulesEnabled, item.ActiveWorkflowVersionID).Scan(&item.Version, &item.CreatedAt, &item.UpdatedAt)
			}
			result, err := tx.ExecContext(ctx, `UPDATE space_agents SET name=$1,description=$2,icon=$3,instructions=$4,enabled=$5,status=$6,schedules_enabled=$7,updated_by_user_id=$8,version=version+1,updated_at=NOW() WHERE id=$9 AND space_id=$10 AND version=$11`, item.Name, item.Description, item.Icon, item.Instructions, item.Enabled, item.Status, item.SchedulesEnabled, userID, item.ID, item.SpaceID, item.Version)
			if err != nil {
				return err
			}
			if n, _ := result.RowsAffected(); n == 0 {
				return ErrSpaceConflict
			}
			item.Version++
			return tx.QueryRowContext(ctx, `SELECT creator_user_id,runtime_kind,active_workflow_version_id,created_at,updated_at FROM space_agents WHERE id=$1`, item.ID).Scan(&item.CreatorUserID, &item.RuntimeKind, &item.ActiveWorkflowVersionID, &item.CreatedAt, &item.UpdatedAt)
		}
		if err := validateCloudWorkflow(item.Definition); err != nil {
			return err
		}
		if item.Version == 0 {
			item.CreatorUserID = userID
			item.StableIdentifier = "space." + item.SpaceID + ".workflow." + item.ID
			if err := tx.QueryRowContext(ctx, `INSERT INTO space_workflows(id,space_id,creator_user_id,name,description,definition,enabled,schedules_enabled,stable_identifier,author_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Misty member') RETURNING version,created_at,updated_at`, item.ID, item.SpaceID, userID, item.Name, item.Description, item.Definition, item.Enabled, item.SchedulesEnabled, item.StableIdentifier).Scan(&item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
				return err
			}
			_, err := snapshotWorkflowTx(ctx, tx, userID, &item)
			return err
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
		_, err = snapshotWorkflowTx(ctx, tx, userID, &item)
		return err
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

func validateCloudWorkflow(raw json.RawMessage) error {
	var definition struct {
		Nodes []struct {
			Type string `json:"type"`
			Kind string `json:"kind"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(raw, &definition); err != nil {
		return ErrSpaceInvalid
	}
	blocked := map[string]bool{
		"select_path": true, "list_folder": true, "read_file": true, "read_text": true, "read_metadata": true,
		"write_file": true, "write_text": true, "copy_file": true, "copy_path": true, "move_file": true,
		"move_path": true, "rename_file": true, "rename_path": true, "local_secret": true, "create_agent": true,
	}
	for _, node := range definition.Nodes {
		kind := node.Kind
		if kind == "" {
			kind = node.Type
		}
		if blocked[strings.ToLower(kind)] {
			return ErrSpaceInvalid
		}
	}
	return nil
}

func (db *Database) SpaceStudioResourceByID(ctx context.Context, userID, spaceID, kind, id string) (*SpaceStudioResource, error) {
	out := &SpaceStudioResource{Kind: kind}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioView); err != nil {
			return err
		}
		if kind == "agent" {
			if err := tx.QueryRowContext(ctx, `SELECT id,space_id,creator_user_id,name,description,icon,instructions,enabled,status,runtime_kind,version,schedules_enabled,active_workflow_version_id,created_at,updated_at FROM space_agents WHERE id=$1 AND space_id=$2`, id, spaceID).Scan(&out.ID, &out.SpaceID, &out.CreatorUserID, &out.Name, &out.Description, &out.Icon, &out.Instructions, &out.Enabled, &out.Status, &out.RuntimeKind, &out.Version, &out.SchedulesEnabled, &out.ActiveWorkflowVersionID, &out.CreatedAt, &out.UpdatedAt); err != nil {
				return err
			}
			workflow, err := loadWorkflowVersionTx(ctx, tx, out.ActiveWorkflowVersionID)
			out.ActiveWorkflow = workflow
			return err
		}
		if kind != "workflow" {
			return ErrSpaceInvalid
		}
		return tx.QueryRowContext(ctx, `SELECT id,space_id,creator_user_id,name,description,definition,enabled,version,schedules_enabled,stable_identifier,created_at,updated_at FROM space_workflows WHERE id=$1 AND space_id=$2`, id, spaceID).Scan(&out.ID, &out.SpaceID, &out.CreatorUserID, &out.Name, &out.Description, &out.Definition, &out.Enabled, &out.Version, &out.SchedulesEnabled, &out.StableIdentifier, &out.CreatedAt, &out.UpdatedAt)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) CreateSpaceRun(ctx context.Context, userID, spaceID, kind, resourceID, triggerKind string, input json.RawMessage) (*SpaceRun, error) {
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
		return db.CreateAgentRun(ctx, AgentRunRequest{RequestingMemberID: userID, SpaceID: spaceID, AgentID: resourceID, SourceType: sourceType, Input: input, TriggerKind: triggerKind})
	}
	if len(input) == 0 {
		input = json.RawMessage(`{}`)
	}
	out := &SpaceRun{ID: "run_" + uuid.NewString(), SpaceID: spaceID, ResourceKind: kind, ResourceID: resourceID, InitiatedByUserID: userID, BillingUserID: userID, TriggerKind: triggerKind, State: "running", Input: input, Result: json.RawMessage(`{}`), RequestingMemberID: userID, SourceType: "studio_test", Outputs: json.RawMessage(`{}`), Artifacts: json.RawMessage(`[]`)}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		if kind != "workflow" {
			return ErrSpaceInvalid
		}
		var creator, versionID string
		var enabled bool
		if err := tx.QueryRowContext(ctx, `SELECT w.creator_user_id,w.enabled,v.id FROM space_workflows w JOIN space_workflow_versions v ON v.workflow_id=w.id WHERE w.id=$1 AND w.space_id=$2 ORDER BY v.created_at DESC LIMIT 1`, resourceID, spaceID).Scan(&creator, &enabled, &versionID); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		} else if err != nil {
			return err
		}
		if !enabled {
			return ErrSpaceInvalid
		}
		if triggerKind == "schedule" {
			out.BillingUserID = creator
			out.SourceType = "schedule"
		}
		workflow, err := loadWorkflowVersionTx(ctx, tx, versionID)
		if err != nil {
			return err
		}
		capability, err := selectWorkflowCapability(workflow.Metadata, "")
		if err != nil {
			return err
		}
		if err := authorizeWorkflowRequirementsTx(ctx, tx, userID, spaceID, workflow.Metadata); err != nil {
			return err
		}
		out.WorkflowIdentifier, out.WorkflowVersionID, out.WorkflowVersion, out.CapabilityID = workflow.StableIdentifier, workflow.ID, workflow.Version, capability.ID
		if capability.Destructive || capability.ConfirmationRequired {
			out.State = "awaiting_approval"
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_runs(id,space_id,resource_kind,resource_id,initiated_by_user_id,billing_user_id,trigger_kind,state,input,requesting_member_id,source_type,workflow_identifier,workflow_version_id,workflow_version,capability_id,outputs,artifacts)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$5,$10,$11,$12,$13,$14,'{}'::jsonb,'[]'::jsonb) RETURNING created_at,updated_at`, out.ID, spaceID, kind, resourceID, userID, out.BillingUserID, triggerKind, out.State, input, out.SourceType, out.WorkflowIdentifier, out.WorkflowVersionID, out.WorkflowVersion, out.CapabilityID).Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		_, err = recordSpaceEventTx(ctx, tx, spaceID, userID, kind+".run.started", out.ID, out)
		return err
	})
	return out, err
}

func (db *Database) FinishSpaceRun(ctx context.Context, runID, state string, result json.RawMessage, errorCode string) (*SpaceRun, error) {
	if state != "completed" && state != "failed" && state != "canceled" {
		return nil, ErrSpaceInvalid
	}
	if len(result) == 0 {
		result = json.RawMessage(`{}`)
	}
	out := &SpaceRun{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		progress := 0
		if state == "completed" {
			progress = 100
		}
		if err := scanSpaceRun(tx.QueryRowContext(ctx, `UPDATE space_runs SET state=$1,result=$2,outputs=$2,error_code=NULLIF($3,''),error_message=CASE WHEN $1='failed' THEN COALESCE($2->>'message','Execution failed') ELSE NULL END,progress=$4,completed_at=NOW(),updated_at=NOW()
			WHERE id=$5 AND state IN ('running','retrying') RETURNING `+spaceRunColumns, state, result, errorCode, progress, runID), out); errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		} else if err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, out.SpaceID, out.InitiatedByUserID, out.ResourceKind+".run."+state, out.ID, out)
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
		result, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE id=$1 AND space_id=$2`, id, spaceID)
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

package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

const CreditMeterAssetAnalysisImage = "asset_analysis_image"

var (
	ErrSmartLibraryActiveFolder = errors.New("one smart library folder is already active")
	ErrSmartLibraryNotFound     = errors.New("smart library folder not found")
	ErrSmartLibraryLimit        = errors.New("smart library 500-image limit reached")
)

type SmartLibraryFolder struct {
	ID, UserID, ClientLibraryID, SourceKind, State string
	SuccessfulImages, FailedImages                 int
	EligibleImages, IncludedImages, BillableImages int
	CreatedAt, UpdatedAt                           time.Time
}

type SmartLibraryCandidate struct {
	AssetID        string `json:"assetId"`
	Fingerprint    string `json:"fingerprint"`
	Extension      string `json:"extension"`
	SizeBytes      int64  `json:"sizeBytes"`
	ModifiedBucket int64  `json:"modifiedBucket"`
}

type SmartLibraryPreviewRef struct {
	AssetID     string `json:"assetId"`
	Fingerprint string `json:"fingerprint"`
}
type SmartLibraryCompletion struct {
	AssetID, Description, Model, FallbackReason string
	Tags, Collections                           []string
	Confidence                                  float64
}
type SmartLibraryBatch struct {
	ID, Kind, Status               string
	AssetIDs                       []string
	SuccessfulImages, FailedImages int
}

type SmartLibraryAssetResult struct {
	AssetID, Status, Description, FailureCode, Model string
	Tags, Collections                                []string
	Confidence                                       *float64
	Sequence                                         int64
}

type SmartLibrarySearchHit struct {
	AssetID, Description string
	Tags, Collections    []string
}

func (db *Database) RegisterSmartLibraryFolder(userID, clientID, source string) (*SmartLibraryFolder, error) {
	if db.Conn == nil {
		return nil, errors.New("database unavailable")
	}
	var folder SmartLibraryFolder
	err := db.Conn.QueryRow(`
		INSERT INTO smart_library_folders (id,user_id,client_library_id,source_kind)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (user_id,client_library_id) DO UPDATE SET updated_at=NOW()
		RETURNING id,user_id,client_library_id,source_kind,state,successful_images,failed_images,eligible_images,included_images,billable_images,created_at,updated_at
	`, "slf_"+uuid.NewString(), userID, clientID, source).Scan(&folder.ID, &folder.UserID, &folder.ClientLibraryID, &folder.SourceKind, &folder.State,
		&folder.SuccessfulImages, &folder.FailedImages, &folder.EligibleImages, &folder.IncludedImages, &folder.BillableImages, &folder.CreatedAt, &folder.UpdatedAt)
	if isUniqueViolation(err) {
		return nil, ErrSmartLibraryActiveFolder
	}
	return &folder, err
}

func (db *Database) SmartLibraryFolder(userID, folderID string) (*SmartLibraryFolder, error) {
	var folder SmartLibraryFolder
	err := db.Conn.QueryRow(`SELECT id,user_id,client_library_id,source_kind,state,successful_images,failed_images,eligible_images,included_images,billable_images,created_at,updated_at FROM smart_library_folders WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, folderID, userID).
		Scan(&folder.ID, &folder.UserID, &folder.ClientLibraryID, &folder.SourceKind, &folder.State, &folder.SuccessfulImages, &folder.FailedImages, &folder.EligibleImages, &folder.IncludedImages, &folder.BillableImages, &folder.CreatedAt, &folder.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSmartLibraryNotFound
	}
	return &folder, err
}

func (db *Database) SetSmartLibraryEstimate(userID, folderID string, eligible int) (*SmartLibraryFolder, error) {
	if eligible < 0 {
		eligible = 0
	}
	if eligible > 500 {
		eligible = 500
	}
	included := eligible
	if included > 25 {
		included = 25
	}
	_, err := db.Conn.Exec(`UPDATE smart_library_folders SET eligible_images=$1,included_images=$2,billable_images=$3,updated_at=NOW() WHERE id=$4 AND user_id=$5 AND deleted_at IS NULL`, eligible, included, eligible-included, folderID, userID)
	if err != nil {
		return nil, err
	}
	return db.SmartLibraryFolder(userID, folderID)
}

func (db *Database) CreateSmartLibrarySample(userID, folderID string, candidates []SmartLibraryCandidate) ([]string, error) {
	folder, err := db.SmartLibraryFolder(userID, folderID)
	if err != nil {
		return nil, err
	}
	if folder.SuccessfulImages >= 500 {
		return nil, ErrSmartLibraryLimit
	}
	if len(candidates) > 25 {
		candidates = candidates[:25]
	}
	tx, err := db.Conn.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.AssetID == "" || candidate.Fingerprint == "" {
			return nil, errors.New("invalid smart library candidate")
		}
		_, err = tx.Exec(`INSERT INTO smart_library_assets(folder_id,asset_id,fingerprint,extension,size_bytes,modified_bucket) VALUES($1,$2,$3,$4,$5,$6)
			ON CONFLICT(folder_id,asset_id) DO UPDATE SET fingerprint=excluded.fingerprint,extension=excluded.extension,size_bytes=excluded.size_bytes,modified_bucket=excluded.modified_bucket,updated_at=NOW()`,
			folderID, candidate.AssetID, candidate.Fingerprint, candidate.Extension, candidate.SizeBytes, candidate.ModifiedBucket)
		if err != nil {
			return nil, err
		}
		ids = append(ids, candidate.AssetID)
	}
	if _, err = tx.Exec(`UPDATE smart_library_folders SET state='sample_ready',updated_at=NOW() WHERE id=$1`, folderID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return ids, nil
}

func (db *Database) SmartLibraryResults(userID, folderID string, after int64) ([]SmartLibraryAssetResult, int64, error) {
	if _, err := db.SmartLibraryFolder(userID, folderID); err != nil {
		return nil, after, err
	}
	rows, err := db.Conn.Query(`SELECT asset_id,status,COALESCE(description,''),tags,collections,confidence,COALESCE(failure_code,''),COALESCE(model,''),result_sequence FROM smart_library_assets WHERE folder_id=$1 AND result_sequence>$2 AND status IN ('analyzed','failed') ORDER BY result_sequence LIMIT 500`, folderID, after)
	if err != nil {
		return nil, after, err
	}
	defer rows.Close()
	results := []SmartLibraryAssetResult{}
	next := after
	for rows.Next() {
		var result SmartLibraryAssetResult
		var tags, collections []byte
		if err := rows.Scan(&result.AssetID, &result.Status, &result.Description, &tags, &collections, &result.Confidence, &result.FailureCode, &result.Model, &result.Sequence); err != nil {
			return nil, next, err
		}
		_ = json.Unmarshal(tags, &result.Tags)
		_ = json.Unmarshal(collections, &result.Collections)
		if result.Sequence > next {
			next = result.Sequence
		}
		results = append(results, result)
	}
	return results, next, rows.Err()
}

func (db *Database) CreateSmartLibraryBatch(userID, folderID, kind string, previews []SmartLibraryPreviewRef) (*SmartLibraryBatch, error) {
	tx, err := db.Conn.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var successful int
	if err = tx.QueryRow(`SELECT successful_images FROM smart_library_folders WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE`, folderID, userID).Scan(&successful); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSmartLibraryNotFound
	} else if err != nil {
		return nil, err
	}
	if successful+len(previews) > 500 {
		return nil, ErrSmartLibraryLimit
	}
	ids := make([]string, 0, len(previews))
	for _, preview := range previews {
		result, err := tx.Exec(`UPDATE smart_library_assets SET status='processing',failure_code=NULL,updated_at=NOW() WHERE folder_id=$1 AND asset_id=$2 AND fingerprint=$3 AND status IN ('pending','failed')`, folderID, preview.AssetID, preview.Fingerprint)
		if err != nil {
			return nil, err
		}
		count, _ := result.RowsAffected()
		if count != 1 {
			return nil, errors.New("preview does not match an eligible asset")
		}
		ids = append(ids, preview.AssetID)
	}
	encoded, _ := json.Marshal(ids)
	batch := &SmartLibraryBatch{ID: "slbatch_" + uuid.NewString(), Kind: kind, Status: "processing", AssetIDs: ids}
	if _, err = tx.Exec(`INSERT INTO smart_library_batches(id,folder_id,kind,status,asset_ids)VALUES($1,$2,$3,'processing',$4)`, batch.ID, folderID, kind, encoded); err != nil {
		return nil, err
	}
	state := "full_processing"
	if kind == "sample" {
		state = "sample_processing"
	}
	if _, err = tx.Exec(`UPDATE smart_library_folders SET state=$1,updated_at=NOW() WHERE id=$2`, state, folderID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return batch, nil
}

func (db *Database) ResetSmartLibraryBatch(batchID string) error {
	tx, err := db.Conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var folderID string
	var encoded []byte
	if err = tx.QueryRow(`UPDATE smart_library_batches SET status='failed',updated_at=NOW() WHERE id=$1 RETURNING folder_id,asset_ids`, batchID).Scan(&folderID, &encoded); err != nil {
		return err
	}
	var ids []string
	_ = json.Unmarshal(encoded, &ids)
	for _, id := range ids {
		if _, err = tx.Exec(`UPDATE smart_library_assets SET status='pending',updated_at=NOW() WHERE folder_id=$1 AND asset_id=$2 AND status='processing'`, folderID, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (db *Database) CompleteSmartLibraryBatch(userID, batchID string, completions []SmartLibraryCompletion, failures map[string]string, finalBatch bool) (*SmartLibraryFolder, error) {
	tx, err := db.Conn.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var folderID, kind string
	var encoded []byte
	if err = tx.QueryRow(`SELECT b.folder_id,b.kind,b.asset_ids FROM smart_library_batches b JOIN smart_library_folders f ON f.id=b.folder_id WHERE b.id=$1 AND f.user_id=$2 AND f.deleted_at IS NULL FOR UPDATE`, batchID, userID).Scan(&folderID, &kind, &encoded); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSmartLibraryNotFound
	} else if err != nil {
		return nil, err
	}
	var ids []string
	if err = json.Unmarshal(encoded, &ids); err != nil {
		return nil, err
	}
	allowed := make(map[string]bool, len(ids))
	for _, id := range ids {
		allowed[id] = true
	}
	seen := make(map[string]bool, len(ids))
	for _, completion := range completions {
		if !allowed[completion.AssetID] || seen[completion.AssetID] {
			return nil, errors.New("analysis returned an unexpected asset")
		}
		seen[completion.AssetID] = true
		tags, _ := json.Marshal(completion.Tags)
		collections, _ := json.Marshal(completion.Collections)
		result, err := tx.Exec(`UPDATE smart_library_assets SET status='analyzed',description=$1,tags=$2,collections=$3,confidence=$4,failure_code=NULL,model=$5,result_sequence=nextval('smart_library_result_sequence'),analyzed_at=NOW(),updated_at=NOW() WHERE folder_id=$6 AND asset_id=$7 AND status='processing'`, completion.Description, tags, collections, completion.Confidence, completion.Model, folderID, completion.AssetID)
		if err != nil {
			return nil, err
		}
		count, _ := result.RowsAffected()
		if count != 1 {
			return nil, errors.New("analysis asset is no longer processing")
		}
	}
	for id, code := range failures {
		if !allowed[id] || seen[id] {
			return nil, errors.New("analysis failure returned an unexpected asset")
		}
		seen[id] = true
		if _, err = tx.Exec(`UPDATE smart_library_assets SET status='failed',failure_code=$1,result_sequence=nextval('smart_library_result_sequence'),updated_at=NOW() WHERE folder_id=$2 AND asset_id=$3 AND status='processing'`, code, folderID, id); err != nil {
			return nil, err
		}
	}
	if len(seen) != len(ids) {
		return nil, errors.New("analysis did not resolve every asset")
	}
	status := "completed"
	if len(completions) == 0 {
		status = "failed"
	} else if len(failures) > 0 {
		status = "partially_failed"
	}
	if _, err = tx.Exec(`UPDATE smart_library_batches SET status=$1,successful_images=$2,failed_images=$3,updated_at=NOW() WHERE id=$4`, status, len(completions), len(failures), batchID); err != nil {
		return nil, err
	}
	state := "full_processing"
	if kind == "sample" {
		state = "sample_processing"
	}
	if finalBatch {
		state = "complete"
		if kind == "sample" {
			state = "sample_review"
		}
	}
	result, err := tx.Exec(`UPDATE smart_library_folders SET state=$1,successful_images=successful_images+$2,failed_images=failed_images+$3,updated_at=NOW() WHERE id=$4 AND successful_images+$2<=500`, state, len(completions), len(failures), folderID)
	if err != nil {
		return nil, err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return nil, ErrSmartLibraryLimit
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return db.SmartLibraryFolder(userID, folderID)
}

func (db *Database) SearchSmartLibrary(userID, folderID, query string, limit int) ([]SmartLibrarySearchHit, error) {
	if _, err := db.SmartLibraryFolder(userID, folderID); err != nil {
		return nil, err
	}
	if query == "" {
		return []SmartLibrarySearchHit{}, nil
	}
	rows, err := db.Conn.Query(`SELECT asset_id,COALESCE(description,''),tags,collections FROM smart_library_assets WHERE folder_id=$1 AND status='analyzed' AND (description ILIKE '%'||$2||'%' OR tags::text ILIKE '%'||$2||'%' OR collections::text ILIKE '%'||$2||'%') ORDER BY confidence DESC NULLS LAST, analyzed_at DESC LIMIT $3`, folderID, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	hits := []SmartLibrarySearchHit{}
	for rows.Next() {
		var hit SmartLibrarySearchHit
		var tags, collections []byte
		if err := rows.Scan(&hit.AssetID, &hit.Description, &tags, &collections); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(tags, &hit.Tags)
		_ = json.Unmarshal(collections, &hit.Collections)
		hits = append(hits, hit)
	}
	return hits, rows.Err()
}

func (db *Database) SmartLibraryBatches(userID, folderID string) ([]SmartLibraryBatch, error) {
	if _, err := db.SmartLibraryFolder(userID, folderID); err != nil {
		return nil, err
	}
	rows, err := db.Conn.Query(`SELECT id,kind,status,asset_ids,successful_images,failed_images FROM smart_library_batches WHERE folder_id=$1 ORDER BY created_at`, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	batches := []SmartLibraryBatch{}
	for rows.Next() {
		var batch SmartLibraryBatch
		var ids []byte
		if err := rows.Scan(&batch.ID, &batch.Kind, &batch.Status, &ids, &batch.SuccessfulImages, &batch.FailedImages); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(ids, &batch.AssetIDs)
		batches = append(batches, batch)
	}
	return batches, rows.Err()
}

func (db *Database) DeleteSmartLibraryFolder(userID, folderID string) error {
	result, err := db.Conn.Exec(`UPDATE smart_library_folders SET deleted_at=NOW(),state='deleted',updated_at=NOW() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, folderID, userID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrSmartLibraryNotFound
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var pqError *pq.Error
	return errors.As(err, &pqError) && pqError.Code == "23505"
}

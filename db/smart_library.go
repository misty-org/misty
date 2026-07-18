package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
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
	AssetKind      string `json:"assetKind,omitempty"`
	MimeType       string `json:"mimeType,omitempty"`
	SizeBytes      int64  `json:"sizeBytes"`
	ModifiedBucket int64  `json:"modifiedBucket"`
}

type SmartLibraryPreviewRef struct {
	AssetID     string `json:"assetId"`
	Fingerprint string `json:"fingerprint"`
	AssetKind   string `json:"assetKind,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}
type SmartLibraryCompletion struct {
	AssetID, Description, Model, FallbackReason string
	Tags, Collections                           []string
	Confidence                                  float64
	AssetKind, MimeType                         string
	Metadata                                    SmartLibraryRichMetadata
	Embedding                                   []float64
	EmbeddingModel, EmbeddingInputHash          string
	EmbeddingVersion                            int
}
type SmartLibraryBatch struct {
	ID, Kind, Status               string
	AssetIDs                       []string
	SuccessfulImages, FailedImages int
}

type SmartLibraryAssetResult struct {
	AssetID, Status, Description, FailureCode, Model string
	AssetKind, MimeType                              string
	Tags, Collections                                []string
	Metadata                                         SmartLibraryRichMetadata
	Confidence                                       *float64
	Sequence                                         int64
}

type SmartLibraryRichMetadata struct {
	ContentType    string   `json:"contentType"`
	PrimarySubject string   `json:"primarySubject"`
	SearchTerms    []string `json:"searchTerms"`
	Entities       []string `json:"entities"`
	Characters     []string `json:"characters"`
	Brands         []string `json:"brands"`
	Applications   []string `json:"applications"`
	Objects        []string `json:"objects"`
	Scenes         []string `json:"scenes"`
	Activities     []string `json:"activities"`
	Colors         []string `json:"colors"`
	VisibleText    []string `json:"visibleText"`
	Topics         []string `json:"topics"`
}

type SmartLibrarySearchHit struct {
	AssetID       string                   `json:"assetId"`
	FolderID      string                   `json:"folderId"`
	AssetKind     string                   `json:"assetKind"`
	MimeType      string                   `json:"mimeType"`
	Description   string                   `json:"description"`
	Tags          []string                 `json:"tags"`
	Collections   []string                 `json:"suggestedCollections"`
	Metadata      SmartLibraryRichMetadata `json:"metadata"`
	Score         float64                  `json:"score"`
	SemanticScore float64                  `json:"semanticScore"`
	LexicalScore  float64                  `json:"lexicalScore"`
	MatchReasons  []string                 `json:"matchReasons"`
}

type SmartLibraryIndexStatus struct {
	CurrentVersion int    `json:"currentVersion"`
	EmbeddingModel string `json:"embeddingModel"`
	OutdatedAssets int    `json:"outdatedAssets"`
	FailedAssets   int    `json:"failedAssets"`
}

type SmartLibraryReindexAsset struct {
	AssetID, FolderID, Fingerprint, AssetKind, MimeType string
	Description                                         string
	Tags, Collections                                   []string
	Metadata                                            SmartLibraryRichMetadata
	RequiresPreview                                     bool
}

type SmartLibraryReindexJob struct {
	ID, Status, Model, Cursor             string
	Version, Requested, Completed, Failed int
	Assets                                []SmartLibraryReindexAsset
}

func (db *Database) RegisterSmartLibraryFolder(userID, clientID, source string) (*SmartLibraryFolder, error) {
	if db.Conn == nil {
		return nil, errors.New("database unavailable")
	}
	var folder SmartLibraryFolder
	err := db.smartLibraryScan(`
		INSERT INTO smart_library_folders (id,user_id,client_library_id,source_kind)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (user_id,client_library_id) WHERE deleted_at IS NULL DO UPDATE SET updated_at=NOW()
		RETURNING id,user_id,client_library_id,source_kind,state,successful_images,failed_images,eligible_images,included_images,billable_images,created_at,updated_at
	`, []any{"slf_" + uuid.NewString(), userID, clientID, source}, &folder.ID, &folder.UserID, &folder.ClientLibraryID, &folder.SourceKind, &folder.State,
		&folder.SuccessfulImages, &folder.FailedImages, &folder.EligibleImages, &folder.IncludedImages, &folder.BillableImages, &folder.CreatedAt, &folder.UpdatedAt)
	if isUniqueViolation(err) {
		return nil, ErrSmartLibraryActiveFolder
	}
	return &folder, err
}

func (db *Database) SmartLibraryFolder(userID, folderID string) (*SmartLibraryFolder, error) {
	var folder SmartLibraryFolder
	err := db.smartLibraryScan(`SELECT id,user_id,client_library_id,source_kind,state,successful_images,failed_images,eligible_images,included_images,billable_images,created_at,updated_at FROM smart_library_folders WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, []any{folderID, userID},
		&folder.ID, &folder.UserID, &folder.ClientLibraryID, &folder.SourceKind, &folder.State, &folder.SuccessfulImages, &folder.FailedImages, &folder.EligibleImages, &folder.IncludedImages, &folder.BillableImages, &folder.CreatedAt, &folder.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSmartLibraryNotFound
	}
	return &folder, err
}

func (db *Database) SetSmartLibraryEstimate(userID, folderID string, eligible int) (*SmartLibraryFolder, error) {
	if eligible < 0 {
		eligible = 0
	}
	included := eligible
	if included > 25 {
		included = 25
	}
	_, err := db.smartLibraryExec(`UPDATE smart_library_folders SET eligible_images=$1,included_images=$2,billable_images=$3,updated_at=NOW() WHERE id=$4 AND user_id=$5 AND deleted_at IS NULL`, eligible, included, eligible-included, folderID, userID)
	if err != nil {
		return nil, err
	}
	return db.SmartLibraryFolder(userID, folderID)
}

func (db *Database) CreateSmartLibrarySample(userID, folderID string, candidates []SmartLibraryCandidate) ([]string, error) {
	_, err := db.SmartLibraryFolder(userID, folderID)
	if err != nil {
		return nil, err
	}
	if len(candidates) > 25 {
		candidates = candidates[:25]
	}
	tx, err := db.beginSmartLibraryTx()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var existingSample int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM smart_library_assets WHERE folder_id=$1 AND sample_eligible=TRUE`, folderID).Scan(&existingSample); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.AssetID == "" || candidate.Fingerprint == "" {
			return nil, errors.New("invalid smart library candidate")
		}
		if existingSample > 0 {
			var eligible bool
			if err = tx.QueryRow(`SELECT sample_eligible FROM smart_library_assets WHERE folder_id=$1 AND asset_id=$2`, folderID, candidate.AssetID).Scan(&eligible); err != nil || !eligible {
				return nil, errors.New("the included sample is already fixed")
			}
		}
		assetKind, mimeType := normalizedAssetType(candidate.AssetKind, candidate.MimeType, candidate.Extension)
		_, err = tx.Exec(`INSERT INTO smart_library_assets(folder_id,user_id,asset_id,fingerprint,extension,size_bytes,modified_bucket,sample_eligible,asset_kind,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9)
			ON CONFLICT(folder_id,asset_id) DO UPDATE SET fingerprint=excluded.fingerprint,extension=excluded.extension,size_bytes=excluded.size_bytes,modified_bucket=excluded.modified_bucket,sample_eligible=TRUE,asset_kind=excluded.asset_kind,mime_type=excluded.mime_type,index_status='pending',updated_at=NOW()`,
			folderID, userID, candidate.AssetID, candidate.Fingerprint, candidate.Extension, candidate.SizeBytes, candidate.ModifiedBucket, assetKind, mimeType)
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
	results := []SmartLibraryAssetResult{}
	next := after
	err := db.smartLibraryRows(`SELECT asset_id,status,COALESCE(description,''),tags,collections,metadata,asset_kind,mime_type,confidence,COALESCE(failure_code,''),COALESCE(model,''),result_sequence FROM smart_library_assets WHERE folder_id=$1 AND result_sequence>$2 AND status IN ('analyzed','failed') ORDER BY result_sequence LIMIT 500`, []any{folderID, after}, func(rows *sql.Rows) error {
		for rows.Next() {
			var result SmartLibraryAssetResult
			var tags, collections, metadata []byte
			if err := rows.Scan(&result.AssetID, &result.Status, &result.Description, &tags, &collections, &metadata, &result.AssetKind, &result.MimeType, &result.Confidence, &result.FailureCode, &result.Model, &result.Sequence); err != nil {
				return err
			}
			_ = json.Unmarshal(tags, &result.Tags)
			_ = json.Unmarshal(collections, &result.Collections)
			_ = json.Unmarshal(metadata, &result.Metadata)
			if result.Sequence > next {
				next = result.Sequence
			}
			results = append(results, result)
		}
		return rows.Err()
	})
	return results, next, err
}

func (db *Database) SetSmartLibraryAssetTags(userID, folderID, assetID string, tags []string) (SmartLibraryAssetResult, error) {
	encoded, err := json.Marshal(tags)
	if err != nil {
		return SmartLibraryAssetResult{}, err
	}
	var sequence int64
	err = db.smartLibraryScan(`UPDATE smart_library_assets SET tags=$1::jsonb,result_sequence=nextval('smart_library_result_sequence'),updated_at=NOW() WHERE user_id=$2 AND folder_id=$3 AND asset_id=$4 AND status='analyzed' RETURNING result_sequence`, []any{encoded, userID, folderID, assetID}, &sequence)
	if errors.Is(err, sql.ErrNoRows) {
		return SmartLibraryAssetResult{}, ErrSmartLibraryNotFound
	}
	if err != nil {
		return SmartLibraryAssetResult{}, err
	}
	results, _, err := db.SmartLibraryResults(userID, folderID, sequence-1)
	if err != nil {
		return SmartLibraryAssetResult{}, err
	}
	for _, result := range results {
		if result.AssetID == assetID {
			return result, nil
		}
	}
	return SmartLibraryAssetResult{}, ErrSmartLibraryNotFound
}

func (db *Database) CreateSmartLibraryBatch(userID, folderID, kind string, previews []SmartLibraryPreviewRef) (*SmartLibraryBatch, error) {
	if kind != "sample" && kind != "full" {
		return nil, errors.New("invalid smart library batch kind")
	}
	tx, err := db.beginSmartLibraryTx()
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
	ids := make([]string, 0, len(previews))
	for _, preview := range previews {
		var counted bool
		var row *sql.Row
		if kind == "sample" {
			row = tx.QueryRow(`UPDATE smart_library_assets SET status='processing',failure_code=NULL,updated_at=NOW() WHERE folder_id=$1 AND asset_id=$2 AND fingerprint=$3 AND sample_eligible=TRUE AND status IN ('pending','failed') RETURNING counted_success`, folderID, preview.AssetID, preview.Fingerprint)
		} else {
			assetKind, mimeType := normalizedAssetType(preview.AssetKind, preview.MimeType, "")
			row = tx.QueryRow(`INSERT INTO smart_library_assets(folder_id,user_id,asset_id,fingerprint,extension,size_bytes,modified_bucket,status,asset_kind,mime_type) VALUES($1,$2,$3,$4,'',0,0,'processing',$5,$6)
				ON CONFLICT(folder_id,asset_id) DO UPDATE SET fingerprint=excluded.fingerprint,status='processing',failure_code=NULL,asset_kind=excluded.asset_kind,mime_type=excluded.mime_type,semantic_embedding=NULL,embedding_model=NULL,embedding_version=0,embedding_input_hash=NULL,embedded_at=NULL,index_status='pending',index_failure_code=NULL,index_claim_token=NULL,index_claimed_at=NULL,updated_at=NOW()
				WHERE (smart_library_assets.status IN ('pending','failed') AND (NOT smart_library_assets.sample_eligible OR smart_library_assets.counted_success)) OR (smart_library_assets.status='analyzed' AND smart_library_assets.fingerprint<>excluded.fingerprint)
				RETURNING counted_success`, folderID, userID, preview.AssetID, preview.Fingerprint, assetKind, mimeType)
		}
		err := row.Scan(&counted)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("preview does not match an eligible asset")
		} else if err != nil {
			return nil, err
		}
		ids = append(ids, preview.AssetID)
	}
	_ = successful // retained for the row lock that serializes concurrent approvals.
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
	tx, err := db.beginSmartLibraryTx()
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
	tx, err := db.beginSmartLibraryTx()
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
	newSuccesses := 0
	for _, completion := range completions {
		if !allowed[completion.AssetID] || seen[completion.AssetID] {
			return nil, errors.New("analysis returned an unexpected asset")
		}
		seen[completion.AssetID] = true
		tags, _ := json.Marshal(completion.Tags)
		collections, _ := json.Marshal(completion.Collections)
		metadata, _ := json.Marshal(completion.Metadata)
		assetKind, mimeType := strings.TrimSpace(completion.AssetKind), strings.TrimSpace(completion.MimeType)
		if assetKind != "" || mimeType != "" {
			assetKind, mimeType = normalizedAssetType(assetKind, mimeType, "")
		}
		var embedding any
		indexStatus := "failed"
		indexFailure := "embedding_missing"
		if len(completion.Embedding) > 0 {
			vector, vectorErr := smartLibraryVector(completion.Embedding)
			if vectorErr != nil {
				return nil, vectorErr
			}
			embedding = vector
			indexStatus = "indexed"
			indexFailure = ""
		}
		var wasCounted bool
		if err := tx.QueryRow(`SELECT counted_success FROM smart_library_assets WHERE folder_id=$1 AND asset_id=$2 AND status='processing' FOR UPDATE`, folderID, completion.AssetID).Scan(&wasCounted); err != nil {
			return nil, err
		}
		result, err := tx.Exec(`UPDATE smart_library_assets SET status='analyzed',counted_success=TRUE,description=$1,tags=$2,collections=$3,confidence=$4,failure_code=NULL,model=$5,metadata=$6,asset_kind=COALESCE(NULLIF($7,''),asset_kind),mime_type=COALESCE(NULLIF($8,''),mime_type),semantic_embedding=$9::vector,embedding_model=NULLIF($10,''),embedding_version=$11,embedding_input_hash=NULLIF($12,''),embedded_at=CASE WHEN $9 IS NULL THEN NULL ELSE NOW() END,index_status=$13,index_failure_code=NULLIF($14,''),index_claim_token=NULL,index_claimed_at=NULL,result_sequence=nextval('smart_library_result_sequence'),analyzed_at=NOW(),updated_at=NOW() WHERE folder_id=$15 AND asset_id=$16 AND status='processing'`, completion.Description, tags, collections, completion.Confidence, completion.Model, metadata, assetKind, mimeType, embedding, completion.EmbeddingModel, completion.EmbeddingVersion, completion.EmbeddingInputHash, indexStatus, indexFailure, folderID, completion.AssetID)
		if err != nil {
			return nil, err
		}
		count, _ := result.RowsAffected()
		if count != 1 {
			return nil, errors.New("analysis asset is no longer processing")
		}
		if !wasCounted {
			newSuccesses++
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
	result, err := tx.Exec(`UPDATE smart_library_folders SET state=$1,successful_images=successful_images+$2,failed_images=(SELECT COUNT(*) FROM smart_library_assets WHERE folder_id=$3 AND status='failed'),updated_at=NOW() WHERE id=$3`, state, newSuccesses, folderID)
	if err != nil {
		return nil, err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return nil, ErrSmartLibraryNotFound
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return db.SmartLibraryFolder(userID, folderID)
}

func (db *Database) SearchSmartLibrary(userID, folderID, query string, limit int) ([]SmartLibrarySearchHit, error) {
	return db.SearchSmartLibraryHybrid(userID, folderID, query, nil, limit)
}

// SearchSmartLibraryHybrid securely scopes candidates before rank fusion. The
// lexical branch preserves exact names and tags, while the ANN branch recovers
// concepts that the generated caption omitted.
func (db *Database) SearchSmartLibraryHybrid(userID, folderID, query string, embedding []float64, limit int) ([]SmartLibrarySearchHit, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []SmartLibrarySearchHit{}, nil
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 50 {
		limit = 50
	}
	if folderID != "" {
		if _, err := db.SmartLibraryFolder(userID, folderID); err != nil {
			return nil, err
		}
	}
	var vector any
	if len(embedding) > 0 {
		formatted, err := smartLibraryVector(embedding)
		if err != nil {
			return nil, err
		}
		vector = formatted
	}
	candidateLimit := limit * 8
	if candidateLimit < 80 {
		candidateLimit = 80
	}
	querySQL := `
		WITH lexical AS (
			SELECT a.folder_id,a.asset_id,
				LEAST(1.0, ts_rank_cd(a.search_tsv, websearch_to_tsquery('simple'::regconfig,$3)) * 4.0
					+ CASE WHEN lower(COALESCE(a.description,'') || ' ' || a.tags::text || ' ' || a.metadata::text) LIKE '%' || lower($3) || '%' THEN 0.45 ELSE 0 END) AS lexical_score
			FROM smart_library_assets a
			WHERE a.user_id=$1 AND a.status='analyzed' AND ($2='' OR a.folder_id=$2)
				AND a.search_tsv @@ websearch_to_tsquery('simple'::regconfig,$3)
			ORDER BY lexical_score DESC
			LIMIT $5
		), semantic AS (
			SELECT a.folder_id,a.asset_id,GREATEST(0.0, 1.0-(a.semantic_embedding <=> $4::vector)) AS semantic_score
			FROM smart_library_assets a
			WHERE $4 IS NOT NULL AND a.user_id=$1 AND a.status='analyzed' AND a.semantic_embedding IS NOT NULL AND ($2='' OR a.folder_id=$2)
			ORDER BY a.semantic_embedding <=> $4::vector
			LIMIT $5
		), candidates AS (
			SELECT folder_id,asset_id FROM lexical UNION SELECT folder_id,asset_id FROM semantic
		), scored AS (
			SELECT a.*,
				COALESCE(l.lexical_score,0)::float8 AS lexical_score,
				COALESCE(s.semantic_score,0)::float8 AS semantic_score,
				(CASE WHEN $4 IS NULL THEN COALESCE(l.lexical_score,0)
					ELSE 0.68*COALESCE(s.semantic_score,0)+0.32*COALESCE(l.lexical_score,0) END)::float8 AS score
			FROM candidates c
			JOIN smart_library_assets a ON a.folder_id=c.folder_id AND a.asset_id=c.asset_id AND a.user_id=$1
			LEFT JOIN lexical l ON l.folder_id=a.folder_id AND l.asset_id=a.asset_id
			LEFT JOIN semantic s ON s.folder_id=a.folder_id AND s.asset_id=a.asset_id
		)
		SELECT folder_id,asset_id,asset_kind,mime_type,COALESCE(description,''),tags,collections,metadata,score,semantic_score,lexical_score
		FROM scored ORDER BY score DESC, analyzed_at DESC LIMIT $6`
	hits := []SmartLibrarySearchHit{}
	err := db.withRLSContext(context.Background(), serviceRLSSettings(), func(tx *sql.Tx) error {
		// Strict iterative scans improve filtered HNSW recall without ever relaxing
		// the tenant predicate. Older pgvector releases simply reject this setting.
		_, _ = tx.Exec(`SET LOCAL hnsw.iterative_scan = 'strict_order'`)
		rows, err := tx.Query(querySQL, userID, folderID, query, vector, candidateLimit, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var hit SmartLibrarySearchHit
			var tags, collections, metadata []byte
			if err := rows.Scan(&hit.FolderID, &hit.AssetID, &hit.AssetKind, &hit.MimeType, &hit.Description, &tags, &collections, &metadata, &hit.Score, &hit.SemanticScore, &hit.LexicalScore); err != nil {
				return err
			}
			_ = json.Unmarshal(tags, &hit.Tags)
			_ = json.Unmarshal(collections, &hit.Collections)
			_ = json.Unmarshal(metadata, &hit.Metadata)
			if hit.LexicalScore > 0 {
				hit.MatchReasons = append(hit.MatchReasons, "metadata")
			}
			if hit.SemanticScore > 0 {
				hit.MatchReasons = append(hit.MatchReasons, "semantic")
			}
			hits = append(hits, hit)
		}
		return rows.Err()
	})
	if err == nil {
		hits = pruneWeakSemanticMatches(hits)
	}
	return hits, err
}

// Once the query has an exact metadata hit, low-scoring vector neighbors are
// usually visual lookalikes rather than useful answers. Preserve every lexical
// hit and only nearby semantic results; pure semantic searches retain their
// normal breadth.
func pruneWeakSemanticMatches(hits []SmartLibrarySearchHit) []SmartLibrarySearchHit {
	if len(hits) < 2 {
		return hits
	}
	hasLexical := false
	for _, hit := range hits {
		if hit.LexicalScore > 0 {
			hasLexical = true
			break
		}
	}
	if !hasLexical {
		return hits
	}
	cutoff := hits[0].Score * 0.78
	filtered := make([]SmartLibrarySearchHit, 0, len(hits))
	for _, hit := range hits {
		if hit.LexicalScore > 0 || hit.Score >= cutoff {
			filtered = append(filtered, hit)
		}
	}
	return filtered
}

func (db *Database) RecordSmartLibraryCostEvent(userID, folderID, batchID, model string, batchSize int, inputTokens, outputTokens int64, success bool) error {
	_, err := db.smartLibraryExec(`INSERT INTO smart_library_cost_events(user_id,folder_id,batch_id,model,batch_size,input_tokens,output_tokens,success,event_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'analysis')`, userID, folderID, batchID, model, batchSize, inputTokens, outputTokens, success)
	return err
}

func (db *Database) RecordSmartLibrarySemanticUsage(userID, folderID, eventKind, model string, batchSize int, inputTokens, outputTokens int64, success bool) error {
	if eventKind != "semantic_index" && eventKind != "semantic_query" && eventKind != "reindex" {
		return errors.New("invalid semantic usage kind")
	}
	var folder any
	if folderID != "" {
		folder = folderID
	}
	if batchSize < 1 {
		batchSize = 1
	}
	_, err := db.smartLibraryExec(`INSERT INTO smart_library_cost_events(user_id,folder_id,model,batch_size,input_tokens,output_tokens,success,event_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, userID, folder, model, batchSize, inputTokens, outputTokens, success, eventKind)
	return err
}

func (db *Database) SmartLibrarySemanticCallsToday(userID, eventKind string) (int, error) {
	var count int
	err := db.smartLibraryScan(`SELECT COUNT(*) FROM smart_library_cost_events WHERE user_id=$1 AND event_kind=$2 AND created_at>=date_trunc('day',NOW())`, []any{userID, eventKind}, &count)
	return count, err
}

func (db *Database) SmartLibraryIndexStatusForUser(userID, folderID, model string, version int) (SmartLibraryIndexStatus, error) {
	status := SmartLibraryIndexStatus{CurrentVersion: version, EmbeddingModel: model}
	err := db.smartLibraryScan(`SELECT
		COUNT(*) FILTER (WHERE status='analyzed' AND (semantic_embedding IS NULL OR embedding_model<>$3 OR embedding_version<>$4)),
		COUNT(*) FILTER (WHERE status='analyzed' AND index_status='failed')
		FROM smart_library_assets WHERE user_id=$1 AND ($2='' OR folder_id=$2)`, []any{userID, folderID, model, version}, &status.OutdatedAssets, &status.FailedAssets)
	return status, err
}

func (db *Database) PlanSmartLibraryReindex(userID, folderID, cursor, model string, version, limit int) (*SmartLibraryReindexJob, error) {
	if folderID != "" {
		if _, err := db.SmartLibraryFolder(userID, folderID); err != nil {
			return nil, err
		}
	}
	if version < 1 || strings.TrimSpace(model) == "" {
		return nil, errors.New("invalid reindex target")
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 100 {
		limit = 100
	}
	assets := []SmartLibraryReindexAsset{}
	err := db.smartLibraryRows(`SELECT asset_id,folder_id,fingerprint,asset_kind,mime_type,COALESCE(description,''),tags,collections,metadata
		FROM smart_library_assets WHERE user_id=$1 AND status='analyzed' AND ($2='' OR folder_id=$2)
		AND (folder_id||':'||asset_id)>$3 AND (semantic_embedding IS NULL OR embedding_model<>$4 OR embedding_version<>$5)
		AND (index_status<>'processing' OR index_claimed_at<NOW()-INTERVAL '15 minutes')
		ORDER BY folder_id,asset_id LIMIT $6`, []any{userID, folderID, cursor, model, version, limit}, func(rows *sql.Rows) error {
		for rows.Next() {
			var asset SmartLibraryReindexAsset
			var tags, collections, metadata []byte
			if err := rows.Scan(&asset.AssetID, &asset.FolderID, &asset.Fingerprint, &asset.AssetKind, &asset.MimeType, &asset.Description, &tags, &collections, &metadata); err != nil {
				return err
			}
			_ = json.Unmarshal(tags, &asset.Tags)
			_ = json.Unmarshal(collections, &asset.Collections)
			_ = json.Unmarshal(metadata, &asset.Metadata)
			asset.RequiresPreview = asset.AssetKind == "image" || asset.AssetKind == "document"
			assets = append(assets, asset)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	job := &SmartLibraryReindexJob{ID: "slreindex_" + uuid.NewString(), Status: "pending", Model: model, Version: version, Requested: len(assets), Assets: assets, Cursor: cursor}
	if len(assets) == 0 {
		job.Status = "completed"
	}
	if len(assets) > 0 {
		last := assets[len(assets)-1]
		job.Cursor = last.FolderID + ":" + last.AssetID
	}
	encoded, _ := json.Marshal(assets)
	var nullableFolder any
	if folderID != "" {
		nullableFolder = folderID
	}
	_, err = db.smartLibraryExec(`INSERT INTO smart_library_reindex_jobs(id,user_id,folder_id,status,embedding_model,embedding_version,asset_ids,cursor,requested_assets) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, job.ID, userID, nullableFolder, job.Status, model, version, encoded, job.Cursor, len(assets))
	return job, err
}

// SmartLibraryReindexRecords verifies that every submitted asset belongs to the
// authenticated job and still has the same fingerprint. It returns the stored
// rich metadata used as the text side of the multimodal embedding.
func (db *Database) SmartLibraryReindexRecords(userID, jobID string, refs []SmartLibraryPreviewRef) (*SmartLibraryReindexJob, []SmartLibraryReindexAsset, error) {
	tx, err := db.beginSmartLibraryTx()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()
	var job SmartLibraryReindexJob
	var encoded []byte
	err = tx.QueryRow(`SELECT id,status,embedding_model,embedding_version,asset_ids,cursor,requested_assets,completed_assets,failed_assets FROM smart_library_reindex_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE`, jobID, userID).Scan(&job.ID, &job.Status, &job.Model, &job.Version, &encoded, &job.Cursor, &job.Requested, &job.Completed, &job.Failed)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrSmartLibraryNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	var planned []SmartLibraryReindexAsset
	if err = json.Unmarshal(encoded, &planned); err != nil {
		return nil, nil, err
	}
	allowed := map[string]SmartLibraryReindexAsset{}
	for _, a := range planned {
		allowed[a.FolderID+"\x00"+a.AssetID] = a
	}
	selected := make([]SmartLibraryReindexAsset, 0, len(refs))
	for _, ref := range refs {
		matches := []SmartLibraryReindexAsset{}
		for _, a := range planned {
			if a.AssetID == ref.AssetID && a.Fingerprint == ref.Fingerprint {
				matches = append(matches, a)
			}
		}
		if len(matches) != 1 {
			return nil, nil, errors.New("asset is not in reindex job")
		}
		a := allowed[matches[0].FolderID+"\x00"+matches[0].AssetID]
		result, claimErr := tx.Exec(`UPDATE smart_library_assets SET index_status='processing',index_claim_token=$1,index_claimed_at=NOW(),index_failure_code=NULL,updated_at=NOW()
			WHERE user_id=$2 AND folder_id=$3 AND asset_id=$4 AND fingerprint=$5 AND status='analyzed'
			AND (semantic_embedding IS NULL OR embedding_model<>$6 OR embedding_version<>$7)
			AND (index_status<>'processing' OR index_claimed_at<NOW()-INTERVAL '15 minutes')`, jobID, userID, a.FolderID, a.AssetID, a.Fingerprint, job.Model, job.Version)
		if claimErr != nil {
			return nil, nil, claimErr
		}
		if claimed, _ := result.RowsAffected(); claimed == 1 {
			selected = append(selected, a)
		}
	}
	if len(selected) > 0 && job.Status == "pending" {
		job.Status = "processing"
		if _, err = tx.Exec(`UPDATE smart_library_reindex_jobs SET status='processing',updated_at=NOW() WHERE id=$1`, job.ID); err != nil {
			return nil, nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, nil, err
	}
	return &job, selected, nil
}

func (db *Database) CompleteSmartLibraryReindexJob(userID, jobID string, embeddings map[string]SmartLibraryCompletion, failures map[string]string) (*SmartLibraryReindexJob, error) {
	tx, err := db.beginSmartLibraryTx()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var job SmartLibraryReindexJob
	var encoded, completedEncoded, failedEncoded []byte
	if err = tx.QueryRow(`SELECT id,status,embedding_model,embedding_version,asset_ids,completed_asset_ids,failed_asset_ids,cursor,requested_assets,completed_assets,failed_assets FROM smart_library_reindex_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE`, jobID, userID).Scan(&job.ID, &job.Status, &job.Model, &job.Version, &encoded, &completedEncoded, &failedEncoded, &job.Cursor, &job.Requested, &job.Completed, &job.Failed); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSmartLibraryNotFound
	} else if err != nil {
		return nil, err
	}
	var planned []SmartLibraryReindexAsset
	if err = json.Unmarshal(encoded, &planned); err != nil {
		return nil, err
	}
	allowed := map[string]SmartLibraryReindexAsset{}
	for _, a := range planned {
		allowed[a.FolderID+"\x00"+a.AssetID] = a
	}
	var completedKeys, failedKeys []string
	_ = json.Unmarshal(completedEncoded, &completedKeys)
	_ = json.Unmarshal(failedEncoded, &failedKeys)
	completedSet, failedSet := map[string]bool{}, map[string]bool{}
	for _, key := range completedKeys {
		completedSet[key] = true
	}
	for _, key := range failedKeys {
		failedSet[key] = true
	}
	for key, completion := range embeddings {
		storedKey := reindexStorageKey(key)
		a, ok := allowed[key]
		if !ok {
			return nil, errors.New("unexpected reindex asset")
		}
		vector, vectorErr := smartLibraryVector(completion.Embedding)
		if vectorErr != nil {
			return nil, vectorErr
		}
		metadataRefresh := completion.Description != ""
		tags, _ := json.Marshal(completion.Tags)
		collections, _ := json.Marshal(completion.Collections)
		metadata, _ := json.Marshal(completion.Metadata)
		result, execErr := tx.Exec(`UPDATE smart_library_assets SET
			semantic_embedding=$1::vector,embedding_model=$2,embedding_version=$3,embedding_input_hash=$4,embedded_at=NOW(),
			description=CASE WHEN $5 THEN $6 ELSE description END,
			tags=CASE WHEN $5 THEN $7::jsonb ELSE tags END,
			collections=CASE WHEN $5 THEN $8::jsonb ELSE collections END,
			confidence=CASE WHEN $5 THEN $9 ELSE confidence END,
			model=CASE WHEN $5 THEN $10 ELSE model END,
			metadata=CASE WHEN $5 THEN $11::jsonb ELSE metadata END,
			result_sequence=CASE WHEN $5 THEN nextval('smart_library_result_sequence') ELSE result_sequence END,
			analyzed_at=CASE WHEN $5 THEN NOW() ELSE analyzed_at END,
			index_status='indexed',index_failure_code=NULL,index_claim_token=NULL,index_claimed_at=NULL,updated_at=NOW()
			WHERE user_id=$12 AND folder_id=$13 AND asset_id=$14 AND fingerprint=$15 AND index_status='processing' AND index_claim_token=$16`,
			vector, job.Model, job.Version, completion.EmbeddingInputHash,
			metadataRefresh, completion.Description, tags, collections, completion.Confidence,
			completion.Model, metadata,
			userID, a.FolderID, a.AssetID, a.Fingerprint, job.ID)
		if execErr != nil {
			return nil, execErr
		}
		n, _ := result.RowsAffected()
		indexed := n == 1
		if !indexed {
			_ = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM smart_library_assets WHERE user_id=$1 AND folder_id=$2 AND asset_id=$3 AND fingerprint=$4 AND embedding_model=$5 AND embedding_version=$6 AND index_status='indexed')`, userID, a.FolderID, a.AssetID, a.Fingerprint, job.Model, job.Version).Scan(&indexed)
		}
		if indexed || completedSet[storedKey] {
			completedSet[storedKey] = true
			delete(failedSet, storedKey)
		}
	}
	for key, code := range failures {
		storedKey := reindexStorageKey(key)
		a, ok := allowed[key]
		if !ok {
			return nil, errors.New("unexpected reindex failure")
		}
		result, execErr := tx.Exec(`UPDATE smart_library_assets SET index_status='failed',index_failure_code=$1,index_claim_token=NULL,index_claimed_at=NULL,updated_at=NOW() WHERE user_id=$2 AND folder_id=$3 AND asset_id=$4 AND fingerprint=$5 AND index_status='processing' AND index_claim_token=$6`, code, userID, a.FolderID, a.AssetID, a.Fingerprint, job.ID)
		if execErr != nil {
			return nil, execErr
		}
		n, _ := result.RowsAffected()
		if (n == 1 || failedSet[storedKey]) && !completedSet[storedKey] {
			failedSet[storedKey] = true
		}
	}
	completedKeys = completedKeys[:0]
	for key := range completedSet {
		completedKeys = append(completedKeys, key)
	}
	failedKeys = failedKeys[:0]
	for key := range failedSet {
		failedKeys = append(failedKeys, key)
	}
	job.Completed = len(completedKeys)
	job.Failed = len(failedKeys)
	completedEncoded, _ = json.Marshal(completedKeys)
	failedEncoded, _ = json.Marshal(failedKeys)
	job.Status = "processing"
	if job.Completed+job.Failed >= job.Requested {
		job.Status = "completed"
		if job.Failed > 0 {
			job.Status = "partially_failed"
		}
	}
	if _, err = tx.Exec(`UPDATE smart_library_reindex_jobs SET status=$1,completed_assets=$2,failed_assets=$3,completed_asset_ids=$4,failed_asset_ids=$5,updated_at=NOW() WHERE id=$6`, job.Status, job.Completed, job.Failed, completedEncoded, failedEncoded, job.ID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &job, nil
}

func (db *Database) SmartLibraryBatches(userID, folderID string) ([]SmartLibraryBatch, error) {
	if _, err := db.SmartLibraryFolder(userID, folderID); err != nil {
		return nil, err
	}
	batches := []SmartLibraryBatch{}
	err := db.smartLibraryRows(`SELECT id,kind,status,asset_ids,successful_images,failed_images FROM smart_library_batches WHERE folder_id=$1 ORDER BY created_at`, []any{folderID}, func(rows *sql.Rows) error {
		for rows.Next() {
			var batch SmartLibraryBatch
			var ids []byte
			if err := rows.Scan(&batch.ID, &batch.Kind, &batch.Status, &ids, &batch.SuccessfulImages, &batch.FailedImages); err != nil {
				return err
			}
			_ = json.Unmarshal(ids, &batch.AssetIDs)
			batches = append(batches, batch)
		}
		return rows.Err()
	})
	return batches, err
}

func (db *Database) SmartLibrarySampleAssetIDs(userID, folderID string) ([]string, error) {
	if _, err := db.SmartLibraryFolder(userID, folderID); err != nil {
		return nil, err
	}
	ids := []string{}
	err := db.smartLibraryRows(`SELECT asset_id FROM smart_library_assets WHERE folder_id=$1 AND sample_eligible=TRUE ORDER BY asset_id`, []any{folderID}, func(rows *sql.Rows) error {
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	return ids, err
}

func (db *Database) RecoverStaleSmartLibraryBatches(userID, folderID string) error {
	tx, err := db.beginSmartLibraryTx()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`UPDATE smart_library_assets a SET status='pending',updated_at=NOW() FROM smart_library_batches b,smart_library_folders f WHERE b.folder_id=a.folder_id AND f.id=b.folder_id AND f.user_id=$1 AND f.id=$2 AND b.status='processing' AND b.updated_at<NOW()-INTERVAL '15 minutes' AND b.asset_ids ? a.asset_id AND a.status='processing'`, userID, folderID); err != nil {
		return err
	}
	result, err := tx.Exec(`UPDATE smart_library_batches b SET status='failed',updated_at=NOW() FROM smart_library_folders f WHERE f.id=b.folder_id AND f.user_id=$1 AND f.id=$2 AND b.status='processing' AND b.updated_at<NOW()-INTERVAL '15 minutes'`, userID, folderID)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count > 0 {
		if _, err = tx.Exec(`UPDATE smart_library_folders SET state=CASE WHEN EXISTS(SELECT 1 FROM smart_library_assets WHERE folder_id=$1 AND status='analyzed') THEN 'sample_review' ELSE 'preflight' END,updated_at=NOW() WHERE id=$1 AND user_id=$2`, folderID, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (db *Database) DeleteSmartLibraryFolder(userID, folderID string) error {
	result, err := db.smartLibraryExec(`DELETE FROM smart_library_folders WHERE id=$1 AND user_id=$2`, folderID, userID)
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

func (db *Database) beginSmartLibraryTx() (*sql.Tx, error) {
	if db.Conn == nil {
		return nil, errors.New("database unavailable")
	}
	tx, err := db.Conn.Begin()
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(`SELECT set_config($1,$2,true)`, rlsModeSetting, rlsModeService); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

func (db *Database) smartLibraryScan(query string, args []any, destinations ...any) error {
	return db.withRLSContext(context.Background(), serviceRLSSettings(), func(tx *sql.Tx) error {
		return tx.QueryRow(query, args...).Scan(destinations...)
	})
}

func (db *Database) smartLibraryExec(query string, args ...any) (sql.Result, error) {
	var result sql.Result
	err := db.withRLSContext(context.Background(), serviceRLSSettings(), func(tx *sql.Tx) error {
		var err error
		result, err = tx.Exec(query, args...)
		return err
	})
	return result, err
}

func (db *Database) smartLibraryRows(query string, args []any, visit func(*sql.Rows) error) error {
	return db.withRLSContext(context.Background(), serviceRLSSettings(), func(tx *sql.Tx) error {
		rows, err := tx.Query(query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		return visit(rows)
	})
}

func normalizedAssetType(kind, mimeType, extension string) (string, string) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if mimeType == "" {
		switch strings.ToLower(strings.TrimPrefix(extension, ".")) {
		case "jpg", "jpeg":
			mimeType = "image/jpeg"
		case "png":
			mimeType = "image/png"
		case "pdf":
			mimeType = "application/pdf"
		case "txt", "md":
			mimeType = "text/plain"
		default:
			mimeType = "application/octet-stream"
		}
	}
	if strings.HasPrefix(mimeType, "video/") || kind == "video" {
		return "binary", "application/octet-stream"
	}
	switch kind {
	case "image", "document", "text", "audio", "archive", "binary":
	default:
		switch {
		case strings.HasPrefix(mimeType, "image/"):
			kind = "image"
		case mimeType == "application/pdf" || strings.Contains(mimeType, "document"):
			kind = "document"
		case strings.HasPrefix(mimeType, "text/"):
			kind = "text"
		case strings.HasPrefix(mimeType, "audio/"):
			kind = "audio"
		case strings.Contains(mimeType, "zip") || strings.Contains(mimeType, "archive") || strings.Contains(mimeType, "compressed"):
			kind = "archive"
		default:
			kind = "binary"
		}
	}
	return kind, mimeType
}

func smartLibraryVector(values []float64) (string, error) {
	if len(values) != 768 {
		return "", fmt.Errorf("smart library embedding has %d dimensions, expected 768", len(values))
	}
	var builder strings.Builder
	builder.Grow(len(values) * 10)
	builder.WriteByte('[')
	for index, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return "", errors.New("smart library embedding contains a non-finite value")
		}
		if index > 0 {
			builder.WriteByte(',')
		}
		builder.WriteString(strconv.FormatFloat(value, 'g', -1, 64))
	}
	builder.WriteByte(']')
	return builder.String(), nil
}

func reindexStorageKey(value string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(value))) }

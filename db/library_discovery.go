package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/lib/pq"
)

var libraryMemoryIDPattern = regexp.MustCompile(`^\d{4}-\d{2}$`)
var libraryDayIDPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
var libraryYearIDPattern = regexp.MustCompile(`^\d{4}$`)
var libraryMapIDPattern = regexp.MustCompile(`^-?\d{1,3}(?:\.\d{1,6})?,-?\d{1,3}(?:\.\d{1,6})?$`)

type LibraryDiscoveryGroup struct {
	ID                string     `json:"id"`
	Kind              string     `json:"kind"`
	Title             string     `json:"title"`
	Subtitle          string     `json:"subtitle"`
	CoverItemID       string     `json:"cover_item_id,omitempty"`
	ItemCount         int        `json:"item_count"`
	StartAt           *time.Time `json:"start_at,omitempty"`
	EndAt             *time.Time `json:"end_at,omitempty"`
	MusicItemID       string     `json:"music_item_id,omitempty"`
	PlaybackSeconds   float64    `json:"playback_seconds,omitempty"`
	PreferenceVersion int64      `json:"preference_version,omitempty"`
}

type LibraryDiscovery struct {
	RecentDays []LibraryDiscoveryGroup `json:"recent_days"`
	Months     []LibraryDiscoveryGroup `json:"months"`
	Years      []LibraryDiscoveryGroup `json:"years"`
	Memories   []LibraryDiscoveryGroup `json:"memories"`
	Trips      []LibraryDiscoveryGroup `json:"trips"`
	Duplicates []LibraryDiscoveryGroup `json:"duplicates"`
	MapPoints  []LibraryMapPoint       `json:"map_points"`
}

type LibraryMapPoint struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	ItemCount   int     `json:"item_count"`
	CoverItemID string  `json:"cover_item_id,omitempty"`
}

func (db *Database) LibraryDiscovery(ctx context.Context, userID, spaceID string) (*LibraryDiscovery, error) {
	out := &LibraryDiscovery{RecentDays: []LibraryDiscoveryGroup{}, Months: []LibraryDiscoveryGroup{}, Years: []LibraryDiscoveryGroup{}, Memories: []LibraryDiscoveryGroup{}, Trips: []LibraryDiscoveryGroup{}, Duplicates: []LibraryDiscoveryGroup{}, MapPoints: []LibraryMapPoint{}}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		dayRows, err := tx.QueryContext(ctx, `SELECT to_char(bucket,'YYYY-MM-DD'),bucket,max(captured_at),(array_agg(id ORDER BY captured_at DESC,id))[1],count(*)
			FROM (SELECT i.id,date_trunc('day',COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)) bucket,COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) captured_at
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE) visible
			GROUP BY bucket ORDER BY bucket DESC LIMIT 30`, spaceID)
		if err != nil {
			return err
		}
		for dayRows.Next() {
			var group LibraryDiscoveryGroup
			var start, end time.Time
			if err := dayRows.Scan(&group.ID, &start, &end, &group.CoverItemID, &group.ItemCount); err != nil {
				_ = dayRows.Close()
				return err
			}
			group.Kind, group.Title, group.Subtitle, group.StartAt, group.EndAt = "day", start.Format("Monday, January 2"), fmt.Sprintf("%d items", group.ItemCount), &start, &end
			out.RecentDays = append(out.RecentDays, group)
		}
		if err := dayRows.Close(); err != nil {
			return err
		}

		monthRows, err := tx.QueryContext(ctx, `SELECT to_char(bucket,'YYYY-MM'),bucket,max(captured_at),(array_agg(id ORDER BY captured_at DESC,id))[1],count(*)
			FROM (SELECT i.id,date_trunc('month',COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)) bucket,COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) captured_at
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE) visible
			GROUP BY bucket ORDER BY bucket DESC LIMIT 120`, spaceID)
		if err != nil {
			return err
		}
		for monthRows.Next() {
			var group LibraryDiscoveryGroup
			var start, end time.Time
			if err := monthRows.Scan(&group.ID, &start, &end, &group.CoverItemID, &group.ItemCount); err != nil {
				_ = monthRows.Close()
				return err
			}
			group.Kind, group.Title, group.Subtitle, group.StartAt, group.EndAt = "month", start.Format("January 2006"), fmt.Sprintf("%d items", group.ItemCount), &start, &end
			out.Months = append(out.Months, group)
		}
		if err := monthRows.Close(); err != nil {
			return err
		}

		yearRows, err := tx.QueryContext(ctx, `SELECT to_char(bucket,'YYYY'),bucket,max(captured_at),(array_agg(id ORDER BY captured_at DESC,id))[1],count(*)
			FROM (SELECT i.id,date_trunc('year',COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)) bucket,COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) captured_at
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE) visible
			GROUP BY bucket ORDER BY bucket DESC LIMIT 100`, spaceID)
		if err != nil {
			return err
		}
		for yearRows.Next() {
			var group LibraryDiscoveryGroup
			var start, end time.Time
			if err := yearRows.Scan(&group.ID, &start, &end, &group.CoverItemID, &group.ItemCount); err != nil {
				_ = yearRows.Close()
				return err
			}
			group.Kind, group.Title, group.Subtitle, group.StartAt, group.EndAt = "year", start.Format("2006"), fmt.Sprintf("%d items", group.ItemCount), &start, &end
			out.Years = append(out.Years, group)
		}
		if err := yearRows.Close(); err != nil {
			return err
		}

		memoryRows, err := tx.QueryContext(ctx, `SELECT to_char(bucket,'YYYY-MM'),bucket,max(captured_at),(array_agg(id ORDER BY captured_at DESC,id))[1],count(*)
			FROM (SELECT i.id,date_trunc('month',COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)) bucket,COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) captured_at
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE) visible
			GROUP BY bucket HAVING count(*)>=2 ORDER BY bucket DESC LIMIT 24`, spaceID)
		if err != nil {
			return err
		}
		for memoryRows.Next() {
			var group LibraryDiscoveryGroup
			var start, end time.Time
			if err := memoryRows.Scan(&group.ID, &start, &end, &group.CoverItemID, &group.ItemCount); err != nil {
				_ = memoryRows.Close()
				return err
			}
			group.Kind, group.Title, group.Subtitle, group.StartAt, group.EndAt = "memory", start.Format("January 2006"), fmt.Sprintf("%d items", group.ItemCount), &start, &end
			out.Memories = append(out.Memories, group)
		}
		if err := memoryRows.Close(); err != nil {
			return err
		}
		preferenceRows, err := tx.QueryContext(ctx, `SELECT memory_id,title,COALESCE(cover_item_id,''),COALESCE(music_item_id,''),playback_seconds,version FROM space_memory_preferences WHERE space_id=$1`, spaceID)
		if err != nil {
			return err
		}
		for preferenceRows.Next() {
			var memoryID, title, coverItemID, musicItemID string
			var playbackSeconds float64
			var version int64
			if err := preferenceRows.Scan(&memoryID, &title, &coverItemID, &musicItemID, &playbackSeconds, &version); err != nil {
				_ = preferenceRows.Close()
				return err
			}
			for index := range out.Memories {
				if out.Memories[index].ID != memoryID {
					continue
				}
				if title != "" {
					out.Memories[index].Title = title
				}
				if coverItemID != "" {
					out.Memories[index].CoverItemID = coverItemID
				}
				out.Memories[index].MusicItemID = musicItemID
				out.Memories[index].PlaybackSeconds = playbackSeconds
				out.Memories[index].PreferenceVersion = version
				break
			}
		}
		if err := preferenceRows.Close(); err != nil {
			return err
		}

		tripRows, err := tx.QueryContext(ctx, `SELECT COALESCE(i.location_override,f.intrinsic_location)->>'name',min(COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)),max(COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)),(array_agg(i.id ORDER BY COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) DESC,i.id))[1],count(*)
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id
			WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE AND length(trim(COALESCE(COALESCE(i.location_override,f.intrinsic_location)->>'name','')))>0
			GROUP BY lower(COALESCE(i.location_override,f.intrinsic_location)->>'name'),COALESCE(i.location_override,f.intrinsic_location)->>'name' HAVING count(*)>=2 ORDER BY max(COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)) DESC LIMIT 24`, spaceID)
		if err != nil {
			return err
		}
		for tripRows.Next() {
			var group LibraryDiscoveryGroup
			var start, end time.Time
			if err := tripRows.Scan(&group.ID, &start, &end, &group.CoverItemID, &group.ItemCount); err != nil {
				_ = tripRows.Close()
				return err
			}
			group.Kind, group.Title, group.Subtitle, group.StartAt, group.EndAt = "trip", group.ID, libraryDateRange(start, end), &start, &end
			out.Trips = append(out.Trips, group)
		}
		if err := tripRows.Close(); err != nil {
			return err
		}

		mapRows, err := tx.QueryContext(ctx, `SELECT round((COALESCE(i.location_override,f.intrinsic_location)->>'latitude')::numeric,2)::float8,round((COALESCE(i.location_override,f.intrinsic_location)->>'longitude')::numeric,2)::float8,COALESCE(NULLIF(max(COALESCE(i.location_override,f.intrinsic_location)->>'name'),''),'Saved location'),(array_agg(i.id ORDER BY COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) DESC,i.id))[1],count(*)
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id
			WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE
			AND jsonb_typeof(COALESCE(i.location_override,f.intrinsic_location)->'latitude')='number' AND jsonb_typeof(COALESCE(i.location_override,f.intrinsic_location)->'longitude')='number'
			AND (COALESCE(i.location_override,f.intrinsic_location)->>'latitude')::numeric BETWEEN -90 AND 90 AND (COALESCE(i.location_override,f.intrinsic_location)->>'longitude')::numeric BETWEEN -180 AND 180
			GROUP BY round((COALESCE(i.location_override,f.intrinsic_location)->>'latitude')::numeric,2),round((COALESCE(i.location_override,f.intrinsic_location)->>'longitude')::numeric,2)
			ORDER BY count(*) DESC,max(COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)) DESC LIMIT 500`, spaceID)
		if err != nil {
			return err
		}
		for mapRows.Next() {
			var point LibraryMapPoint
			if err := mapRows.Scan(&point.Latitude, &point.Longitude, &point.Name, &point.CoverItemID, &point.ItemCount); err != nil {
				_ = mapRows.Close()
				return err
			}
			point.ID = fmt.Sprintf("%.2f,%.2f", point.Latitude, point.Longitude)
			out.MapPoints = append(out.MapPoints, point)
		}
		if err := mapRows.Close(); err != nil {
			return err
		}

		duplicateRows, err := tx.QueryContext(ctx, `SELECT min(i.id),min(i.id),(array_agg(i.id ORDER BY i.added_at DESC,i.id))[1],count(*)
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id
			WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE
			GROUP BY f.blob_id HAVING count(*)>1 ORDER BY count(*) DESC,max(i.added_at) DESC LIMIT 100`, spaceID)
		if err != nil {
			return err
		}
		for duplicateRows.Next() {
			var group LibraryDiscoveryGroup
			if err := duplicateRows.Scan(&group.ID, &group.Title, &group.CoverItemID, &group.ItemCount); err != nil {
				_ = duplicateRows.Close()
				return err
			}
			group.Kind, group.Title, group.Subtitle = "duplicate", "Duplicates", fmt.Sprintf("%d matching items", group.ItemCount)
			out.Duplicates = append(out.Duplicates, group)
		}
		return duplicateRows.Close()
	})
	return out, err
}

func (db *Database) UpdateLibraryMemoryPreference(ctx context.Context, userID, spaceID, memoryID string, version int64, title, coverItemID, musicItemID string, playbackSeconds float64) error {
	title, coverItemID, musicItemID = strings.TrimSpace(title), strings.TrimSpace(coverItemID), strings.TrimSpace(musicItemID)
	if !libraryMemoryIDPattern.MatchString(memoryID) || version < 0 || len([]rune(title)) > 160 || playbackSeconds < 1 || playbackSeconds > 15 {
		return ErrLibraryInvalid
	}
	start, _ := time.Parse("2006-01", memoryID)
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		if coverItemID != "" {
			var valid bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_library_items i JOIN library_files f ON f.id=i.file_id WHERE i.id=$1 AND i.space_id=$2 AND i.lifecycle_state='ready' AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)>=$3 AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)<$4)`, coverItemID, spaceID, start, start.AddDate(0, 1, 0)).Scan(&valid); err != nil || !valid {
				return ErrLibraryInvalid
			}
		}
		if musicItemID != "" {
			var valid bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_library_items i JOIN library_files f ON f.id=i.file_id JOIN library_blobs b ON b.id=f.blob_id WHERE i.id=$1 AND i.space_id=$2 AND i.lifecycle_state='ready' AND b.server_detected_mime_type LIKE 'audio/%')`, musicItemID, spaceID).Scan(&valid); err != nil || !valid {
				return ErrLibraryInvalid
			}
		}
		var cover, music any
		if coverItemID != "" {
			cover = coverItemID
		}
		if musicItemID != "" {
			music = musicItemID
		}
		if version == 0 {
			result, err := tx.ExecContext(ctx, `INSERT INTO space_memory_preferences(space_id,memory_id,title,cover_item_id,music_item_id,playback_seconds,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, spaceID, memoryID, title, cover, music, playbackSeconds, userID)
			if err != nil {
				return err
			}
			if count, _ := result.RowsAffected(); count == 0 {
				return ErrLibraryConflict
			}
		} else {
			result, err := tx.ExecContext(ctx, `UPDATE space_memory_preferences SET title=$1,cover_item_id=$2,music_item_id=$3,playback_seconds=$4,updated_by_user_id=$5,version=version+1,updated_at=NOW() WHERE space_id=$6 AND memory_id=$7 AND version=$8`, title, cover, music, playbackSeconds, userID, spaceID, memoryID, version)
			if err != nil {
				return err
			}
			if count, _ := result.RowsAffected(); count == 0 {
				return ErrLibraryConflict
			}
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.memory.updated", "memory", memoryID, "success", map[string]any{"music": musicItemID != "", "playback_seconds": playbackSeconds})
	})
}

func (db *Database) LibraryDiscoveryItems(ctx context.Context, userID, spaceID, kind, groupID string) ([]SpaceLibraryItem, error) {
	if groupID == "" || (kind != "day" && kind != "month" && kind != "year" && kind != "memory" && kind != "trip" && kind != "duplicate" && kind != "map") {
		return nil, ErrLibraryInvalid
	}
	items := []SpaceLibraryItem{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		statement, args := "", []any{spaceID}
		switch kind {
		case "day":
			if !libraryDayIDPattern.MatchString(groupID) {
				return ErrLibraryInvalid
			}
			start, err := time.Parse("2006-01-02", groupID)
			if err != nil {
				return ErrLibraryInvalid
			}
			statement = libraryItemSelect + ` WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)>=$2 AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)<$3 ORDER BY COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) DESC,i.id`
			args = append(args, start, start.AddDate(0, 0, 1))
		case "month":
			if !libraryMemoryIDPattern.MatchString(groupID) {
				return ErrLibraryInvalid
			}
			start, err := time.Parse("2006-01", groupID)
			if err != nil {
				return ErrLibraryInvalid
			}
			statement = libraryItemSelect + ` WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)>=$2 AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)<$3 ORDER BY COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) DESC,i.id`
			args = append(args, start, start.AddDate(0, 1, 0))
		case "year":
			if !libraryYearIDPattern.MatchString(groupID) {
				return ErrLibraryInvalid
			}
			start, err := time.Parse("2006", groupID)
			if err != nil {
				return ErrLibraryInvalid
			}
			statement = libraryItemSelect + ` WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)>=$2 AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)<$3 ORDER BY COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) DESC,i.id`
			args = append(args, start, start.AddDate(1, 0, 0))
		case "memory":
			if !libraryMemoryIDPattern.MatchString(groupID) {
				return ErrLibraryInvalid
			}
			start, err := time.Parse("2006-01", groupID)
			if err != nil {
				return ErrLibraryInvalid
			}
			statement = libraryItemSelect + ` WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)>=$2 AND COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)<$3 ORDER BY COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) DESC,i.id`
			args = append(args, start, start.AddDate(0, 1, 0))
		case "trip":
			if len([]rune(groupID)) > 200 {
				return ErrLibraryInvalid
			}
			statement = libraryItemSelect + ` WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE AND lower(COALESCE(COALESCE(i.location_override,f.intrinsic_location)->>'name',''))=lower($2) ORDER BY COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) DESC,i.id`
			args = append(args, strings.TrimSpace(groupID))
		case "duplicate":
			statement = libraryItemSelect + ` WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE AND f.blob_id=(SELECT anchor_file.blob_id FROM space_library_items anchor JOIN library_files anchor_file ON anchor_file.id=anchor.file_id WHERE anchor.id=$2 AND anchor.space_id=$1 AND anchor.lifecycle_state='ready') ORDER BY i.added_at DESC,i.id`
			args = append(args, groupID)
		case "map":
			if !libraryMapIDPattern.MatchString(groupID) {
				return ErrLibraryInvalid
			}
			coordinates := strings.Split(groupID, ",")
			statement = libraryItemSelect + ` WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND i.hidden=FALSE
				AND jsonb_typeof(COALESCE(i.location_override,f.intrinsic_location)->'latitude')='number' AND jsonb_typeof(COALESCE(i.location_override,f.intrinsic_location)->'longitude')='number'
				AND round((COALESCE(i.location_override,f.intrinsic_location)->>'latitude')::numeric,2)=round($2::numeric,2) AND round((COALESCE(i.location_override,f.intrinsic_location)->>'longitude')::numeric,2)=round($3::numeric,2)
				ORDER BY COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at) DESC,i.id`
			args = append(args, coordinates[0], coordinates[1])
		}
		rows, err := tx.QueryContext(ctx, statement, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceLibraryItem
			if err := scanSpaceLibraryItem(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	if err == nil && len(items) == 0 {
		return nil, ErrLibraryNotFound
	}
	return items, err
}

func libraryDateRange(start, end time.Time) string {
	if start.Format("2006-01-02") == end.Format("2006-01-02") {
		return start.Format("Jan 2, 2006")
	}
	return start.Format("Jan 2, 2006") + " – " + end.Format("Jan 2, 2006")
}

func (db *Database) MergeLibraryDuplicates(ctx context.Context, userID, spaceID string, keeper LibraryItemVersion, duplicates []LibraryItemVersion) (*SpaceLibraryItem, error) {
	all := append([]LibraryItemVersion{keeper}, duplicates...)
	if keeper.ID == "" || keeper.Version < 1 || len(duplicates) < 1 || len(duplicates) > 99 {
		return nil, ErrLibraryInvalid
	}
	versions, ids := map[string]int64{}, make([]string, 0, len(all))
	for _, item := range all {
		if item.ID == "" || item.Version < 1 || versions[item.ID] != 0 {
			return nil, ErrLibraryInvalid
		}
		versions[item.ID], ids = item.Version, append(ids, item.ID)
	}
	duplicateIDs := ids[1:]
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT i.id,i.version,i.lifecycle_state,f.blob_id FROM space_library_items i JOIN library_files f ON f.id=i.file_id WHERE i.space_id=$1 AND i.id=ANY($2) FOR UPDATE OF i`, spaceID, pq.Array(ids))
		if err != nil {
			return err
		}
		found, blobID := 0, ""
		for rows.Next() {
			var id, state, candidateBlobID string
			var version int64
			if err := rows.Scan(&id, &version, &state, &candidateBlobID); err != nil {
				_ = rows.Close()
				return err
			}
			if versions[id] != version || state != "ready" {
				_ = rows.Close()
				return ErrLibraryConflict
			}
			if blobID != "" && blobID != candidateBlobID {
				_ = rows.Close()
				return ErrLibraryInvalid
			}
			blobID, found = candidateBlobID, found+1
		}
		if err := rows.Close(); err != nil {
			return err
		}
		if found != len(ids) {
			return ErrLibraryNotFound
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_library_items keeper SET
			favorite=(SELECT bool_or(candidate.favorite) FROM space_library_items candidate WHERE candidate.id=ANY($1)),
			tags=(SELECT COALESCE(jsonb_agg(tag ORDER BY lower(tag)),'[]'::jsonb) FROM (SELECT DISTINCT tag FROM space_library_items candidate CROSS JOIN LATERAL jsonb_array_elements_text(candidate.tags) tag WHERE candidate.id=ANY($1)) merged_tags),
			caption=COALESCE(NULLIF(keeper.caption,''),(SELECT NULLIF(candidate.caption,'') FROM space_library_items candidate WHERE candidate.id=ANY($1) AND candidate.caption<>'' ORDER BY candidate.added_at LIMIT 1),''),
			date_override=COALESCE(keeper.date_override,(SELECT min(candidate.date_override) FROM space_library_items candidate WHERE candidate.id=ANY($1))),
			location_override=COALESCE(keeper.location_override,(SELECT candidate.location_override FROM space_library_items candidate WHERE candidate.id=ANY($1) AND candidate.location_override IS NOT NULL ORDER BY candidate.added_at LIMIT 1)),
			version=keeper.version+1,updated_at=NOW() WHERE keeper.id=$2 AND keeper.space_id=$3`, pq.Array(ids), keeper.ID, spaceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_album_items(album_id,space_library_item_id,added_by_user_id,position,added_at) SELECT album_id,$1,$2,min(position),min(added_at) FROM space_album_items WHERE space_library_item_id=ANY($3) GROUP BY album_id ON CONFLICT(album_id,space_library_item_id) DO NOTHING`, keeper.ID, userID, pq.Array(duplicateIDs)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_message_library_references(message_id,space_id,space_library_item_id,created_by_user_id,created_at) SELECT message_id,space_id,$1,created_by_user_id,min(created_at) FROM space_message_library_references WHERE space_library_item_id=ANY($2) GROUP BY message_id,space_id,created_by_user_id ON CONFLICT(message_id,space_library_item_id) DO NOTHING`, keeper.ID, pq.Array(duplicateIDs)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_person_observations(id,person_id,space_library_item_id,derivative_id,confidence,bounds,source,created_at) SELECT 'observation_'||replace(gen_random_uuid()::text,'-',''),person_id,$1,derivative_id,confidence,bounds,source,created_at FROM space_person_observations WHERE space_library_item_id=ANY($2) ON CONFLICT(person_id,space_library_item_id,derivative_id) DO NOTHING`, keeper.ID, pq.Array(duplicateIDs)); err != nil {
			return err
		}
		for _, statement := range []string{
			`DELETE FROM space_album_items WHERE space_library_item_id=ANY($1)`,
			`DELETE FROM space_message_library_references WHERE space_library_item_id=ANY($1)`,
			`DELETE FROM space_person_observations WHERE space_library_item_id=ANY($1)`,
		} {
			if _, err := tx.ExecContext(ctx, statement, pq.Array(duplicateIDs)); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_library_items SET lifecycle_state='trash',trashed_at=NOW(),recover_until=NOW()+INTERVAL '30 days',version=version+1,updated_at=NOW() WHERE space_id=$1 AND id=ANY($2)`, spaceID, pq.Array(duplicateIDs)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_storage_contributions SET state='recovery',updated_at=NOW() WHERE space_id=$1 AND source_kind='library_item' AND source_id=ANY($2) AND state='active'`, spaceID, pq.Array(duplicateIDs)); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.duplicates.merged", "library_item", keeper.ID, "success", map[string]any{"merged_count": len(duplicateIDs)})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryItem(ctx, userID, spaceID, keeper.ID)
}

func mapDiscoveryError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrLibraryNotFound
	}
	return err
}

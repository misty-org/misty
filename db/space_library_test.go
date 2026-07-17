package db

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestLibraryQuotaUploadDedupAndAttachmentPromotion(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Library Owner", "library-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	spaces, err := database.ListSpaces(ctx, owner.ID)
	if err != nil || len(spaces) != 1 {
		t.Fatalf("ListSpaces() = %#v, %v", spaces, err)
	}
	spaceID := spaces[0].ID
	digest := strings.Repeat("a", 64)

	upload, err := database.CreateLibraryUpload(ctx, owner.ID, spaceID, "library", "first.txt", "text/plain", 100, digest, "library/firstobject", "token-1", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("CreateLibraryUpload() error = %v", err)
	}
	usage, _ := database.SpaceStorageUsage(ctx, owner.ID, spaceID)
	if usage.ReservedBytes != 100 || usage.UsedBytes != 0 {
		t.Fatalf("reserved usage = %#v", usage)
	}
	if _, err := database.SetLibraryUploadState(ctx, owner.ID, spaceID, upload.ID, "token-1", "initiated", "uploaded_unverified"); err != nil {
		t.Fatal(err)
	}
	completed, err := database.CompleteLibraryUpload(ctx, owner.ID, spaceID, upload.ID, "token-1", 100, digest, "text/plain; charset=utf-8", nil)
	if err != nil || completed.Item == nil {
		t.Fatalf("CompleteLibraryUpload() = %#v, %v", completed, err)
	}
	usage, _ = database.SpaceStorageUsage(ctx, owner.ID, spaceID)
	if usage.ReservedBytes != 0 || usage.UsedBytes != 100 {
		t.Fatalf("finalized usage = %#v", usage)
	}

	attachmentUpload, err := database.CreateLibraryUpload(ctx, owner.ID, spaceID, "attachment", "second.txt", "text/plain", 100, digest, "library/secondobject", "token-2", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.SetLibraryUploadState(ctx, owner.ID, spaceID, attachmentUpload.ID, "token-2", "initiated", "uploaded_unverified"); err != nil {
		t.Fatal(err)
	}
	attachmentResult, err := database.CompleteLibraryUpload(ctx, owner.ID, spaceID, attachmentUpload.ID, "token-2", 100, digest, "text/plain; charset=utf-8", nil)
	if err != nil || attachmentResult.Attachment == nil || attachmentResult.DiscardObjectKey != "library/secondobject" {
		t.Fatalf("deduplicated attachment = %#v, %v", attachmentResult, err)
	}
	usage, _ = database.SpaceStorageUsage(ctx, owner.ID, spaceID)
	if usage.UsedBytes != 200 {
		t.Fatalf("two independent contributions = %#v", usage)
	}
	promoted, err := database.PromoteMessageAttachment(ctx, owner.ID, spaceID, attachmentResult.Attachment.ID)
	if err != nil {
		t.Fatalf("PromoteMessageAttachment() error = %v", err)
	}
	usage, _ = database.SpaceStorageUsage(ctx, owner.ID, spaceID)
	if usage.UsedBytes != 200 {
		t.Fatalf("promotion double-charged quota: %#v", usage)
	}
	message, _, err := database.CreateSpaceMessageWithReferences(ctx, owner.ID, spaceID, nil, nil, []string{attachmentResult.Attachment.ID}, []string{promoted.ID}, "")
	if err != nil {
		t.Fatalf("CreateSpaceMessageWithReferences(attachment-only) error = %v", err)
	}
	reply, _, err := database.CreateSpaceMessageWithReferences(ctx, owner.ID, spaceID, []MessageSpan{{Type: "text", Text: "reply"}}, nil, nil, nil, message.ID)
	if err != nil || reply.ReplyToMessageID != message.ID {
		t.Fatalf("reply = %#v, %v", reply, err)
	}
	messages, err := database.SpaceMessages(ctx, owner.ID, spaceID, 0, 20)
	if err != nil || len(messages) != 2 || len(messages[1].Attachments) != 1 || len(messages[1].LibraryItemIDs) != 1 {
		t.Fatalf("SpaceMessages() = %#v, %v", messages, err)
	}

	updated, err := database.UpdateLibraryItem(ctx, owner.ID, spaceID, completed.Item.ID, completed.Item.Version, completed.Item.DisplayName, "Red sunset over the water", []string{"travel", "coast"}, true, false)
	if err != nil {
		t.Fatalf("UpdateLibraryItem() error = %v", err)
	}
	searchResults, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Search: "sunset", Sort: "name", Direction: "asc"})
	if err != nil || len(searchResults) != 1 || searchResults[0].ID != updated.ID {
		t.Fatalf("search results = %#v, %v", searchResults, err)
	}
	favorites, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Favorite: true})
	if err != nil || len(favorites) != 1 || favorites[0].ID != updated.ID {
		t.Fatalf("favorite results = %#v, %v", favorites, err)
	}
	documents, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{MediaType: "document", Sort: "name", Direction: "asc"})
	if err != nil || len(documents) != 2 || documents[0].DisplayName != "first.txt" || documents[1].DisplayName != "second.txt" {
		t.Fatalf("document results = %#v, %v", documents, err)
	}
	updated, err = database.UpdateLibraryItem(ctx, owner.ID, spaceID, updated.ID, updated.Version, updated.DisplayName, updated.Caption, updated.Tags, updated.Favorite, true)
	if err != nil {
		t.Fatalf("hide item error = %v", err)
	}
	visible, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{})
	if err != nil || len(visible) != 1 || visible[0].ID != promoted.ID {
		t.Fatalf("visible results = %#v, %v", visible, err)
	}
	hidden, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Visibility: "hidden"})
	if err != nil || len(hidden) != 1 || hidden[0].ID != updated.ID {
		t.Fatalf("hidden results = %#v, %v", hidden, err)
	}

	bulkItems, err := database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "unhide", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}}})
	if err != nil || len(bulkItems) != 1 || bulkItems[0].Hidden {
		t.Fatalf("bulk unhide = %#v, %v", bulkItems, err)
	}
	updated = &bulkItems[0]
	if _, err := database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "unfavorite", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version + 99}}}); !errors.Is(err, ErrLibraryConflict) {
		t.Fatalf("stale bulk update error = %v, want ErrLibraryConflict", err)
	}
	favorites, err = database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Favorite: true})
	if err != nil || len(favorites) != 1 || favorites[0].ID != updated.ID {
		t.Fatalf("failed bulk operation was not atomic: %#v, %v", favorites, err)
	}
	metadataItems := []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "add_tags", Items: metadataItems, Tags: []string{"Summer", "Coast"}})
	if err != nil || len(bulkItems) != 2 || !containsString(bulkItems[0].Tags, "Summer") || !containsString(bulkItems[1].Tags, "Summer") {
		t.Fatalf("bulk add tags = %#v, %v", bulkItems, err)
	}
	updated, promoted = libraryItemsByID(t, bulkItems, updated.ID, promoted.ID)
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "remove_tags", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}, Tags: []string{"coast"}})
	if err != nil || containsString(bulkItems[0].Tags, "Coast") || containsString(bulkItems[1].Tags, "Coast") {
		t.Fatalf("bulk remove tags = %#v, %v", bulkItems, err)
	}
	updated, promoted = libraryItemsByID(t, bulkItems, updated.ID, promoted.ID)
	capturedAt := time.Date(2026, time.July, 4, 12, 30, 0, 0, time.UTC)
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "set_date", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}, DateOverride: &capturedAt})
	if err != nil || bulkItems[0].DateOverride == nil || !bulkItems[0].DateOverride.Equal(capturedAt) || bulkItems[1].DateOverride == nil || !bulkItems[1].DateOverride.Equal(capturedAt) {
		t.Fatalf("bulk set date = %#v, %v", bulkItems, err)
	}
	updated, promoted = libraryItemsByID(t, bulkItems, updated.ID, promoted.ID)
	location := json.RawMessage(`{"name":"Big Sur","latitude":36.2704,"longitude":-121.8079}`)
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "set_location", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}, LocationOverride: location})
	if err != nil || !strings.Contains(string(bulkItems[0].LocationOverride), "Big Sur") || !strings.Contains(string(bulkItems[1].LocationOverride), "Big Sur") {
		t.Fatalf("bulk set location = %#v, %v", bulkItems, err)
	}
	updated, promoted = libraryItemsByID(t, bulkItems, updated.ID, promoted.ID)
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "clear_date", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}})
	if err != nil || bulkItems[0].DateOverride != nil || bulkItems[1].DateOverride != nil {
		t.Fatalf("bulk clear date = %#v, %v", bulkItems, err)
	}
	updated, promoted = libraryItemsByID(t, bulkItems, updated.ID, promoted.ID)
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "clear_location", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}})
	if err != nil || string(bulkItems[0].LocationOverride) != "null" || string(bulkItems[1].LocationOverride) != "null" {
		t.Fatalf("bulk clear location = %#v, %v", bulkItems, err)
	}
	updated, promoted = libraryItemsByID(t, bulkItems, updated.ID, promoted.ID)
	album, err := database.CreateLibraryAlbum(ctx, owner.ID, spaceID, "Road trip", "")
	if err != nil {
		t.Fatal(err)
	}
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "add_to_album", AlbumID: album.ID, Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}})
	if err != nil || len(bulkItems) != 2 {
		t.Fatalf("bulk add to album = %#v, %v", bulkItems, err)
	}
	albumItems, err := database.LibraryAlbumItems(ctx, owner.ID, spaceID, album.ID, 10)
	if err != nil || len(albumItems) != 2 {
		t.Fatalf("album items = %#v, %v", albumItems, err)
	}
	album, err = database.LibraryAlbum(ctx, owner.ID, spaceID, album.ID)
	if err != nil {
		t.Fatal(err)
	}
	album, err = database.ReorderLibraryAlbumItems(ctx, owner.ID, spaceID, album.ID, album.Version, []string{promoted.ID, updated.ID})
	if err != nil {
		t.Fatalf("ReorderLibraryAlbumItems() error = %v", err)
	}
	albumItems, err = database.LibraryAlbumItems(ctx, owner.ID, spaceID, album.ID, 10)
	if err != nil || len(albumItems) != 2 || albumItems[0].ID != promoted.ID || albumItems[1].ID != updated.ID {
		t.Fatalf("reordered album items = %#v, %v", albumItems, err)
	}
	album, err = database.UpdateLibraryAlbum(ctx, owner.ID, spaceID, album.ID, album.Version, "Coastal road trip", "Summer favorites", promoted.ID)
	if err != nil || album.Name != "Coastal road trip" || album.CoverItemID != promoted.ID {
		t.Fatalf("UpdateLibraryAlbum() = %#v, %v", album, err)
	}
	structured, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Search: `tag:travel type:document album:"Coastal road trip" favorite:true after:2020-01-01`})
	if err != nil || len(structured) != 1 || structured[0].ID != updated.ID {
		t.Fatalf("structured search = %#v, %v", structured, err)
	}
	facets, err := database.LibraryFacets(ctx, owner.ID, spaceID, "")
	if err != nil || facets.Total != 2 || facets.Favorites != 1 || facets.Hidden != 0 || facets.RecentlyDeleted != 0 || len(facets.Tags) != 2 || len(facets.MediaTypes) != 1 || facets.MediaTypes[0].Value != "document" || len(facets.Albums) != 1 || facets.Albums[0].Count != 2 {
		t.Fatalf("LibraryFacets() = %#v, %v", facets, err)
	}
	albumFacets, err := database.LibraryFacets(ctx, owner.ID, spaceID, "coastal")
	if err != nil || len(albumFacets.Albums) != 1 || albumFacets.Albums[0].Value != album.ID {
		t.Fatalf("filtered LibraryFacets() = %#v, %v", albumFacets, err)
	}
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "set_date", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}, DateOverride: &capturedAt})
	if err != nil {
		t.Fatalf("prepare discovery dates: %v", err)
	}
	updated, promoted = libraryItemsByID(t, bulkItems, updated.ID, promoted.ID)
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "set_location", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}, LocationOverride: location})
	if err != nil {
		t.Fatalf("prepare discovery locations: %v", err)
	}
	updated, promoted = libraryItemsByID(t, bulkItems, updated.ID, promoted.ID)
	discovery, err := database.LibraryDiscovery(ctx, owner.ID, spaceID)
	if err != nil || len(discovery.RecentDays) != 1 || discovery.RecentDays[0].ItemCount != 2 || len(discovery.Months) != 1 || discovery.Months[0].ID != "2026-07" || len(discovery.Years) != 1 || discovery.Years[0].ID != "2026" || len(discovery.Memories) != 1 || discovery.Memories[0].ItemCount != 2 || len(discovery.Trips) != 1 || discovery.Trips[0].Title != "Big Sur" || len(discovery.MapPoints) != 1 || discovery.MapPoints[0].ItemCount != 2 || discovery.MapPoints[0].ID != "36.27,-121.81" || len(discovery.Duplicates) != 1 || discovery.Duplicates[0].ItemCount != 2 {
		t.Fatalf("LibraryDiscovery() = %#v, %v", discovery, err)
	}
	for _, target := range []struct{ kind, id string }{{"day", discovery.RecentDays[0].ID}, {"month", discovery.Months[0].ID}, {"year", discovery.Years[0].ID}, {"memory", discovery.Memories[0].ID}, {"trip", discovery.Trips[0].ID}, {"map", discovery.MapPoints[0].ID}, {"duplicate", discovery.Duplicates[0].ID}} {
		discoveryItems, itemErr := database.LibraryDiscoveryItems(ctx, owner.ID, spaceID, target.kind, target.id)
		if itemErr != nil || len(discoveryItems) != 2 {
			t.Fatalf("LibraryDiscoveryItems(%s) = %#v, %v", target.kind, discoveryItems, itemErr)
		}
	}
	transferItems, err := database.LibraryTransferItems(ctx, owner.ID, spaceID, []string{updated.ID, promoted.ID})
	if err != nil || len(transferItems) != 2 || transferItems[0].SHA256 != digest {
		t.Fatalf("LibraryTransferItems() = %#v, %v", transferItems, err)
	}
	if _, err := database.LibraryItemDownload(ctx, owner.ID, spaceID, updated.ID); err != nil {
		t.Fatalf("LibraryItemDownload(view tracking): %v", err)
	}
	viewed, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Utility: "recently-viewed"})
	if err != nil || len(viewed) != 1 || viewed[0].ID != updated.ID {
		t.Fatalf("recently viewed utility = %#v, %v", viewed, err)
	}
	facets, err = database.LibraryFacets(ctx, owner.ID, spaceID, "")
	if err != nil || libraryFacetCount(facets.Utilities, "recently-viewed") != 1 || libraryFacetCount(facets.Utilities, "documents") != 2 {
		t.Fatalf("utility facets = %#v, %v", facets.Utilities, err)
	}
	destination, err := database.CreateSpace(ctx, owner.ID, "Transfer destination")
	if err != nil {
		t.Fatalf("CreateSpace(transfer destination): %v", err)
	}
	shared, err := database.CreateLibraryGrant(ctx, owner.ID, spaceID, updated.ID, destination.ID)
	if err != nil || shared.SourceItemID != updated.ID || shared.DestinationSpaceID != destination.ID {
		t.Fatalf("CreateLibraryGrant() = %#v, %v", shared, err)
	}
	references, err := database.LibrarySharedReferences(ctx, owner.ID, destination.ID)
	if err != nil || len(references) != 1 || references[0].ID != shared.ID {
		t.Fatalf("LibrarySharedReferences() = %#v, %v", references, err)
	}
	sharedDownload, err := database.LibrarySharedReferenceDownload(ctx, owner.ID, destination.ID, shared.ID)
	if err != nil || sharedDownload.SHA256 != digest {
		t.Fatalf("LibrarySharedReferenceDownload() = %#v, %v", sharedDownload, err)
	}
	importUpload, err := database.CreateLibraryUpload(ctx, owner.ID, destination.ID, "library", "imported.txt", "text/plain", 100, digest, "library/importobject", "import-token", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("CreateLibraryUpload(import): %v", err)
	}
	if _, err := database.SetLibraryUploadState(ctx, owner.ID, destination.ID, importUpload.ID, "import-token", "initiated", "uploaded_unverified"); err != nil {
		t.Fatalf("SetLibraryUploadState(import): %v", err)
	}
	imported, err := database.CompleteLibraryUpload(ctx, owner.ID, destination.ID, importUpload.ID, "import-token", 100, digest, "text/plain; charset=utf-8", nil)
	if err != nil || imported.Item == nil {
		t.Fatalf("CompleteLibraryUpload(import) = %#v, %v", imported, err)
	}
	importRecord, err := database.RecordLibraryImport(ctx, owner.ID, spaceID, updated.ID, destination.ID, imported.Item.ID, importUpload.ID, 100)
	if err != nil || importRecord.State != "ready" || importRecord.DestinationItemID != imported.Item.ID {
		t.Fatalf("RecordLibraryImport() = %#v, %v", importRecord, err)
	}
	sourceHistory, err := database.LibraryImportHistory(ctx, owner.ID, spaceID, 10)
	if err != nil || len(sourceHistory) != 1 || sourceHistory[0].Direction != "outgoing" || sourceHistory[0].CounterpartSpaceName != destination.Name || sourceHistory[0].ItemID != updated.ID {
		t.Fatalf("source LibraryImportHistory() = %#v, %v", sourceHistory, err)
	}
	destinationHistory, err := database.LibraryImportHistory(ctx, owner.ID, destination.ID, 10)
	if err != nil || len(destinationHistory) != 1 || destinationHistory[0].Direction != "incoming" || destinationHistory[0].CounterpartSpaceName != spaces[0].Name || destinationHistory[0].ItemID != imported.Item.ID {
		t.Fatalf("destination LibraryImportHistory() = %#v, %v", destinationHistory, err)
	}
	importedUtility, err := database.LibraryItems(ctx, owner.ID, destination.ID, LibraryItemQuery{Utility: "imports"})
	if err != nil || len(importedUtility) != 1 || importedUtility[0].ID != imported.Item.ID {
		t.Fatalf("imports utility = %#v, %v", importedUtility, err)
	}
	pins, err := database.SetLibraryPinnedCollections(ctx, owner.ID, spaceID, []LibraryPinTarget{{Kind: "system", ID: "favorites"}, {Kind: "album", ID: album.ID}, {Kind: "memory", ID: discovery.Memories[0].ID}, {Kind: "map", ID: discovery.MapPoints[0].ID}})
	if err != nil || len(pins) != 4 || pins[0].Position != 0 || pins[0].TargetID != "favorites" || pins[3].Position != 3 || pins[3].TargetID != discovery.MapPoints[0].ID {
		t.Fatalf("SetLibraryPinnedCollections() = %#v, %v", pins, err)
	}
	listedPins, err := database.LibraryPinnedCollections(ctx, owner.ID, spaceID)
	if err != nil || len(listedPins) != 4 || listedPins[1].TargetID != album.ID {
		t.Fatalf("LibraryPinnedCollections() = %#v, %v", listedPins, err)
	}
	if _, err := database.SetLibraryPinnedCollections(ctx, owner.ID, destination.ID, []LibraryPinTarget{{Kind: "album", ID: album.ID}}); !errors.Is(err, ErrLibraryNotFound) {
		t.Fatalf("cross-Space album pin error = %v, want ErrLibraryNotFound", err)
	}
	if err := database.RevokeLibraryGrant(ctx, owner.ID, spaceID, shared.GrantID, shared.Version); err != nil {
		t.Fatalf("RevokeLibraryGrant(): %v", err)
	}
	references, err = database.LibrarySharedReferences(ctx, owner.ID, destination.ID)
	if err != nil || len(references) != 0 {
		t.Fatalf("references after revoke = %#v, %v", references, err)
	}
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "trash", Items: []LibraryItemVersion{{ID: updated.ID, Version: updated.Version}, {ID: promoted.ID, Version: promoted.Version}}})
	if err != nil || len(bulkItems) != 2 || bulkItems[0].LifecycleState != "trash" || bulkItems[1].LifecycleState != "trash" {
		t.Fatalf("bulk trash = %#v, %v", bulkItems, err)
	}
	deleted, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Collection: "recently-deleted", Visibility: "all"})
	if err != nil || len(deleted) != 2 {
		t.Fatalf("recently deleted = %#v, %v", deleted, err)
	}
	bulkItems, err = database.BulkUpdateLibraryItems(ctx, owner.ID, spaceID, BulkLibraryItemOperation{Action: "restore", Items: []LibraryItemVersion{{ID: bulkItems[0].ID, Version: bulkItems[0].Version}, {ID: bulkItems[1].ID, Version: bulkItems[1].Version}}})
	if err != nil || len(bulkItems) != 2 || bulkItems[0].LifecycleState != "ready" || bulkItems[1].LifecycleState != "ready" {
		t.Fatalf("bulk restore = %#v, %v", bulkItems, err)
	}
	recovered, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Utility: "recovered"})
	if err != nil || len(recovered) != 2 {
		t.Fatalf("recovered utility = %#v, %v", recovered, err)
	}
	recentlySaved, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Utility: "recently-saved"})
	if err != nil || len(recentlySaved) != 1 || recentlySaved[0].ID != promoted.ID {
		t.Fatalf("recently saved utility = %#v, %v", recentlySaved, err)
	}
	if err := database.DeleteLibraryAlbum(ctx, owner.ID, spaceID, album.ID, album.Version-1); !errors.Is(err, ErrLibraryConflict) {
		t.Fatalf("stale DeleteLibraryAlbum() error = %v", err)
	}
	if err := database.DeleteLibraryAlbum(ctx, owner.ID, spaceID, album.ID, album.Version); err != nil {
		t.Fatalf("DeleteLibraryAlbum() error = %v", err)
	}
}

func TestMissingDeduplicationObjectCanBeReplacedByNewUpload(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Library Repair Owner", "library-repair-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	spaces, err := database.ListSpaces(ctx, owner.ID)
	if err != nil || len(spaces) != 1 {
		t.Fatalf("ListSpaces() = %#v, %v", spaces, err)
	}
	spaceID := spaces[0].ID
	digest := strings.Repeat("b", 64)

	first, err := database.CreateLibraryUpload(ctx, owner.ID, spaceID, "library", "first.jpg", "image/jpeg", 128, digest, "library/originalobject", "first-token", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.SetLibraryUploadState(ctx, owner.ID, spaceID, first.ID, "first-token", "initiated", "uploaded_unverified"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.CompleteLibraryUpload(ctx, owner.ID, spaceID, first.ID, "first-token", 128, digest, "image/jpeg", nil); err != nil {
		t.Fatal(err)
	}

	replacement, err := database.CreateLibraryUpload(ctx, owner.ID, spaceID, "library", "replacement.jpg", "image/jpeg", 128, digest, "library/replacementobject", "replacement-token", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.SetLibraryUploadState(ctx, owner.ID, spaceID, replacement.ID, "replacement-token", "initiated", "uploaded_unverified"); err != nil {
		t.Fatal(err)
	}
	candidate, err := database.LibraryUploadDeduplicationObjectKey(ctx, owner.ID, spaceID, replacement.ID)
	if err != nil || candidate != "library/originalobject" {
		t.Fatalf("LibraryUploadDeduplicationObjectKey() = %q, %v", candidate, err)
	}
	if err := database.ReplaceMissingLibraryUploadDeduplicationObject(ctx, owner.ID, spaceID, replacement.ID, candidate); err != nil {
		t.Fatalf("ReplaceMissingLibraryUploadDeduplicationObject() error = %v", err)
	}
	completed, err := database.CompleteLibraryUpload(ctx, owner.ID, spaceID, replacement.ID, "replacement-token", 128, digest, "image/jpeg", nil)
	if err != nil || completed.Item == nil || completed.DiscardObjectKey != "" {
		t.Fatalf("CompleteLibraryUpload() = %#v, %v", completed, err)
	}
	download, err := database.LibraryItemDownload(ctx, owner.ID, spaceID, completed.Item.ID)
	if err != nil || download.ObjectKey != "library/replacementobject" {
		t.Fatalf("LibraryItemDownload() = %#v, %v", download, err)
	}
}

func libraryItemsByID(t *testing.T, items []SpaceLibraryItem, firstID, secondID string) (*SpaceLibraryItem, *SpaceLibraryItem) {
	t.Helper()
	var first, second *SpaceLibraryItem
	for index := range items {
		switch items[index].ID {
		case firstID:
			first = &items[index]
		case secondID:
			second = &items[index]
		}
	}
	if first == nil || second == nil {
		t.Fatalf("missing items %q and %q in %#v", firstID, secondID, items)
	}
	return first, second
}

func libraryFacetCount(facets []LibrarySearchFacet, value string) int {
	for _, facet := range facets {
		if facet.Value == value {
			return facet.Count
		}
	}
	return 0
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func TestParseLibrarySearchRejectsInvalidStructuredValues(t *testing.T) {
	if _, err := parseLibrarySearch("type:executable"); !errors.Is(err, ErrLibraryInvalid) {
		t.Fatalf("type error = %v", err)
	}
	if _, err := parseLibrarySearch("after:tomorrow"); !errors.Is(err, ErrLibraryInvalid) {
		t.Fatalf("date error = %v", err)
	}
	parsed, err := parseLibrarySearch(`summer trip album:"Road trip" hidden:false`)
	if err != nil || parsed.Text != "summer trip" || parsed.Album != "Road trip" || parsed.Hidden == nil || *parsed.Hidden {
		t.Fatalf("parsed search = %#v, %v", parsed, err)
	}
}

func TestMergeLibraryDuplicatesPreservesMetadataAndTrashesRedundantItems(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, _ := database.CreateUser("Duplicate Owner", "duplicate-owner@example.com", "password123")
	spaces, _ := database.ListSpaces(ctx, owner.ID)
	spaceID := spaces[0].ID
	digest := strings.Repeat("d", 64)
	items := make([]*SpaceLibraryItem, 0, 2)
	for index, token := range []string{"duplicate-token-1", "duplicate-token-2"} {
		upload, err := database.CreateLibraryUpload(ctx, owner.ID, spaceID, "library", "duplicate.txt", "text/plain", 20, digest, "library/duplicateobject"+string(rune('a'+index)), token, time.Now().Add(time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := database.SetLibraryUploadState(ctx, owner.ID, spaceID, upload.ID, token, "initiated", "uploaded_unverified"); err != nil {
			t.Fatal(err)
		}
		completed, err := database.CompleteLibraryUpload(ctx, owner.ID, spaceID, upload.ID, token, 20, digest, "text/plain", nil)
		if err != nil || completed.Item == nil {
			t.Fatalf("complete duplicate %d = %#v, %v", index, completed, err)
		}
		items = append(items, completed.Item)
	}
	second, err := database.UpdateLibraryItem(ctx, owner.ID, spaceID, items[1].ID, items[1].Version, items[1].DisplayName, "Useful caption", []string{"keep-me"}, true, false)
	if err != nil {
		t.Fatal(err)
	}
	merged, err := database.MergeLibraryDuplicates(ctx, owner.ID, spaceID, LibraryItemVersion{ID: items[0].ID, Version: items[0].Version}, []LibraryItemVersion{{ID: second.ID, Version: second.Version}})
	if err != nil || !merged.Favorite || merged.Caption != "Useful caption" || !containsString(merged.Tags, "keep-me") {
		t.Fatalf("MergeLibraryDuplicates() = %#v, %v", merged, err)
	}
	discovery, err := database.LibraryDiscovery(ctx, owner.ID, spaceID)
	if err != nil || len(discovery.Duplicates) != 0 {
		t.Fatalf("duplicates after merge = %#v, %v", discovery, err)
	}
	deleted, err := database.LibraryItems(ctx, owner.ID, spaceID, LibraryItemQuery{Collection: "recently-deleted", Visibility: "all"})
	if err != nil || len(deleted) != 1 || deleted[0].ID != second.ID {
		t.Fatalf("deleted duplicates = %#v, %v", deleted, err)
	}
}

func TestLibraryQuotaReservationRejectsOversubscriptionAndReleasesFailure(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, _ := database.CreateUser("Quota Owner", "quota-owner@example.com", "password123")
	member, _ := database.CreateUser("Quota Member", "quota-member@example.com", "password123")
	spaces, _ := database.ListSpaces(ctx, owner.ID)
	spaceID := spaces[0].ID
	invite, err := database.InviteToSpace(ctx, owner.ID, spaceID, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := database.SetSpaceMemberPermission(ctx, owner.ID, spaceID, member.ID, PermissionLibraryUpload, "allow"); err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("b", 64)
	upload, err := database.CreateLibraryUpload(ctx, owner.ID, spaceID, "library", "large.bin", "application/octet-stream", MaxSpaceStorageBytes, digest, "library/quotaobject", "quota-token", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("exact quota reservation error = %v", err)
	}
	if _, err := database.CreateLibraryUpload(ctx, member.ID, spaceID, "library", "extra.bin", "application/octet-stream", 1, digest, "library/extraobject", "extra-token", time.Now().Add(time.Hour)); !errors.Is(err, ErrLibraryQuota) {
		t.Fatalf("cross-member oversubscription error = %v, want ErrLibraryQuota", err)
	}
	if err := database.RejectLibraryUpload(ctx, owner.ID, spaceID, upload.ID, "quota-token", "invalid", "test_failure"); err != nil {
		t.Fatal(err)
	}
	usage, _ := database.SpaceStorageUsage(ctx, member.ID, spaceID)
	if usage.ReservedBytes != 0 || usage.RemainingBytes != MaxSpaceStorageBytes {
		t.Fatalf("rejected reservation usage = %#v", usage)
	}

	type reservationResult struct {
		userID string
		token  string
		upload *LibraryUpload
		err    error
	}
	start := make(chan struct{})
	results := make(chan reservationResult, 2)
	reserve := func(userID, token, key string) {
		<-start
		next, reserveErr := database.CreateLibraryUpload(ctx, userID, spaceID, "library", key+".bin", "application/octet-stream", 600_000_000, digest, "library/"+key, token, time.Now().Add(time.Hour))
		results <- reservationResult{userID: userID, token: token, upload: next, err: reserveErr}
	}
	go reserve(owner.ID, "owner-race-token", "owner-race")
	go reserve(member.ID, "member-race-token", "member-race")
	close(start)
	first, second := <-results, <-results
	succeeded, denied := 0, 0
	for _, result := range []reservationResult{first, second} {
		switch {
		case result.err == nil:
			succeeded++
			if err := database.RejectLibraryUpload(ctx, result.userID, spaceID, result.upload.ID, result.token, "invalid", "test_cleanup"); err != nil {
				t.Fatal(err)
			}
		case errors.Is(result.err, ErrLibraryQuota):
			denied++
		default:
			t.Fatalf("concurrent reservation error = %v", result.err)
		}
	}
	if succeeded != 1 || denied != 1 {
		t.Fatalf("concurrent shared quota results: succeeded=%d denied=%d", succeeded, denied)
	}
}

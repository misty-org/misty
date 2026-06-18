#include <gtest/gtest.h>

#include <map>
#include <string>
#include <vector>

#include "panels/transfers/content/transfers_content_util.h"
#include "panels/transfers/state/transfers_state.h"

namespace {

misty::core::FileTransferRecord transfer_row(
    uint64_t id,
    std::string remote_source,
    std::string remote_dest,
    misty::core::FileTransferStatus status = misty::core::FileTransferStatus::Completed) {
    misty::core::FileTransferRecord row;
    row.id = id;
    row.file_name = "file-" + std::to_string(id);
    row.remote_source_name = std::move(remote_source);
    row.remote_source_path = row.remote_source_name.empty() ? "" : "/source.txt";
    row.remote_dest_name = std::move(remote_dest);
    row.remote_dest_path = row.remote_dest_name.empty() ? "" : "/dest.txt";
    row.status = status;
    return row;
}

}  // namespace

TEST(TransfersProviderGroupingTest, GroupsLocalSourceDestinationAndRemoteToRemoteRows) {
    std::vector<misty::core::FileTransferRecord> rows;
    rows.push_back(transfer_row(1, "", ""));
    rows.push_back(transfer_row(2, "drive", ""));
    rows.push_back(transfer_row(3, "", "dropbox"));
    rows.push_back(transfer_row(4, "drive", "dropbox", misty::core::FileTransferStatus::InProgress));

    const std::map<std::string, std::string> labels = {
        {"drive", "Google Drive"},
        {"dropbox", "Dropbox"},
    };
    const auto groups = misty::panel::transfers_content::provider_groups(rows, labels);

    ASSERT_EQ(groups.size(), 3u);
    EXPECT_EQ(groups[0].key, misty::panel::transfers_content::kTransferProviderLocal);
    EXPECT_EQ(groups[0].label, "Local");
    EXPECT_EQ(groups[0].count, 1u);

    auto find_group = [&](const std::string& key) {
        return std::find_if(groups.begin(), groups.end(), [&](const auto& group) {
            return group.key == key;
        });
    };
    const auto drive = find_group("drive");
    ASSERT_NE(drive, groups.end());
    EXPECT_EQ(drive->label, "Google Drive");
    EXPECT_EQ(drive->count, 2u);
    EXPECT_EQ(drive->active, 1u);

    const auto dropbox = find_group("dropbox");
    ASSERT_NE(dropbox, groups.end());
    EXPECT_EQ(dropbox->label, "Dropbox");
    EXPECT_EQ(dropbox->count, 2u);
    EXPECT_EQ(dropbox->active, 1u);
}

TEST(TransfersProviderFilteringTest, AppliesProviderFilterWithStatusAndSearch) {
    std::vector<misty::core::FileTransferRecord> rows;
    rows.push_back(transfer_row(1, "", ""));
    rows.push_back(transfer_row(2, "drive", ""));
    rows.push_back(transfer_row(3, "", "dropbox", misty::core::FileTransferStatus::Failed));
    rows.push_back(transfer_row(4, "drive", "dropbox", misty::core::FileTransferStatus::InProgress));
    rows[3].file_name = "quarterly-report.pdf";

    const auto drive_rows = misty::panel::transfers_content::visible_rows(
        rows,
        "",
        misty::core::FileTransferFilter::All,
        {"drive"});
    ASSERT_EQ(drive_rows.size(), 2u);
    EXPECT_EQ(drive_rows[0].id, 2u);
    EXPECT_EQ(drive_rows[1].id, 4u);

    const auto local_rows = misty::panel::transfers_content::visible_rows(
        rows,
        "",
        misty::core::FileTransferFilter::All,
        {misty::panel::transfers_content::kTransferProviderLocal});
    ASSERT_EQ(local_rows.size(), 1u);
    EXPECT_EQ(local_rows[0].id, 1u);

    const auto searched_active = misty::panel::transfers_content::visible_rows(
        rows,
        "quarterly",
        misty::core::FileTransferFilter::Active,
        {"dropbox"});
    ASSERT_EQ(searched_active.size(), 1u);
    EXPECT_EQ(searched_active[0].id, 4u);
}

TEST(TransfersStateTest, TracksProviderFilterAndFocusedTransfer) {
    misty::panel::TransfersState state;

    state.set_focused_transfer_id(42);
    state.set_selected(42, true);
    state.set_page_index(3);
    state.toggle_provider_filter("drive");

    EXPECT_TRUE(state.provider_selected("drive"));
    EXPECT_EQ(state.page_index(), 0u);
    EXPECT_EQ(state.focused_transfer_id(), 0u);
    EXPECT_EQ(state.selected_count(), 0u);

    std::vector<misty::core::FileTransferRecord> rows;
    rows.push_back(transfer_row(7, "drive", ""));
    state.set_focused_transfer_id(7);
    state.prune_focused_transfer(rows);
    EXPECT_EQ(state.focused_transfer_id(), 7u);

    rows.clear();
    state.prune_focused_transfer(rows);
    EXPECT_EQ(state.focused_transfer_id(), 0u);
}

TEST(TransfersFilteringTest, CombinesMultiSelectSectionsAndLocationScope) {
    auto local_copy = transfer_row(1, "", "");
    local_copy.transfer_type = misty::core::FileTransferType::Copy;
    auto drive_move = transfer_row(2, "drive", "");
    drive_move.transfer_type = misty::core::FileTransferType::Move;
    auto dropbox_delete = transfer_row(3, "", "dropbox", misty::core::FileTransferStatus::Failed);
    dropbox_delete.transfer_type = misty::core::FileTransferType::Delete;
    auto remote_copy = transfer_row(4, "drive", "dropbox");
    remote_copy.transfer_type = misty::core::FileTransferType::Copy;
    const std::vector<misty::core::FileTransferRecord> rows = {
        local_copy, drive_move, dropbox_delete, remote_copy,
    };

    const auto remote_copies = misty::panel::transfers_content::visible_rows(
        rows,
        "",
        misty::core::FileTransferFilter::All,
        {"drive", "dropbox"},
        {misty::core::FileTransferType::Copy},
        misty::panel::TransferLocationScope::Remote);
    ASSERT_EQ(remote_copies.size(), 1u);
    EXPECT_EQ(remote_copies.front().id, 4u);

    const auto local_rows = misty::panel::transfers_content::visible_rows(
        rows,
        "",
        misty::core::FileTransferFilter::All,
        {},
        {},
        misty::panel::TransferLocationScope::Local);
    ASSERT_EQ(local_rows.size(), 1u);
    EXPECT_EQ(local_rows.front().id, 1u);
}

TEST(TransfersSortingTest, SortsByTimeAndNameInBothDirections) {
    auto alpha = transfer_row(1, "", "");
    alpha.file_name = "alpha.txt";
    alpha.completed_at_ms = 100;
    auto zeta = transfer_row(2, "", "");
    zeta.file_name = "Zeta.txt";
    zeta.completed_at_ms = 200;

    auto rows = misty::panel::transfers_content::sorted_rows(
        {alpha, zeta},
        misty::panel::TransferSortKey::Time,
        misty::panel::TransferSortDirection::Descending);
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].id, 2u);

    rows = misty::panel::transfers_content::sorted_rows(
        {alpha, zeta},
        misty::panel::TransferSortKey::Name,
        misty::panel::TransferSortDirection::Ascending);
    EXPECT_EQ(rows[0].id, 1u);
    EXPECT_EQ(rows[1].id, 2u);
}

TEST(TransfersStateTest, ClearsComposableFiltersAndResetsViewState) {
    misty::panel::TransfersState state;
    state.toggle_provider_filter("drive");
    state.toggle_provider_filter("dropbox");
    state.toggle_type_filter(misty::core::FileTransferType::Move);
    state.set_location_scope(misty::panel::TransferLocationScope::Remote);
    state.set_filter(misty::core::FileTransferFilter::Failed);
    EXPECT_EQ(state.active_filter_count(), 5u);

    state.clear_filters();
    EXPECT_TRUE(state.provider_filters().empty());
    EXPECT_TRUE(state.type_filters().empty());
    EXPECT_EQ(state.location_scope(), misty::panel::TransferLocationScope::All);
    EXPECT_EQ(state.filter(), misty::core::FileTransferFilter::All);
    EXPECT_EQ(state.active_filter_count(), 0u);
}

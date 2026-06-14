#include "panels/file_explorer/content/file_explorer_content_util.h"

#include <gtest/gtest.h>

namespace {

TEST(FileExplorerContentUtilTest, RemoteMountItemsJoinRelativeListedPathsWithBrowseDirectory) {
    misty::panel::RemoteBrowseTarget target;
    target.provider_folder = "dropbox";
    target.remote_name = "dropbox-mattdev727";
    target.remote_path = "/Projects";

    misty::core::FileMasterListItem remote_item;
    remote_item.name = "List.h";
    remote_item.path = "List.h";
    remote_item.is_dir = false;

    const auto items = misty::panel::remote_mount_items_for(target, {remote_item});

    ASSERT_EQ(items.size(), 1u);
    EXPECT_EQ(items[0].sync_remote_name, "dropbox-mattdev727");
    EXPECT_EQ(items[0].sync_remote_path, "Projects/List.h");
}

TEST(FileExplorerContentUtilTest, RemoteMountItemsDoNotDoubleJoinAbsoluteListedPaths) {
    misty::panel::RemoteBrowseTarget target;
    target.provider_folder = "dropbox";
    target.remote_name = "dropbox-mattdev727";
    target.remote_path = "/Projects";

    misty::core::FileMasterListItem remote_item;
    remote_item.name = "List.h";
    remote_item.path = "/Projects/List.h";
    remote_item.is_dir = false;

    const auto items = misty::panel::remote_mount_items_for(target, {remote_item});

    ASSERT_EQ(items.size(), 1u);
    EXPECT_EQ(items[0].sync_remote_path, "Projects/List.h");
}

}  // namespace

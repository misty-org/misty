#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>

#include "core/file_sync/file_sync.h"

namespace fs = std::filesystem;

namespace {

class TempDir {
public:
    TempDir() {
        path_ = fs::path("/private/tmp") /
                fs::path("misty-filesync-test-" +
                         std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + "-" +
                         std::to_string(counter_++));
        fs::create_directories(path_);
    }

    ~TempDir() {
        std::error_code ec;
        fs::remove_all(path_, ec);
    }

    const fs::path& path() const { return path_; }

private:
    fs::path path_;
    inline static int counter_ = 0;
};

void write_file(const fs::path& path, const std::string& contents) {
    fs::create_directories(path.parent_path());
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    ASSERT_TRUE(out.is_open());
    out << contents;
    out.flush();
}

misty::core::FsEvent make_event(const fs::path& path,
                                misty::core::FsEventKind kind,
                                bool is_dir = false,
                                uint64_t file_id = 1,
                                uint64_t device_id = 99) {
    misty::core::FsEvent event;
    event.path = path.string();
    event.kind = kind;
    event.device_id = device_id;
    event.file_id = file_id;
    event.is_dir = is_dir;
    return event;
}

misty::core::FileSyncFinalEvent coalesce_single(misty::core::FileSync& sync,
                                                const misty::core::FsEvent& event) {
    misty::core::FileSyncPendingEvent pending;
    pending.key = "test";
    pending.new_path = event.path;
    pending.old_path = event.old_path;
    pending.events.push_back(event);
    return sync.coalesce_pending_event_for_test(pending);
}

class FileSyncTest : public ::testing::Test {
protected:
    TempDir temp_dir_;
    misty::core::FileSync sync_{temp_dir_.path().string()};
};

TEST_F(FileSyncTest, IgnoresNoiseEvents) {
    const fs::path ds_store = temp_dir_.path() / ".DS_Store";
    const fs::path apple_double = temp_dir_.path() / "._notes.txt";
    const fs::path cache_file = temp_dir_.path() / ".misty" / ".cache" / "scratch.txt";
    const fs::path finder_placeholder = temp_dir_.path() / "untitled folder";
    const fs::path swap_file = temp_dir_.path() / "notes.swp";

    write_file(ds_store, "noise");
    write_file(apple_double, "noise");
    write_file(cache_file, "noise");
    fs::create_directories(finder_placeholder);
    write_file(swap_file, "noise");

    sync_.handle_event_for_test(make_event(ds_store, misty::core::FsEventKind::MODIFIED, false, 1));
    sync_.handle_event_for_test(make_event(apple_double, misty::core::FsEventKind::CREATED, false, 2));
    sync_.handle_event_for_test(make_event(cache_file, misty::core::FsEventKind::CREATED, false, 3));
    sync_.handle_event_for_test(make_event(finder_placeholder, misty::core::FsEventKind::CREATED, true, 4));
    sync_.handle_event_for_test(make_event(swap_file, misty::core::FsEventKind::MODIFIED, false, 5));
    sync_.process_ready_events_for_test();

    EXPECT_TRUE(sync_.final_events_for_test().empty());
}

TEST_F(FileSyncTest, IgnoresEventsOutsideWatchRoot) {
    const fs::path outside = fs::path("/private/tmp") / "misty-filesync-outside.txt";
    write_file(outside, "outside");

    sync_.handle_event_for_test(make_event(outside, misty::core::FsEventKind::CREATED));
    sync_.process_ready_events_for_test();

    EXPECT_TRUE(sync_.final_events_for_test().empty());

    std::error_code ec;
    fs::remove(outside, ec);
}

TEST_F(FileSyncTest, ExistingFilePlansUploadFile) {
    const fs::path file = temp_dir_.path() / "notes.txt";
    write_file(file, "hello");

    const auto final_event = coalesce_single(sync_, make_event(file, misty::core::FsEventKind::CREATED));

    EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::UploadFile);
    EXPECT_FALSE(final_event.is_dir);
    EXPECT_GE(final_event.size, 5);
}

TEST_F(FileSyncTest, ExistingEmptyFilePlansUploadFile) {
    const fs::path file = temp_dir_.path() / "empty.txt";
    write_file(file, "");

    const auto final_event = coalesce_single(sync_, make_event(file, misty::core::FsEventKind::CREATED));

    EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::UploadFile);
    EXPECT_FALSE(final_event.is_dir);
    EXPECT_EQ(final_event.size, 0);
}

TEST_F(FileSyncTest, ExistingDirectoryPlansCreateFolder) {
    const fs::path dir = temp_dir_.path() / "folder";
    fs::create_directories(dir);

    const auto final_event = coalesce_single(sync_, make_event(dir, misty::core::FsEventKind::CREATED, true));

    EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::CreateFolder);
    EXPECT_TRUE(final_event.is_dir);
}

TEST_F(FileSyncTest, MissingPathPlansDeleteRemote) {
    const fs::path missing = temp_dir_.path() / "gone.txt";

    const auto final_event = coalesce_single(sync_, make_event(missing, misty::core::FsEventKind::DELETED));

    EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::DeleteRemote);
}

TEST_F(FileSyncTest, DeleteEventUsesFinalStatBeforePlanning) {
    const fs::path file = temp_dir_.path() / "recreated.txt";

    misty::core::FileSyncPendingEvent pending;
    pending.key = "test";
    pending.new_path = file.string();
    pending.events.push_back(make_event(file, misty::core::FsEventKind::DELETED, false, 77));

    write_file(file, "came back");
    pending.events.push_back(make_event(file, misty::core::FsEventKind::MODIFIED, false, 77));

    const auto final_event = sync_.coalesce_pending_event_for_test(pending);

    EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::UploadFile);
    EXPECT_FALSE(final_event.is_dir);
    EXPECT_GE(final_event.size, 9);
}

TEST_F(FileSyncTest, DeleteEventWithMissingPathPlansDeleteRemote) {
    const fs::path missing = temp_dir_.path() / "deleted.txt";

    misty::core::FileSyncPendingEvent pending;
    pending.key = "test";
    pending.new_path = missing.string();
    pending.events.push_back(make_event(missing, misty::core::FsEventKind::DELETED, false, 88));
    pending.events.push_back(make_event(missing, misty::core::FsEventKind::MODIFIED, false, 88));

    const auto final_event = sync_.coalesce_pending_event_for_test(pending);

    EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::DeleteRemote);
}

TEST_F(FileSyncTest, MultipleDeleteEventsForDifferentPathsProduceMultipleFinalDeletes) {
    const fs::path first = temp_dir_.path() / "first.txt";
    const fs::path second = temp_dir_.path() / "second.txt";
    const fs::path third = temp_dir_.path() / "third.txt";

    sync_.handle_event_for_test(make_event(first, misty::core::FsEventKind::DELETED, false, 0, 0));
    sync_.handle_event_for_test(make_event(second, misty::core::FsEventKind::DELETED, false, 0, 0));
    sync_.handle_event_for_test(make_event(third, misty::core::FsEventKind::DELETED, false, 0, 0));
    sync_.process_ready_events_for_test();

    const auto finals = sync_.final_events_for_test();
    ASSERT_EQ(finals.size(), 3u);
    for (const auto& final_event : finals) {
        EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::DeleteRemote);
    }
}

TEST_F(FileSyncTest, MultipleDeleteEventsWithSameFileIdentityStillUsePathKeys) {
    const fs::path first = temp_dir_.path() / "first-device-only.txt";
    const fs::path second = temp_dir_.path() / "second-device-only.txt";
    const fs::path third = temp_dir_.path() / "third-device-only.txt";

    sync_.handle_event_for_test(make_event(first, misty::core::FsEventKind::DELETED, false, 42, 99));
    sync_.handle_event_for_test(make_event(second, misty::core::FsEventKind::DELETED, false, 42, 99));
    sync_.handle_event_for_test(make_event(third, misty::core::FsEventKind::DELETED, false, 42, 99));
    sync_.process_ready_events_for_test();

    const auto finals = sync_.final_events_for_test();
    ASSERT_EQ(finals.size(), 3u);
    for (const auto& final_event : finals) {
        EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::DeleteRemote);
    }
}

TEST_F(FileSyncTest, MultipleFolderDeleteEventsProduceMultipleFinalDeletes) {
    const fs::path first = temp_dir_.path() / "folder-one";
    const fs::path second = temp_dir_.path() / "folder-two";
    const fs::path third = temp_dir_.path() / "folder-three";

    sync_.handle_event_for_test(make_event(first, misty::core::FsEventKind::DELETED, true, 0, 0));
    sync_.handle_event_for_test(make_event(second, misty::core::FsEventKind::DELETED, true, 0, 0));
    sync_.handle_event_for_test(make_event(third, misty::core::FsEventKind::DELETED, true, 0, 0));
    sync_.process_ready_events_for_test();

    const auto finals = sync_.final_events_for_test();
    ASSERT_EQ(finals.size(), 3u);
    for (const auto& final_event : finals) {
        EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::DeleteRemote);
    }
}

TEST_F(FileSyncTest, MissingDestinationRenameProducesDeletesForOldAndNewPaths) {
    const fs::path old_path = temp_dir_.path() / "misty.png";
    const fs::path new_path = temp_dir_.path() / "misty-full.png";

    auto event = make_event(new_path, misty::core::FsEventKind::RENAMED);
    event.old_path = old_path.string();

    sync_.handle_event_for_test(event);

    const auto finals = sync_.final_events_for_test();
    ASSERT_EQ(finals.size(), 2u);
    EXPECT_EQ(finals[0].operation, misty::core::FileSyncOperation::DeleteRemote);
    EXPECT_EQ(finals[1].operation, misty::core::FileSyncOperation::DeleteRemote);

    std::vector<std::string> paths = {
        finals[0].pending_event.new_path,
        finals[1].pending_event.new_path,
    };
    EXPECT_NE(std::find(paths.begin(), paths.end(), old_path.string()), paths.end());
    EXPECT_NE(std::find(paths.begin(), paths.end(), new_path.string()), paths.end());
}

TEST_F(FileSyncTest, RenameWithExistingDestinationPlansRenameRemote) {
    const fs::path old_path = temp_dir_.path() / "before.txt";
    const fs::path new_path = temp_dir_.path() / "after.txt";
    write_file(new_path, "renamed");

    auto event = make_event(new_path, misty::core::FsEventKind::RENAMED);
    event.old_path = old_path.string();

    const auto final_event = coalesce_single(sync_, event);

    EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::RenameRemote);
    EXPECT_EQ(final_event.pending_event.old_path, old_path.string());
}

TEST_F(FileSyncTest, RenameFromFinderPlaceholderPlansCreateFolder) {
    const fs::path old_path = temp_dir_.path() / "untitled folder";
    const fs::path new_path = temp_dir_.path() / "project";
    fs::create_directories(new_path);

    auto event = make_event(new_path, misty::core::FsEventKind::RENAMED, true);
    event.old_path = old_path.string();

    const auto final_event = coalesce_single(sync_, event);

    EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::CreateFolder);
    EXPECT_TRUE(final_event.is_dir);
}

TEST_F(FileSyncTest, RenameFromFinderPlaceholderFilePlansUploadFile) {
    const fs::path old_path = temp_dir_.path() / "untitled";
    const fs::path new_path = temp_dir_.path() / "notes.txt";
    write_file(new_path, "hello");

    auto event = make_event(new_path, misty::core::FsEventKind::RENAMED);
    event.old_path = old_path.string();

    const auto final_event = coalesce_single(sync_, event);

    EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::UploadFile);
    EXPECT_FALSE(final_event.is_dir);
}

TEST_F(FileSyncTest, CreateAndModifyForSameFileEmitImmediateUploads) {
    const fs::path file = temp_dir_.path() / "coalesced.txt";
    write_file(file, "first");

    auto created = make_event(file, misty::core::FsEventKind::CREATED, false, 42);
    sync_.handle_event_for_test(created);

    write_file(file, "second version");
    auto modified_once = make_event(file, misty::core::FsEventKind::MODIFIED, false, 42);
    sync_.handle_event_for_test(modified_once);

    write_file(file, "final version");
    auto modified_twice = make_event(file, misty::core::FsEventKind::MODIFIED, false, 42);
    sync_.handle_event_for_test(modified_twice);

    sync_.process_ready_events_for_test();

    const auto finals = sync_.final_events_for_test();
    ASSERT_EQ(finals.size(), 3u);
    for (const auto& final_event : finals) {
        EXPECT_EQ(final_event.operation, misty::core::FileSyncOperation::UploadFile);
        EXPECT_EQ(final_event.pending_event.events.size(), 1u);
    }
    EXPECT_GE(finals.back().size, 13);
}

TEST_F(FileSyncTest, DuplicateUploadsForSameFileFingerprintAreSuppressed) {
    const fs::path file = temp_dir_.path() / "duplicate.png";
    write_file(file, "same bytes");

    auto modified = make_event(file, misty::core::FsEventKind::MODIFIED, false, 42);
    modified.mtime = "2026-05-20T12:00:00.000000000Z";
    sync_.handle_event_for_test(modified);

    auto created = make_event(file, misty::core::FsEventKind::CREATED, false, 42);
    created.mtime = "2026-05-20T12:00:00.000000000Z";
    sync_.handle_event_for_test(created);

    auto modified_again = make_event(file, misty::core::FsEventKind::MODIFIED, false, 42);
    modified_again.mtime = "2026-05-20T12:00:00.000000000Z";
    sync_.handle_event_for_test(modified_again);

    const auto finals = sync_.final_events_for_test();
    ASSERT_EQ(finals.size(), 1u);
    EXPECT_EQ(finals[0].operation, misty::core::FileSyncOperation::UploadFile);
}

TEST_F(FileSyncTest, ChangedUploadFingerprintEmitsAnotherUpload) {
    const fs::path file = temp_dir_.path() / "changed.png";
    write_file(file, "abcde");

    auto first = make_event(file, misty::core::FsEventKind::MODIFIED, false, 42);
    first.mtime = "2026-05-20T12:00:00.000000000Z";
    sync_.handle_event_for_test(first);

    write_file(file, "vwxyz");
    auto second = make_event(file, misty::core::FsEventKind::MODIFIED, false, 42);
    second.mtime = "2026-05-20T12:00:00.000000000Z";
    sync_.handle_event_for_test(second);

    const auto finals = sync_.final_events_for_test();
    ASSERT_EQ(finals.size(), 2u);
    EXPECT_EQ(finals[0].operation, misty::core::FileSyncOperation::UploadFile);
    EXPECT_EQ(finals[1].operation, misty::core::FileSyncOperation::UploadFile);
}

} // namespace

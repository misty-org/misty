#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <functional>
#include <thread>

#include <sqlite3.h>

#include "core/db.h"
#include "core/file_transfer/file_transfer.h"
#include "core/file_transfer/file_transfer_store.h"

namespace fs = std::filesystem;

namespace {

bool wait_for(const std::function<bool()>& predicate,
              std::chrono::milliseconds timeout = std::chrono::milliseconds(1500)) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
        if (predicate()) {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return predicate();
}

class FileTransferStoreTest : public ::testing::Test {
protected:
    void SetUp() override {
        temp_dir_ = fs::temp_directory_path() /
            fs::path("misty-file-transfer-store-test-" +
                     std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        fs::create_directories(temp_dir_);
        misty::core::DB::get().reset_for_testing();
        misty::core::FileTransferStore::get().reset_for_testing();
        misty::core::DB::get().set_path_override_for_testing((temp_dir_ / "misty.db").string());
    }

    void TearDown() override {
        misty::core::DB::get().reset_for_testing();
        misty::core::FileTransferStore::get().reset_for_testing();
        std::error_code ec;
        fs::remove_all(temp_dir_, ec);
    }

    fs::path temp_dir_;
};

TEST_F(FileTransferStoreTest, BootstrapCreatesSchemaAndIsIdempotent) {
    std::string error;
    EXPECT_TRUE(misty::core::DB::get().open(&error)) << error;
    EXPECT_TRUE(fs::exists(temp_dir_ / "misty.db"));

    {
        auto guard = misty::core::DB::get().acquire();
        auto stmt = guard.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transfers'",
            &error);
        ASSERT_TRUE(stmt.valid()) << error;
        ASSERT_EQ(stmt.step(), SQLITE_ROW);
        EXPECT_EQ(stmt.column_text(0), "transfers");
    }

    error.clear();
    EXPECT_TRUE(misty::core::DB::get().open(&error)) << error;
}

TEST_F(FileTransferStoreTest, UpsertPersistsRowAndSeedsNextId) {
    std::string error;
    misty::core::FileTransferRecord record;
    record.id = 1;
    record.job_id = 7;
    record.transfer_type = misty::core::FileTransferType::Rename;
    record.file_name = "alpha.txt";
    record.local_source_path = "/tmp/alpha.txt";
    record.local_dest_path = "/tmp/beta.txt";
    record.status = misty::core::FileTransferStatus::Completed;
    record.queued_at_ms = 1000;
    record.started_at_ms = 1200;
    record.completed_at_ms = 1400;

    EXPECT_TRUE(misty::core::FileTransferStore::get().upsert(record, &error)) << error;

    auto rows = misty::core::FileTransferStore::get().load_recent(10, &error);
    ASSERT_TRUE(error.empty()) << error;
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].id, 1u);
    EXPECT_EQ(rows[0].job_id, 7u);
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Completed);
    EXPECT_EQ(rows[0].local_dest_path, "/tmp/beta.txt");
    EXPECT_EQ(misty::core::FileTransferStore::get().next_transfer_id(&error), 2u);
}

TEST_F(FileTransferStoreTest, StartupHydrationRestoresInterruptedRows) {
    std::string error;
    misty::core::FileTransferRecord record;
    record.id = 3;
    record.transfer_type = misty::core::FileTransferType::Copy;
    record.file_name = "alpha.txt";
    record.local_source_path = "/tmp/alpha.txt";
    record.local_dest_path = "/tmp/dest/alpha.txt";
    record.status = misty::core::FileTransferStatus::InProgress;
    record.retryable = true;
    record.cancelable = true;
    record.queued_at_ms = 1000;
    record.started_at_ms = 1200;

    ASSERT_TRUE(misty::core::FileTransferStore::get().upsert(record, &error)) << error;

    misty::core::FileTransfer transfers;
    ASSERT_TRUE(transfers.initialize_persistence(&error)) << error;

    auto rows = transfers.get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Interrupted);
    EXPECT_FALSE(rows[0].cancelable);
    EXPECT_FALSE(rows[0].undoable);
    EXPECT_EQ(rows[0].detail_message, "Misty closed before this transfer finished.");
}

TEST_F(FileTransferStoreTest, ClearMethodsRemovePersistedRows) {
    std::string error;
    misty::core::FileTransferRecord completed;
    completed.id = 4;
    completed.file_name = "done.txt";
    completed.status = misty::core::FileTransferStatus::Completed;
    completed.queued_at_ms = 1000;
    completed.completed_at_ms = 1100;

    misty::core::FileTransferRecord failed;
    failed.id = 5;
    failed.file_name = "broken.txt";
    failed.status = misty::core::FileTransferStatus::Failed;
    failed.queued_at_ms = 1200;
    failed.completed_at_ms = 1300;

    ASSERT_TRUE(misty::core::FileTransferStore::get().upsert(completed, &error)) << error;
    ASSERT_TRUE(misty::core::FileTransferStore::get().upsert(failed, &error)) << error;

    misty::core::FileTransfer transfers;
    ASSERT_TRUE(transfers.initialize_persistence(&error)) << error;
    transfers.clear_completed();
    transfers.clear_failed();

    auto rows = misty::core::FileTransferStore::get().load_recent(10, &error);
    ASSERT_TRUE(error.empty()) << error;
    EXPECT_TRUE(rows.empty());
}

TEST_F(FileTransferStoreTest, BackgroundHydrationMergesPersistedRowsWithLiveTransfers) {
    std::string error;
    misty::core::FileTransferRecord persisted;
    persisted.id = 4;
    persisted.job_id = 11;
    persisted.file_name = "persisted.txt";
    persisted.status = misty::core::FileTransferStatus::Completed;
    persisted.queued_at_ms = 1000;
    persisted.completed_at_ms = 1100;
    ASSERT_TRUE(misty::core::FileTransferStore::get().upsert(persisted, &error)) << error;

    misty::core::FileTransfer transfers;
    ASSERT_TRUE(transfers.initialize_persistence_metadata(&error)) << error;
    ASSERT_TRUE(transfers.start_background_hydration(&error)) << error;

    misty::core::FileTransferRecord live;
    live.file_name = "live.txt";
    live.status = misty::core::FileTransferStatus::Queued;
    const uint64_t live_id = transfers.create_transfer(live);
    ASSERT_GT(live_id, persisted.id);

    ASSERT_TRUE(wait_for([&]() {
        std::string poll_error;
        return transfers.poll_background_hydration(&poll_error);
    }));

    const auto rows = transfers.get_all_transfers();
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_TRUE(std::any_of(rows.begin(), rows.end(), [](const misty::core::FileTransferRecord& row) {
        return row.file_name == "persisted.txt";
    }));
    EXPECT_TRUE(std::any_of(rows.begin(), rows.end(), [live_id](const misty::core::FileTransferRecord& row) {
        return row.id == live_id && row.file_name == "live.txt";
    }));
}

}  // namespace

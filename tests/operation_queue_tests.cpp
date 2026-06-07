#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>
#include <functional>
#include <fstream>
#include <thread>

#include "core/db.h"
#include "core/file_transfer/file_transfer.h"
#include "core/file_transfer/file_transfer_store.h"
#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"
#include "panels/file_explorer/operations/file_operation_jobs.h"
#include "panels/file_explorer/operations/operation_queue_state.h"

namespace fs = std::filesystem;

namespace {

void write_file(const fs::path& path, const std::string& body) {
    fs::create_directories(path.parent_path());
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    ASSERT_TRUE(out.is_open());
    out << body;
}

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

misty::panel::FileItem make_local_item(const fs::path& path) {
    misty::panel::FileItem item;
    item.name = path.filename().string();
    item.path = path.string();
    item.id = item.path;
    item.type = misty::panel::FileType::LOCAL;
    return item;
}

class OperationQueueTest : public ::testing::Test {
protected:
    void SetUp() override {
        temp_dir_ = fs::temp_directory_path() /
            fs::path("misty-operation-queue-test-" +
                     std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        fs::create_directories(temp_dir_);
        misty::core::DB::get().reset_for_testing();
        misty::core::FileTransferStore::get().reset_for_testing();
        misty::core::DB::get().set_path_override_for_testing((temp_dir_ / "misty.db").string());
    }

    void TearDown() override {
        worker_pool_.shutdown();
        misty::core::DB::get().reset_for_testing();
        misty::core::FileTransferStore::get().reset_for_testing();
        std::error_code ec;
        fs::remove_all(temp_dir_, ec);
    }

    misty::core::StateRegistry registry_;
    misty::core::WorkerPool worker_pool_{2};
    fs::path temp_dir_;
};

TEST_F(OperationQueueTest, CancelQueuedOperationMarksTransferCanceled) {
    auto& queue = registry_.get_state<misty::panel::OperationQueueState>(misty::panel::kOperationQueueStateKey);
    queue.max_concurrent = 0;

    const fs::path source = temp_dir_ / "alpha.txt";
    write_file(source, "alpha");
    const fs::path dest_dir = temp_dir_ / "dest";
    fs::create_directories(dest_dir);

    const auto batch_id = misty::panel::enqueue_clipboard_operation_batch(
        registry_,
        worker_pool_,
        "Files",
        {make_local_item(source)},
        dest_dir.string(),
        misty::panel::ClipboardOp::COPY,
        "Files");
    ASSERT_NE(batch_id, 0u);

    auto rows = registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Queued);

    EXPECT_TRUE(misty::panel::cancel_queued_operation(registry_, rows[0].id));

    rows = registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Canceled);
    EXPECT_TRUE(fs::exists(source));
    EXPECT_FALSE(fs::exists(dest_dir / "alpha.txt"));
}

TEST_F(OperationQueueTest, RetryFailedOperationCreatesNewTransfer) {
    const fs::path missing = temp_dir_ / "missing.txt";
    const fs::path dest_dir = temp_dir_ / "dest";
    fs::create_directories(dest_dir);

    const auto batch_id = misty::panel::enqueue_clipboard_operation_batch(
        registry_,
        worker_pool_,
        "Files",
        {make_local_item(missing)},
        dest_dir.string(),
        misty::panel::ClipboardOp::COPY,
        "Files");
    ASSERT_NE(batch_id, 0u);

    ASSERT_TRUE(wait_for([&]() {
        const auto rows = registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
        return rows.size() == 1u && rows[0].status == misty::core::FileTransferStatus::Failed;
    }));

    auto rows = registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_TRUE(misty::panel::retry_operation(registry_, worker_pool_, rows[0].id));

    ASSERT_TRUE(wait_for([&]() {
        const auto updated = registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
        return updated.size() >= 2u;
    }));
}

TEST_F(OperationQueueTest, UndoSuccessfulRenameRestoresOriginalPath) {
    const fs::path source = temp_dir_ / "alpha.txt";
    write_file(source, "alpha");

    misty::panel::RenameExecutionRequest request;
    request.owner_state_key = "Files";
    request.directory_path = temp_dir_.string();
    request.item = make_local_item(source);
    request.new_name = "beta.txt";

    const auto batch_id = misty::panel::enqueue_rename_operation_batch(
        registry_,
        worker_pool_,
        {request});
    ASSERT_NE(batch_id, 0u);

    const fs::path renamed = temp_dir_ / "beta.txt";
    ASSERT_TRUE(wait_for([&]() { return fs::exists(renamed); }));

    auto rows = registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
    ASSERT_FALSE(rows.empty());
    const auto it = std::find_if(rows.begin(), rows.end(), [](const misty::core::FileTransferRecord& row) {
        return row.status == misty::core::FileTransferStatus::Completed && row.undoable && row.undo_token_id != 0;
    });
    ASSERT_NE(it, rows.end());

    EXPECT_TRUE(misty::panel::undo_operation(registry_, worker_pool_, it->undo_token_id));
    ASSERT_TRUE(wait_for([&]() { return fs::exists(source) && !fs::exists(renamed); }));
}

TEST_F(OperationQueueTest, RehydratedUndoCanUndoAgainAfterRestart) {
    std::string error;
    ASSERT_TRUE(registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").initialize_persistence(&error))
        << error;

    const fs::path source = temp_dir_ / "alpha.txt";
    write_file(source, "alpha");

    misty::panel::RenameExecutionRequest request;
    request.owner_state_key = "Files";
    request.directory_path = temp_dir_.string();
    request.item = make_local_item(source);
    request.new_name = "beta.txt";

    ASSERT_NE(misty::panel::enqueue_rename_operation_batch(registry_, worker_pool_, {request}), 0u);

    const fs::path renamed = temp_dir_ / "beta.txt";
    ASSERT_TRUE(wait_for([&]() { return fs::exists(renamed); }));

    const auto rows = registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
    const auto first_undo = std::find_if(rows.begin(), rows.end(), [](const misty::core::FileTransferRecord& row) {
        return row.status == misty::core::FileTransferStatus::Completed && row.undoable && row.undo_token_id != 0;
    });
    ASSERT_NE(first_undo, rows.end());
    const uint64_t initial_job_id = first_undo->job_id;

    misty::core::StateRegistry rehydrated_registry;
    misty::core::DB::get().close();

    error.clear();
    ASSERT_TRUE(rehydrated_registry.get_state<misty::core::FileTransfer>("FileMasterTransfers").initialize_persistence(&error))
        << error;
    misty::panel::rehydrate_persisted_undo_records(rehydrated_registry);
    misty::panel::seed_file_operation_job_ids(rehydrated_registry);

    EXPECT_TRUE(misty::panel::undo_operation(rehydrated_registry, worker_pool_, first_undo->undo_token_id));
    ASSERT_TRUE(wait_for([&]() { return fs::exists(source) && !fs::exists(renamed); }));

    ASSERT_TRUE(wait_for([&]() {
        const auto updated =
            rehydrated_registry.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
        return std::any_of(updated.begin(), updated.end(), [initial_job_id](const misty::core::FileTransferRecord& row) {
            return row.status == misty::core::FileTransferStatus::Completed &&
                   row.undoable &&
                   row.undo_token_id != 0 &&
                   row.local_source_path.find("beta.txt") != std::string::npos &&
                   row.local_dest_path.find("alpha.txt") != std::string::npos &&
                   row.job_id > initial_job_id;
        });
    }));

    const auto updated_rows =
        rehydrated_registry.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
    const auto second_undo =
        std::find_if(updated_rows.rbegin(), updated_rows.rend(), [initial_job_id](const misty::core::FileTransferRecord& row) {
            return row.status == misty::core::FileTransferStatus::Completed &&
                   row.undoable &&
                   row.undo_token_id != 0 &&
                   row.local_source_path.find("beta.txt") != std::string::npos &&
                   row.local_dest_path.find("alpha.txt") != std::string::npos &&
                   row.job_id > initial_job_id;
        });
    ASSERT_NE(second_undo, updated_rows.rend());
    const uint64_t second_job_id = second_undo->job_id;

    EXPECT_TRUE(misty::panel::undo_operation(rehydrated_registry, worker_pool_, second_undo->undo_token_id));
    ASSERT_TRUE(wait_for([&]() { return fs::exists(renamed) && !fs::exists(source); }));
    ASSERT_TRUE(wait_for([&]() {
        const auto final_rows =
            rehydrated_registry.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
        return std::any_of(final_rows.begin(), final_rows.end(), [&](const misty::core::FileTransferRecord& row) {
            return row.status == misty::core::FileTransferStatus::Completed &&
                   row.undoable &&
                   row.undo_token_id != 0 &&
                   row.local_source_path.find("alpha.txt") != std::string::npos &&
                   row.local_dest_path.find("beta.txt") != std::string::npos &&
                   row.job_id > second_job_id;
        });
    }));
}

TEST_F(OperationQueueTest, RehydratedRetryCanCreateNewTransferAfterRestart) {
    std::string error;
    ASSERT_TRUE(registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").initialize_persistence(&error))
        << error;

    const fs::path missing = temp_dir_ / "missing.txt";
    const fs::path dest_dir = temp_dir_ / "dest";
    fs::create_directories(dest_dir);

    ASSERT_NE(misty::panel::enqueue_clipboard_operation_batch(
                  registry_,
                  worker_pool_,
                  "Files",
                  {make_local_item(missing)},
                  dest_dir.string(),
                  misty::panel::ClipboardOp::COPY,
                  "Files"),
              0u);

    ASSERT_TRUE(wait_for([&]() {
        const auto rows = registry_.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
        return rows.size() == 1u && rows[0].status == misty::core::FileTransferStatus::Failed;
    }));

    misty::core::StateRegistry rehydrated_registry;
    misty::core::DB::get().close();

    error.clear();
    ASSERT_TRUE(rehydrated_registry.get_state<misty::core::FileTransfer>("FileMasterTransfers").initialize_persistence(&error))
        << error;
    misty::panel::rehydrate_persisted_retry_operations(rehydrated_registry);
    misty::panel::seed_file_operation_job_ids(rehydrated_registry);
    rehydrated_registry
        .get_state<misty::panel::OperationQueueState>(misty::panel::kOperationQueueStateKey)
        .max_concurrent = 0;

    const auto rows =
        rehydrated_registry.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    ASSERT_TRUE(rows[0].retryable);

    EXPECT_TRUE(misty::panel::retry_operation(rehydrated_registry, worker_pool_, rows[0].id));
    ASSERT_TRUE(wait_for([&]() {
        const auto updated =
            rehydrated_registry.get_state<misty::core::FileTransfer>("FileMasterTransfers").get_all_transfers();
        return updated.size() >= 2u;
    }));
}

}  // namespace

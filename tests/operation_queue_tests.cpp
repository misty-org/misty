#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>
#include <functional>
#include <fstream>
#include <thread>

#include "core/file_transfer/file_transfer.h"
#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"
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
    }

    void TearDown() override {
        worker_pool_.shutdown();
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

}  // namespace

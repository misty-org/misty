#include "panels/clipboard/clipboard_transfer_state.h"

#include <chrono>
#include <thread>

#include <gtest/gtest.h>

namespace {

TEST(ClipboardTransferStateTest, TracksRunningProgress) {
    misty::panel::ClipboardTransferState state;
    state.begin("Clipboard Transfer", "Preparing items", 4);
    state.update("Downloading items", "List.h", 2);

    const auto snapshot = state.snapshot();
    EXPECT_TRUE(snapshot.visible);
    EXPECT_EQ(snapshot.status, misty::panel::ClipboardTransferStatus::Running);
    EXPECT_EQ(snapshot.title, "Clipboard Transfer");
    EXPECT_EQ(snapshot.detail, "Downloading items");
    EXPECT_EQ(snapshot.current_item, "List.h");
    EXPECT_EQ(snapshot.completed_items, 2u);
    EXPECT_EQ(snapshot.total_items, 4u);
    EXPECT_FLOAT_EQ(snapshot.progress, 0.5f);
}

TEST(ClipboardTransferStateTest, AutoClosesAfterFinish) {
    misty::panel::ClipboardTransferState state;
    state.begin("Clipboard Transfer", "Preparing item", 1);
    state.finish(true, "Clipboard is ready.");

    EXPECT_TRUE(state.snapshot().visible);
    std::this_thread::sleep_for(std::chrono::milliseconds(1300));
    state.tick();

    const auto snapshot = state.snapshot();
    EXPECT_FALSE(snapshot.visible);
    EXPECT_EQ(snapshot.status, misty::panel::ClipboardTransferStatus::Idle);
}

}  // namespace

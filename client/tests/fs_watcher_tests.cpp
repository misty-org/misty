#include <gtest/gtest.h>

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "core/sync/fs_watcher.h"

namespace fs = std::filesystem;
using namespace std::chrono_literals;

namespace {

class TempDir {
public:
    TempDir() {
        path_ = fs::temp_directory_path() /
                fs::path("misty-fswatcher-test-" +
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

class EventCollector {
public:
    void on_events(std::vector<misty::core::sync::FsEvent> events) {
        {
            std::lock_guard<std::mutex> lock(mu_);
            for (auto& event : events) {
                events_.push_back(std::move(event));
            }
        }
        cv_.notify_all();
    }

    std::optional<misty::core::sync::FsEvent> wait_for(
        const fs::path& expected_path,
        misty::core::sync::FsEventKind expected_kind,
        std::chrono::milliseconds timeout = 3s) {
        auto deadline = std::chrono::steady_clock::now() + timeout;
        std::unique_lock<std::mutex> lock(mu_);
        while (true) {
            for (const auto& event : events_) {
                if (fs::path(event.path) == expected_path && event.kind == expected_kind) {
                    return event;
                }
            }
            if (cv_.wait_until(lock, deadline) == std::cv_status::timeout) {
                return std::nullopt;
            }
        }
    }

    bool saw_path(const fs::path& expected_path) const {
        std::lock_guard<std::mutex> lock(mu_);
        for (const auto& event : events_) {
            if (fs::path(event.path) == expected_path) return true;
        }
        return false;
    }

private:
    mutable std::mutex mu_;
    std::condition_variable cv_;
    std::vector<misty::core::sync::FsEvent> events_;
};

#if defined(__linux__)

class LinuxFsWatcherTest : public ::testing::Test {
protected:
    void SetUp() override {
        ASSERT_TRUE(watcher_.start(
            temp_dir_.path().string(),
            [this](std::vector<misty::core::sync::FsEvent> events) {
                collector_.on_events(std::move(events));
            },
            50));
    }

    void TearDown() override {
        watcher_.stop();
    }

    static void write_file(const fs::path& path, const std::string& contents) {
        fs::create_directories(path.parent_path());
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        ASSERT_TRUE(out.is_open());
        out << contents;
        out.flush();
    }

    TempDir temp_dir_;
    EventCollector collector_;
    misty::core::sync::FsWatcher watcher_;
};

TEST_F(LinuxFsWatcherTest, ReportsCreateModifyAndDeleteForFile) {
    fs::path file = temp_dir_.path() / "tracked.txt";

    write_file(file, "hello");
    auto created = collector_.wait_for(file, misty::core::sync::FsEventKind::CREATED);
    ASSERT_TRUE(created.has_value());
    EXPECT_FALSE(created->is_dir);
    EXPECT_FALSE(created->mtime.empty());
    EXPECT_GE(created->size, 5);

    std::this_thread::sleep_for(150ms);
    write_file(file, "hello world");
    auto modified = collector_.wait_for(file, misty::core::sync::FsEventKind::MODIFIED);
    ASSERT_TRUE(modified.has_value());
    EXPECT_FALSE(modified->is_dir);
    EXPECT_FALSE(modified->mtime.empty());
    EXPECT_GE(modified->size, 11);

    std::this_thread::sleep_for(150ms);
    ASSERT_EQ(fs::remove(file), true);
    auto deleted = collector_.wait_for(file, misty::core::sync::FsEventKind::DELETED);
    ASSERT_TRUE(deleted.has_value());
    EXPECT_FALSE(deleted->is_dir);
}

TEST_F(LinuxFsWatcherTest, WatchesNewDirectoriesRecursively) {
    fs::path dir = temp_dir_.path() / "nested";
    fs::create_directories(dir);
    auto dir_created = collector_.wait_for(dir, misty::core::sync::FsEventKind::CREATED);
    ASSERT_TRUE(dir_created.has_value());
    EXPECT_TRUE(dir_created->is_dir);

    std::this_thread::sleep_for(200ms);
    fs::path child = dir / "child.txt";
    write_file(child, "nested-data");
    auto child_created = collector_.wait_for(child, misty::core::sync::FsEventKind::CREATED);
    ASSERT_TRUE(child_created.has_value());
    EXPECT_FALSE(child_created->is_dir);
}

TEST_F(LinuxFsWatcherTest, SuppressIgnoresEventsUnderPath) {
    fs::path file = temp_dir_.path() / "suppressed.txt";
    watcher_.suppress(file.string());
    write_file(file, "hidden");
    std::this_thread::sleep_for(300ms);
    EXPECT_FALSE(collector_.saw_path(file));

    watcher_.unsuppress(file.string());
    std::this_thread::sleep_for(150ms);
    write_file(file, "visible");
    auto modified = collector_.wait_for(file, misty::core::sync::FsEventKind::MODIFIED);
    ASSERT_TRUE(modified.has_value());
}

#else

TEST(FsWatcherStubTest, UnsupportedPlatformsReturnFalse) {
    misty::core::sync::FsWatcher watcher;
    EXPECT_FALSE(watcher.start(".", [](std::vector<misty::core::sync::FsEvent>) {}));
    EXPECT_FALSE(watcher.is_running());
}

#endif

} // namespace

#include <gtest/gtest.h>

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <vector>
#include <wtr/watcher.hpp>

#include "core/file_sync/fs_watcher.h"

namespace fs = std::filesystem;
using namespace std::chrono_literals;

namespace {

class TempDir {
public:
    TempDir() {
        path_ = fs::path("/private/tmp") /
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
    void on_events(std::vector<misty::core::FsEvent> events) {
        for (auto& event : events) {
            events_.push_back(std::move(event));
        }
    }

    const std::vector<misty::core::FsEvent>& events() const {
        return events_;
    }

private:
    std::vector<misty::core::FsEvent> events_;
};

class FsWatcherMappingTest : public ::testing::Test {
protected:
    void SetUp() override {
        watcher_.fs_watcher_set_callback_for_test([this](std::vector<misty::core::FsEvent> events) {
            collector_.on_events(std::move(events));
        });
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
    misty::core::FsWatcher watcher_;
};

TEST(FsWatcherStartTest, RejectsEmptyDirectory) {
    misty::core::FsWatcher watcher;
    EXPECT_FALSE(watcher.fs_watcher_start("", [](std::vector<misty::core::FsEvent>) {}));
    EXPECT_FALSE(watcher.fs_watcher_running());
}

TEST_F(FsWatcherMappingTest, MapsCreateModifyAndDeleteEvents) {
    fs::path file = temp_dir_.path() / "tracked.txt";

    write_file(file, "hello");
    watcher_.fs_watcher_handle_event_for_test({
        file,
        wtr::event::effect_type::create,
        wtr::event::path_type::file,
    });

    write_file(file, "hello world");
    watcher_.fs_watcher_handle_event_for_test({
        file,
        wtr::event::effect_type::modify,
        wtr::event::path_type::file,
    });

    ASSERT_EQ(fs::remove(file), true);
    watcher_.fs_watcher_handle_event_for_test({
        file,
        wtr::event::effect_type::destroy,
        wtr::event::path_type::file,
    });

    ASSERT_EQ(collector_.events().size(), 3u);
    EXPECT_EQ(collector_.events()[0].kind, misty::core::FsEventKind::CREATED);
    EXPECT_EQ(fs::path(collector_.events()[0].path), file);
    EXPECT_FALSE(collector_.events()[0].is_dir);
    EXPECT_FALSE(collector_.events()[0].mtime.empty());
    EXPECT_GE(collector_.events()[0].size, 5);

    EXPECT_EQ(collector_.events()[1].kind, misty::core::FsEventKind::MODIFIED);
    EXPECT_EQ(fs::path(collector_.events()[1].path), file);
    EXPECT_GE(collector_.events()[1].size, 11);

    EXPECT_EQ(collector_.events()[2].kind, misty::core::FsEventKind::DELETED);
    EXPECT_EQ(fs::path(collector_.events()[2].path), file);
}

TEST_F(FsWatcherMappingTest, MapsDirectoryEvents) {
    fs::path dir = temp_dir_.path() / "nested";
    fs::create_directories(dir);
    watcher_.fs_watcher_handle_event_for_test({
        dir,
        wtr::event::effect_type::create,
        wtr::event::path_type::dir,
    });

    ASSERT_EQ(collector_.events().size(), 1u);
    EXPECT_EQ(collector_.events()[0].kind, misty::core::FsEventKind::CREATED);
    EXPECT_EQ(fs::path(collector_.events()[0].path), dir);
    EXPECT_TRUE(collector_.events()[0].is_dir);
    EXPECT_EQ(collector_.events()[0].size, 0);
}

TEST_F(FsWatcherMappingTest, IgnoresMacMetadataEvents) {
    fs::path ds_store = temp_dir_.path() / ".DS_Store";
    fs::path apple_double = temp_dir_.path() / "._tracked.txt";

    write_file(ds_store, "noise");
    write_file(apple_double, "noise");

    watcher_.fs_watcher_handle_event_for_test({
        ds_store,
        wtr::event::effect_type::modify,
        wtr::event::path_type::file,
    });
    watcher_.fs_watcher_handle_event_for_test({
        apple_double,
        wtr::event::effect_type::create,
        wtr::event::path_type::file,
    });

    EXPECT_TRUE(collector_.events().empty());
}

TEST_F(FsWatcherMappingTest, MapsRenameWithOldAndNewPath) {
    fs::path old_path = temp_dir_.path() / "before.txt";
    fs::path new_path = temp_dir_.path() / "after.txt";

    write_file(old_path, "rename-me");
    fs::rename(old_path, new_path);

    wtr::event renamed_from{
        old_path,
        wtr::event::effect_type::rename,
        wtr::event::path_type::file,
    };
    wtr::event renamed_to{
        new_path,
        wtr::event::effect_type::rename,
        wtr::event::path_type::file,
    };
    watcher_.fs_watcher_handle_event_for_test({renamed_from, std::move(renamed_to)});

    ASSERT_EQ(collector_.events().size(), 1u);
    EXPECT_EQ(collector_.events()[0].kind, misty::core::FsEventKind::RENAMED);
    EXPECT_EQ(fs::path(collector_.events()[0].old_path), old_path);
    EXPECT_EQ(fs::path(collector_.events()[0].path), new_path);
    EXPECT_FALSE(collector_.events()[0].is_dir);
    EXPECT_GE(collector_.events()[0].size, 9);
}

} // namespace

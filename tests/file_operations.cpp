#include <gtest/gtest.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <optional>
#include <string>
#include <thread>

#include "core/file_master/file_master_local.h"
#include "core/file_master/file_master_remote.h"
#include "core/threading/worker_pool.h"

namespace fs = std::filesystem;

namespace {

struct TempHome {
    TempHome() {
        const char* current = std::getenv("HOME");
        if (current) {
            old_home_ = current;
        }

        path_ = fs::temp_directory_path() /
                fs::path("misty-client-tests-" +
                         std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        fs::create_directories(path_);
        setenv("HOME", path_.c_str(), 1);
    }

    ~TempHome() {
        if (old_home_.has_value()) {
            setenv("HOME", old_home_->c_str(), 1);
        } else {
            unsetenv("HOME");
        }

        std::error_code ec;
        fs::remove_all(path_, ec);
    }

    fs::path path() const { return path_; }

private:
    fs::path path_;
    std::optional<std::string> old_home_;
};

void write_file(const fs::path& path, const std::string& body) {
    fs::create_directories(path.parent_path());
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    ASSERT_TRUE(out.is_open());
    out << body;
}

bool wait_for(const std::function<bool()>& predicate,
              std::chrono::milliseconds timeout = std::chrono::milliseconds(1000)) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
        if (predicate()) {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return predicate();
}

class FileMasterLocalTest : public ::testing::Test {
protected:
    FileMasterLocalTest()
        : worker_pool_(1),
          file_master_(worker_pool_) {}

    void TearDown() override {
        worker_pool_.shutdown();
    }

    TempHome home_;
    misty::core::WorkerPool worker_pool_;
    misty::core::FileMasterLocal file_master_;
};

class FileMasterRemoteTest : public ::testing::Test {
protected:
    FileMasterRemoteTest()
        : worker_pool_(1),
          file_master_(worker_pool_) {}

    void TearDown() override {
        worker_pool_.shutdown();
    }

    misty::core::WorkerPool worker_pool_;
    misty::core::FileMasterRemote file_master_;
};

TEST_F(FileMasterLocalTest, RenameRenamesFile) {
    const fs::path src = home_.path() / "rename-me.txt";
    const fs::path dest = home_.path() / "renamed.txt";
    write_file(src, "payload");

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = src.filename().string();
    props.local_source.path = src.string();
    props.local_dest.path = dest.string();
    file_master_.rename(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success);
    EXPECT_FALSE(fs::exists(src));
    EXPECT_TRUE(fs::exists(dest));
}

TEST_F(FileMasterLocalTest, RemoveDeletesFile) {
    const fs::path src = home_.path() / "delete-me.txt";
    write_file(src, "payload");

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = src.filename().string();
    props.local_source.path = src.string();
    file_master_.remove(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success);
    EXPECT_FALSE(fs::exists(src));
}

TEST_F(FileMasterLocalTest, CopyCopiesFile) {
    const fs::path src = home_.path() / "copy-me.txt";
    const fs::path dest = home_.path() / "dest" / "copy-me.txt";
    fs::create_directories(dest.parent_path());
    write_file(src, "payload");

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = src.filename().string();
    props.local_source.path = src.string();
    props.local_dest.path = dest.string();
    file_master_.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success);
    EXPECT_TRUE(fs::exists(src));
    EXPECT_TRUE(fs::exists(dest));
}

TEST_F(FileMasterLocalTest, CutMovesFile) {
    const fs::path src = home_.path() / "move-me.txt";
    const fs::path dest = home_.path() / "dest" / "move-me.txt";
    fs::create_directories(dest.parent_path());
    write_file(src, "payload");

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = src.filename().string();
    props.local_source.path = src.string();
    props.local_dest.path = dest.string();
    file_master_.cut(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success);
    EXPECT_FALSE(fs::exists(src));
    EXPECT_TRUE(fs::exists(dest));
}

TEST_F(FileMasterLocalTest, ValidationFailureReturnsError) {
    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = "broken.txt";
    props.local_dest.path = (home_.path() / "dest" / "broken.txt").string();
    file_master_.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(result->success);
    EXPECT_EQ(result->error_message, "local_source.path is required");
}

TEST_F(FileMasterLocalTest, RuntimeFailureReturnsError) {
    const fs::path src = home_.path() / "missing.txt";
    const fs::path dest = home_.path() / "dest" / "missing.txt";

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = src.filename().string();
    props.local_source.path = src.string();
    props.local_dest.path = dest.string();
    file_master_.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_FALSE(result->success);
    EXPECT_FALSE(result->error_message.empty());
}

TEST_F(FileMasterRemoteTest, RenameAcceptsStructuredRemoteContextAndReturnsStubError) {
    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = "report.txt";
    props.remote_source.remote_name = "drive-work";
    props.remote_source.provider_type = "drive";
    props.remote_source.remote_path = "Documents/report.txt";
    props.remote_dest.remote_name = "drive-work";
    props.remote_dest.provider_type = "drive";
    props.remote_dest.remote_path = "Archive/report.txt";

    file_master_.rename(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(result->success);
    EXPECT_EQ(result->error_message, "Remote rename is not implemented yet.");
}

TEST_F(FileMasterRemoteTest, ListRequiresRemoteContext) {
    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;

    file_master_.list(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(result->success);
    EXPECT_EQ(result->error_message, "remote_source or remote_dest with remote_name is required");
}

}  // namespace

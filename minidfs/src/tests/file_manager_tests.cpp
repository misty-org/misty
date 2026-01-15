#include <gtest/gtest.h>
#include <thread>
#include <atomic>
#include <vector>
#include <filesystem>
#include <string>
#include "dfs/file_manager.h"

namespace fs = std::filesystem;

const std::string test_mount = "file_manager";

class MiniDFSFileManagerTest : public ::testing::Test {
protected:
    FileManager fm;
    void SetUp() override {
        fs::remove_all(test_mount);
        fs::create_directories(test_mount);
    }
    void TearDown() override {
        fs::remove_all(test_mount);
    }
};

TEST_F(MiniDFSFileManagerTest, AcquireWriteLockExclusive) {
    ASSERT_TRUE(fm.AcquireWriteLock("client1", "a.txt", true));

    std::atomic<bool> acquired{false};
    std::thread t([&] {
        acquired = fm.AcquireWriteLock("client2", "a.txt", true);
    });

    EXPECT_FALSE(acquired.load());

    fm.ReleaseWriteLock("client1", "a.txt");
    t.join();
}

TEST_F(MiniDFSFileManagerTest, AcquireWriteLockAfterRelease) {
    ASSERT_TRUE(fm.AcquireWriteLock("client1", "a.txt", true));
    fm.ReleaseWriteLock("client1", "a.txt");

    EXPECT_TRUE(fm.AcquireWriteLock("client2", "a.txt", true));
    fm.ReleaseWriteLock("client2", "a.txt");
}

TEST_F(MiniDFSFileManagerTest, AcquireWriteLockDifferentFiles) {
    ASSERT_TRUE(fm.AcquireWriteLock("client1", "a.txt", true));

    EXPECT_TRUE(fm.AcquireWriteLock("client2", "b.txt", true));

    fm.ReleaseWriteLock("client1", "a.txt");
    fm.ReleaseWriteLock("client2", "b.txt");
}

TEST_F(MiniDFSFileManagerTest, WriteWithoutLockFails) {
    std::string data = "hello";
    EXPECT_FALSE(fm.WriteFile("client1", "a.txt", 0, data.data(), data.size()));
}

TEST_F(MiniDFSFileManagerTest, WriteWithLockSucceeds) {
    fs::path file_path = FileManager::ResolvePath(test_mount, "a.txt");
    std::string data = "hello";

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    EXPECT_TRUE(fm.WriteFile("client1", file_path.string(), 0, data.data(), data.size()));
    fm.ReleaseWriteLock("client1", file_path.string());

    EXPECT_TRUE(fs::exists(file_path));
}

TEST_F(MiniDFSFileManagerTest, WriteAtOffset) {
    std::string initial_data = "AAAAA";
    std::string patch_data = "BB";
    fs::path file_path = FileManager::ResolvePath(test_mount, "offset.txt");

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    ASSERT_TRUE(fm.WriteFile("client1", file_path.string(), 0, initial_data.data(), initial_data.size()));
    EXPECT_TRUE(fm.WriteFile("client1", file_path.string(), 2, patch_data.data(), patch_data.size()));
    fm.ReleaseWriteLock("client1", file_path.string());

    char buffer[5];
    size_t bytes_read = 0;
    ASSERT_TRUE(fm.AcquireReadLock("client1", file_path.string()));
    fm.ReadFile("client1", file_path.string(), 0, buffer, &bytes_read);
    fm.ReleaseReadLock("client1", file_path.string());

    EXPECT_EQ(std::string(buffer, 5), "AABBA");
}

TEST_F(MiniDFSFileManagerTest, WriteInNestedDirectory) {
    fs::path file_path = FileManager::ResolvePath(test_mount, "level1/level2/deep_file.txt");
    std::string data = "depth_test";

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    EXPECT_TRUE(fm.WriteFile("client1", file_path.string(), 0, data.data(), data.size()));
    fm.ReleaseWriteLock("client1", file_path.string());

    EXPECT_TRUE(fs::exists(file_path));
}

TEST_F(MiniDFSFileManagerTest, SparseWriteTest) {
    std::string data = "end";
    uint64_t large_offset = 10;
    fs::path file_path = FileManager::ResolvePath(test_mount, "sparse.bin");

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    EXPECT_TRUE(fm.WriteFile("client1", file_path.string(), large_offset, data.data(), data.size()));
    fm.ReleaseWriteLock("client1", file_path.string());

    char buffer[13];
    size_t bytes_read = 0;
    ASSERT_TRUE(fm.AcquireReadLock("client1", file_path.string()));
    fm.ReadFile("client1", file_path.string(), 0, buffer, &bytes_read);
    
    EXPECT_EQ(bytes_read, 13);
    EXPECT_EQ(buffer[0], '\0');
    EXPECT_EQ(std::string(buffer + 10, 3), "end");
    fm.ReleaseReadLock("client1", file_path.string());
}

TEST_F(MiniDFSFileManagerTest, WriteLockEnforcement) {
    std::string data = "secret";
    fs::path file_path = FileManager::ResolvePath(test_mount, "lock.txt");

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    EXPECT_FALSE(fm.WriteFile("client2", file_path.string(), 0, data.data(), data.size()));
    EXPECT_TRUE(fm.WriteFile("client1", file_path.string(), 0, data.data(), data.size()));
    fm.ReleaseWriteLock("client1", file_path.string());

    EXPECT_TRUE(fs::exists(file_path.string()));
}

TEST_F(MiniDFSFileManagerTest, ReadWithoutLockFails) {
    char buffer[10];
    size_t bytes_read = 0;
    EXPECT_FALSE(fm.ReadFile("client1", "a.txt", 0, buffer, &bytes_read));
}

TEST_F(MiniDFSFileManagerTest, ReadWithLockSucceeds) {
    std::string data = "hello";
    fs::path file_path = FileManager::ResolvePath(test_mount, "a.txt");

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    ASSERT_TRUE(fm.WriteFile("client1", file_path.string(), 0, data.data(), data.size()));
    fm.ReleaseWriteLock("client1", file_path.string());

    char buffer[10];
    size_t bytes_read = 0;

    ASSERT_TRUE(fm.AcquireReadLock("client1", file_path.string()));
    EXPECT_TRUE(fm.ReadFile("client1", file_path.string(), 0, buffer, &bytes_read));
    fm.ReleaseReadLock("client1", file_path.string());

    EXPECT_EQ(bytes_read, data.size());
    EXPECT_EQ(std::string(buffer, bytes_read), data);
}

TEST_F(MiniDFSFileManagerTest, ReadLockMultipleClients) {
    std::string data = "concurrent";
    fs::path file_path = FileManager::ResolvePath(test_mount, "shared.txt");

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    ASSERT_TRUE(fm.WriteFile("client1", file_path.string(), 0, data.data(), data.size()));
    fm.ReleaseWriteLock("client1", file_path.string());

    const int num_clients = 5;
    std::vector<std::thread> threads;
    std::atomic<int> success_count{0};

    for (int i = 0; i < num_clients; ++i) {
        threads.emplace_back([this, i, &success_count, &file_path]() {
            std::string cid = "client_" + std::to_string(i);
            if (fm.AcquireReadLock(cid, file_path.string())) {
                char buffer[20];
                size_t bytes_read = 0;
                if (fm.ReadFile(cid, file_path.string(), 0, buffer, &bytes_read)) {
                    std::string read_data(buffer, bytes_read);
                    if (read_data == "concurrent") {
                        success_count++;
                    }
                }
                fm.ReleaseReadLock(cid, file_path.string());
            }
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    EXPECT_EQ(success_count.load(), num_clients);
}

TEST_F(MiniDFSFileManagerTest, RemoveFileWithLock) {
    std::string data = "to be deleted";
    fs::path file_path = FileManager::ResolvePath(test_mount, "delete_me.txt");

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    ASSERT_TRUE(fm.WriteFile("client1", file_path.string(), 0, data.data(), data.size()));
    fm.ReleaseWriteLock("client1", file_path.string());

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    EXPECT_EQ(fm.RemoveFile("client1", file_path.string()), FileStatus::FILE_OK);
    fm.ReleaseWriteLock("client1", file_path.string());

    EXPECT_FALSE(fs::exists(file_path.string()));
}

TEST_F(MiniDFSFileManagerTest, RemoveFileWithoutLockFails) {
    std::string data = "cannot delete";
    fs::path file_path = FileManager::ResolvePath(test_mount, "nodelete.txt");

    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), true));
    ASSERT_TRUE(fm.WriteFile("client1", file_path.string(), 0, data.data(), data.size()));
    fm.ReleaseWriteLock("client1", file_path.string());

    EXPECT_EQ(fm.RemoveFile("client1", file_path.string()), FileStatus::FILE_LOCKED);
    EXPECT_TRUE(fs::exists(file_path.string()));
}

TEST_F(MiniDFSFileManagerTest, DeleteNonExistentFileFails) {
    fs::path file_path = FileManager::ResolvePath(test_mount, "nonexistent.txt");
    ASSERT_TRUE(fm.AcquireWriteLock("client1", file_path.string(), false));
    EXPECT_EQ(fm.RemoveFile("client1", file_path.string()), FileStatus::FILE_NOT_FOUND);
    fm.ReleaseWriteLock("client1", file_path.string());
}

TEST_F(MiniDFSFileManagerTest, ResolvePathTest) {
    fs::path resolved = FileManager::ResolvePath(test_mount, "subdir/file.txt");
    EXPECT_EQ(resolved, fs::path(test_mount) / "subdir" / "file.txt");
}

TEST_F(MiniDFSFileManagerTest, ReadersBlockedByPendingWriter) {
    const std::string filename = "pending_writer.txt";
    std::atomic<bool> reader_entered{false};

    std::thread writer([&] {
        ASSERT_TRUE(fm.AcquireWriteLock("w1", filename, true));
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        fm.ReleaseWriteLock("w1", filename);
    });

    std::thread reader([&] {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        ASSERT_TRUE(fm.AcquireReadLock("client1", filename));
        reader_entered = true;
        fm.ReleaseReadLock("client1", filename);
    });

    writer.join();
    reader.join();

    EXPECT_TRUE(reader_entered.load());
}

TEST_F(MiniDFSFileManagerTest, OneWriterThreeReadersStressTest) {
    fs::path file_path = FileManager::ResolvePath(test_mount, "stress.txt");
    const std::string writer_id = "writer";
    constexpr int kIterations = 100;
    constexpr char kWriteChar = 'X';

    std::thread writer([&] {
        for (int i = 0; i < kIterations; ++i) {
            ASSERT_TRUE(fm.AcquireWriteLock(writer_id, file_path.string(), true));
            char buf[16];
            memset(buf, kWriteChar, sizeof(buf));
            ASSERT_TRUE(fm.WriteFile(writer_id, file_path.string(), 0, buf, sizeof(buf)));
            fm.ReleaseWriteLock(writer_id, file_path.string());
        }
    });

    auto reader_fn = [&](std::string cid, std::string fp) {
        char buf[16];
        size_t bytes_read = 0;
        for (int i = 0; i < kIterations; ++i) {
            ASSERT_TRUE(fm.AcquireReadLock(cid, fp));
            ASSERT_TRUE(fm.ReadFile(cid, fp, 0, buf, &bytes_read));
            for (size_t j = 0; j < bytes_read; ++j) {
                ASSERT_EQ(buf[j], kWriteChar);
            }
            fm.ReleaseReadLock(cid, fp);
        }
    };

    std::thread r1(reader_fn, "r1", file_path.string());
    std::thread r2(reader_fn, "r2", file_path.string());
    std::thread r3(reader_fn, "r3", file_path.string());

    writer.join();
    r1.join();
    r2.join();
    r3.join();
}

TEST_F(MiniDFSFileManagerTest, ManyWritersAndReaders) {
    fs::path file_path = FileManager::ResolvePath(test_mount, "stress_many.txt");
    constexpr int kWriters = 100;
    constexpr int kReaders = 1000;

    std::vector<std::thread> writers;
    for (int i = 0; i < kWriters; ++i) {
        writers.emplace_back([&, i, file_path] {
            std::string client_id = "writer_" + std::to_string(i);
            ASSERT_TRUE(fm.AcquireWriteLock(client_id, file_path.string(), true));
            int value = i;
            ASSERT_TRUE(fm.WriteFile(client_id, file_path.string(), 0, &value, sizeof(value)));
            fm.ReleaseWriteLock(client_id, file_path.string());
        });
    }

    for (auto& w : writers) w.join();

    std::vector<std::thread> readers;
    for (int i = 0; i < kReaders; ++i) {
        readers.emplace_back([&, i, file_path] {
            std::string cid = "reader_" + std::to_string(i);
            ASSERT_TRUE(fm.AcquireReadLock(cid, file_path.string()));
            int value = -1;
            size_t bytes_read = 0;
            ASSERT_TRUE(fm.ReadFile(cid, file_path.string(), 0, &value, &bytes_read));
            ASSERT_EQ(bytes_read, sizeof(int));
            ASSERT_GE(value, 0);
            ASSERT_LT(value, kWriters);
            fm.ReleaseReadLock(cid, file_path.string());
        });
    }

    for (auto& r : readers) r.join();
}

TEST_F(MiniDFSFileManagerTest, ManyReadersBlockedByPendingWriters) {
    fs::path file_path = FileManager::ResolvePath(test_mount, "pending_writer_stress.txt");
    constexpr int kWriters = 50;
    constexpr int kReaders = 200;
    constexpr int kThreads = 16;

    std::atomic<int> write_idx{0};
    std::atomic<int> read_idx{0};
    std::atomic<int> readers_entered{0};

    auto writer_fn = [&, file_path] {
        while (true) {
            int i = write_idx.fetch_add(1);
            if (i >= kWriters) break;
            std::string client_id = "writer_" + std::to_string(i);
            ASSERT_TRUE(fm.AcquireWriteLock(client_id, file_path.string(), true));
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
            fm.ReleaseWriteLock(client_id, file_path.string());
        }
    };

    auto reader_fn = [&, file_path] {
        while (true) {
            int i = read_idx.fetch_add(1);
            if (i >= kReaders) break;
            std::string cid = "reader_" + std::to_string(i);
            ASSERT_TRUE(fm.AcquireReadLock(cid, file_path.string()));
            readers_entered.fetch_add(1);
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
            fm.ReleaseReadLock(cid, file_path.string());
        }
    };

    std::vector<std::thread> threads;
    for (int i = 0; i < kThreads; ++i) {
        threads.emplace_back(writer_fn);
        threads.emplace_back(reader_fn);
    }

    for (auto& t : threads) t.join();
    EXPECT_EQ(readers_entered.load(), kReaders);
}

TEST_F(MiniDFSFileManagerTest, ManyReaderWriterChaosTest) { 
    fs::path file_path = FileManager::ResolvePath(test_mount, "chaos.txt");
    constexpr int kWriters = 100;
    constexpr int kReaders = 500;
    constexpr int kThreads = 32;
    constexpr int kIterations = 10;

    std::atomic<int> active_writers{0};
    std::atomic<int> total_reads{0};
    std::atomic<int> total_writes{0};
    std::atomic<int> write_idx{0};
    std::atomic<int> read_idx{0};

    auto writer_fn = [&, file_path] {
        while (true) {
            int i = write_idx.fetch_add(1);
            if (i >= kWriters * kIterations) break;
            std::string client_id = "writer_" + std::to_string(i);
            ASSERT_TRUE(fm.AcquireWriteLock(client_id, file_path.string(), true));
            int prev = active_writers.fetch_add(1);
            ASSERT_EQ(prev, 0);
            int value = i;
            ASSERT_TRUE(fm.WriteFile(client_id, file_path.string(), 0, &value, sizeof(value)));
            total_writes.fetch_add(1);
            active_writers.fetch_sub(1);
            fm.ReleaseWriteLock(client_id, file_path.string());
        }
    };

    auto reader_fn = [&, file_path] {
        while (true) {
            int i = read_idx.fetch_add(1);
            if (i >= kReaders * kIterations) break;
            std::string cid = "reader_" + std::to_string(i);
            ASSERT_TRUE(fm.AcquireReadLock(cid, file_path.string()));
            ASSERT_EQ(active_writers.load(), 0);
            int value = -1;
            size_t bytes_read = 0;
            if (fs::exists(file_path)) {
                ASSERT_TRUE(fm.ReadFile(cid, file_path.string(), 0, &value, &bytes_read));
            }
            total_reads.fetch_add(1);
            fm.ReleaseReadLock(cid, file_path.string());
        }
    };

    std::vector<std::thread> threads;
    for (int i = 0; i < kThreads / 2; ++i) {
        threads.emplace_back(writer_fn);
        threads.emplace_back(reader_fn);
    }

    for (auto& t : threads) t.join();

    EXPECT_EQ(active_writers.load(), 0);
    EXPECT_EQ(total_writes.load(), kWriters * kIterations);
    EXPECT_EQ(total_reads.load(), kReaders * kIterations);
}
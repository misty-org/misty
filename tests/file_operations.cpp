#include <gtest/gtest.h>

#include <cstdlib>
#include <filesystem>
#include <functional>
#include <fstream>
#include <mutex>
#include <netinet/in.h>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <thread>
#include <unistd.h>
#include <arpa/inet.h>
#include <atomic>
#include <sys/socket.h>
#include <vector>

#include "core/file_master/file_master_local.h"
#include "core/file_master/file_master_remote.h"
#include "core/file_transfer/file_transfer.h"
#include "core/manager/env_manager.h"
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

template <typename RequestT, typename Predicate>
const RequestT* find_request(const std::vector<RequestT>& requests, Predicate predicate) {
    for (const auto& request : requests) {
        if (predicate(request)) {
            return &request;
        }
    }
    return nullptr;
}

class FakeRemoteProxy {
public:
    struct Request {
        std::string method;
        std::string target;
        std::string body;
    };

    struct Job {
        std::string id;
        std::string operation;
        std::string state = "running";
        std::string phase = "starting";
        std::string message;
        std::string download_body;
        std::chrono::steady_clock::time_point started_at = std::chrono::steady_clock::now();
        std::chrono::milliseconds delay{0};
        bool counted_as_copy = false;
    };

    ~FakeRemoteProxy() { stop(); }

    void start() {
        server_fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
        ASSERT_GE(server_fd_, 0);
        int opt = 1;
        ASSERT_EQ(::setsockopt(server_fd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt)), 0);

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0;
        ASSERT_EQ(::bind(server_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)), 0);
        ASSERT_EQ(::listen(server_fd_, 16), 0);

        socklen_t len = sizeof(addr);
        ASSERT_EQ(::getsockname(server_fd_, reinterpret_cast<sockaddr*>(&addr), &len), 0);
        port_ = ntohs(addr.sin_port);
        running_ = true;
        thread_ = std::thread([this]() { serve_loop(); });
    }

    void stop() {
        if (!running_) {
            return;
        }
        running_ = false;
        ::shutdown(server_fd_, SHUT_RDWR);
        ::close(server_fd_);
        server_fd_ = -1;
        if (thread_.joinable()) {
            thread_.join();
        }
    }

    void configure_env(const fs::path& home) const {
        const fs::path config = home / "misty.json";
        write_file(config, "{\"proxy\":{\"port\":" + std::to_string(port_) + "}}");
        misty::core::EnvManager::get().set_env_file_path(config.string());
        misty::core::EnvManager::get().reload();
    }

    void set_download_body(std::string body) {
        std::lock_guard<std::mutex> lock(mu_);
        download_body_ = std::move(body);
        download_status_ = 200;
    }

    void set_copy_delay(std::chrono::milliseconds delay) {
        std::lock_guard<std::mutex> lock(mu_);
        copy_delay_ = delay;
    }

    void fail_download() {
        std::lock_guard<std::mutex> lock(mu_);
        download_body_ = "download failed";
        download_status_ = 502;
    }

    int max_active_copy_requests() const {
        std::lock_guard<std::mutex> lock(mu_);
        return max_active_copy_requests_;
    }

    std::vector<Request> requests() const {
        std::lock_guard<std::mutex> lock(mu_);
        return requests_;
    }

private:
    static std::string read_all(int fd) {
        std::string data;
        char buffer[4096];
        while (true) {
            const ssize_t n = ::recv(fd, buffer, sizeof(buffer), 0);
            if (n <= 0) {
                break;
            }
            data.append(buffer, static_cast<std::size_t>(n));
            const auto header_end = data.find("\r\n\r\n");
            if (header_end == std::string::npos) {
                continue;
            }
            const std::string headers = data.substr(0, header_end);
            std::size_t content_length = 0;
            const std::string key = "Content-Length:";
            const auto pos = headers.find(key);
            if (pos != std::string::npos) {
                const auto start = pos + key.size();
                const auto end = headers.find("\r\n", start);
                content_length = static_cast<std::size_t>(std::stoul(headers.substr(start, end - start)));
            }
            if (data.size() >= header_end + 4 + content_length) {
                break;
            }
        }
        return data;
    }

    static void write_response(int fd, int status, const std::string& body) {
        std::string reason = "OK";
        if (status == 202) reason = "Accepted";
        else if (status >= 400) reason = "Bad Gateway";
        std::ostringstream out;
        out << "HTTP/1.1 " << status << " " << reason << "\r\n"
            << "Content-Length: " << body.size() << "\r\n"
            << "Connection: close\r\n\r\n"
            << body;
        const std::string response = out.str();
        (void)::send(fd, response.data(), response.size(), 0);
    }

    static void write_sse_response(int fd, const std::string& body) {
        std::ostringstream out;
        out << "HTTP/1.1 200 OK\r\n"
            << "Content-Type: text/event-stream\r\n"
            << "Cache-Control: no-cache\r\n"
            << "Connection: close\r\n"
            << "Content-Length: " << body.size() << "\r\n\r\n"
            << body;
        const std::string response = out.str();
        (void)::send(fd, response.data(), response.size(), 0);
    }

    std::string create_job_locked(std::string operation,
                                  std::string phase,
                                  std::chrono::milliseconds delay,
                                  bool counted_as_copy,
                                  std::string message = {},
                                  std::string download_body = {}) {
        const std::string id = "job-" + std::to_string(next_job_id_++);
        Job job;
        job.id = id;
        job.operation = std::move(operation);
        job.phase = std::move(phase);
        job.delay = delay;
        job.counted_as_copy = counted_as_copy;
        job.message = std::move(message);
        job.download_body = std::move(download_body);
        jobs_[id] = std::move(job);
        if (counted_as_copy) {
            ++active_copy_requests_;
            max_active_copy_requests_ = std::max(max_active_copy_requests_, active_copy_requests_);
        }
        return id;
    }

    Job job_snapshot_locked(const std::string& job_id) {
        auto& job = jobs_.at(job_id);
        if (job.state == "running" &&
            std::chrono::steady_clock::now() - job.started_at >= job.delay) {
            job.state = job.message.empty() ? "succeeded" : "failed";
            job.phase = job.message.empty() ? "completed" : "failed";
            if (job.counted_as_copy) {
                --active_copy_requests_;
                job.counted_as_copy = false;
            }
        }
        return job;
    }

    static std::string job_json(const Job& job) {
        std::ostringstream json;
        json << "{"
             << "\"job_id\":\"" << job.id << "\","
             << "\"operation\":\"" << job.operation << "\","
             << "\"state\":\"" << job.state << "\","
             << "\"phase\":\"" << job.phase << "\","
             << "\"bytes_completed\":0,"
             << "\"bytes_total\":0,"
             << "\"message\":\"" << job.message << "\""
             << "}";
        return json.str();
    }

    void serve_loop() {
        while (running_) {
            const int client = ::accept(server_fd_, nullptr, nullptr);
            if (client < 0) {
                continue;
            }
            handle_client(client);
            ::close(client);
        }
    }

    void handle_client(int client) {
        const std::string raw = read_all(client);
        if (raw.empty()) {
            return;
        }
        const auto line_end = raw.find("\r\n");
        std::istringstream line(raw.substr(0, line_end));
        Request request;
        line >> request.method >> request.target;
        const auto header_end = raw.find("\r\n\r\n");
        if (header_end != std::string::npos) {
            request.body = raw.substr(header_end + 4);
        }

        int status = 200;
        std::string body = "{\"ok\":true}";
        bool use_sse_response = false;
        {
            std::lock_guard<std::mutex> lock(mu_);
            requests_.push_back(request);
            if (request.target.rfind("/api/session", 0) == 0) {
                body = "{\"token\":\"test-token\"}";
            } else if (request.target.rfind("/api/remote/file/jobs/", 0) == 0) {
                const std::string suffix = request.target.substr(std::string("/api/remote/file/jobs/").size());
                const auto slash = suffix.find('/');
                const std::string job_id = suffix.substr(0, slash);
                const std::string rest = slash == std::string::npos ? "" : suffix.substr(slash);
                if (jobs_.find(job_id) == jobs_.end()) {
                    status = 404;
                    body = "{\"error\":\"job not found\"}";
                } else if (rest == "/stream") {
                    Job first = job_snapshot_locked(job_id);
                    if (first.state == "running" && first.delay.count() > 0) {
                        // let the stream observe a running state first
                        first.phase = "transferring";
                    }
                    Job final = first;
                    if (final.state == "running") {
                        final.state = final.message.empty() ? "succeeded" : "failed";
                        final.phase = final.message.empty() ? "completed" : "failed";
                    }
                    body = "event: state\ndata: " + job_json(first) + "\n\n";
                    if (first.state != final.state || first.phase != final.phase) {
                        body += "event: state\ndata: " + job_json(final) + "\n\n";
                    }
                    jobs_[job_id] = final;
                    if (jobs_[job_id].counted_as_copy) {
                        --active_copy_requests_;
                        jobs_[job_id].counted_as_copy = false;
                    }
                    use_sse_response = true;
                } else if (rest == "/result/download") {
                    Job job = job_snapshot_locked(job_id);
                    if (job.state == "running") {
                        status = 409;
                        body = "{\"error\":\"job result is not ready\"}";
                    } else if (job.state == "failed") {
                        status = 410;
                        body = "{\"error\":\"job result expired\"}";
                    } else {
                        body = job.download_body;
                    }
                } else {
                    Job job = job_snapshot_locked(job_id);
                    body = job_json(job);
                }
            } else if (request.target.rfind("/api/remote/file/download", 0) == 0) {
                status = 202;
                const std::string job_id = create_job_locked(
                    "download",
                    "downloading",
                    std::chrono::milliseconds(0),
                    false,
                    download_status_ >= 400 ? download_body_ : std::string{},
                    download_body_);
                body = "{\"job_id\":\"" + job_id + "\"}";
            } else if (request.target.rfind("/api/remote/file/copy", 0) == 0) {
                status = 202;
                const std::string job_id = create_job_locked("copy", "transferring", copy_delay_, true);
                body = "{\"job_id\":\"" + job_id + "\"}";
            } else if (request.target.rfind("/api/remote/file/move", 0) == 0) {
                status = 202;
                const std::string job_id = create_job_locked("move", "transferring", copy_delay_, true);
                body = "{\"job_id\":\"" + job_id + "\"}";
            } else if (request.target.rfind("/api/remote/file/upload", 0) == 0) {
                status = 202;
                const std::string job_id = create_job_locked("upload", "uploading", copy_delay_, true);
                body = "{\"job_id\":\"" + job_id + "\"}";
            } else if (request.target.rfind("/api/remote/file/rename", 0) == 0) {
                status = 202;
                const std::string job_id = create_job_locked("rename", "renaming", std::chrono::milliseconds(0), false);
                body = "{\"job_id\":\"" + job_id + "\"}";
            } else if (request.target.rfind("/api/remote/file?", 0) == 0 && request.method == "DELETE") {
                status = 202;
                const std::string job_id = create_job_locked("delete", "deleting", std::chrono::milliseconds(0), false);
                body = "{\"job_id\":\"" + job_id + "\"}";
            }
        }
        if (use_sse_response) {
            write_sse_response(client, body);
        } else {
            write_response(client, status, body);
        }
    }

    int server_fd_ = -1;
    int port_ = 0;
    std::atomic<bool> running_{false};
    std::thread thread_;
    mutable std::mutex mu_;
    std::vector<Request> requests_;
    int download_status_ = 200;
    std::string download_body_ = "downloaded";
    std::chrono::milliseconds copy_delay_{0};
    int active_copy_requests_ = 0;
    int max_active_copy_requests_ = 0;
    int next_job_id_ = 1;
    std::map<std::string, Job> jobs_;
};

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

    TempHome home_;
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

TEST_F(FileMasterLocalTest, TrackedCopyCreatesCompletedTransfer) {
    misty::core::FileTransfer transfers;
    misty::core::FileMasterLocal tracked_file_master(worker_pool_, &transfers);
    const fs::path src = home_.path() / "tracked-copy.txt";
    const fs::path dest = home_.path() / "dest" / "tracked-copy.txt";
    fs::create_directories(dest.parent_path());
    write_file(src, "payload");

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = src.filename().string();
    props.local_source.path = src.string();
    props.local_dest.path = dest.string();
    tracked_file_master.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success);
    const auto rows = transfers.get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].transfer_type, misty::core::FileTransferType::Copy);
    EXPECT_EQ(rows[0].item_type, misty::core::FileTransferItemType::Local);
    EXPECT_EQ(rows[0].file_name, "tracked-copy.txt");
    EXPECT_EQ(rows[0].local_source_path, src.string());
    EXPECT_EQ(rows[0].local_dest_path, dest.string());
    EXPECT_EQ(rows[0].total_bytes, 7);
    EXPECT_EQ(rows[0].transferred_bytes, 7);
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Completed);
}

TEST_F(FileMasterLocalTest, TrackedCutCreatesCompletedMoveTransfer) {
    misty::core::FileTransfer transfers;
    misty::core::FileMasterLocal tracked_file_master(worker_pool_, &transfers);
    const fs::path src = home_.path() / "tracked-move.txt";
    const fs::path dest = home_.path() / "dest" / "tracked-move.txt";
    fs::create_directories(dest.parent_path());
    write_file(src, "payload");

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = src.filename().string();
    props.local_source.path = src.string();
    props.local_dest.path = dest.string();
    tracked_file_master.cut(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success);
    const auto rows = transfers.get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].transfer_type, misty::core::FileTransferType::Move);
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Completed);
    EXPECT_EQ(rows[0].local_source_path, src.string());
    EXPECT_EQ(rows[0].local_dest_path, dest.string());
}

TEST_F(FileMasterLocalTest, TrackedRemoveCreatesCompletedDeleteTransfer) {
    misty::core::FileTransfer transfers;
    misty::core::FileMasterLocal tracked_file_master(worker_pool_, &transfers);
    const fs::path src = home_.path() / "tracked-delete.txt";
    write_file(src, "payload");

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = src.filename().string();
    props.local_source.path = src.string();
    tracked_file_master.remove(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success);
    EXPECT_FALSE(fs::exists(src));
    const auto rows = transfers.get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].transfer_type, misty::core::FileTransferType::Delete);
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Completed);
    EXPECT_EQ(rows[0].local_source_path, src.string());
    EXPECT_TRUE(rows[0].local_dest_path.empty());
}

TEST_F(FileMasterLocalTest, TrackedRuntimeFailureCreatesFailedTransfer) {
    misty::core::FileTransfer transfers;
    misty::core::FileMasterLocal tracked_file_master(worker_pool_, &transfers);
    const fs::path src = home_.path() / "missing-tracked.txt";
    const fs::path dest = home_.path() / "dest" / "missing-tracked.txt";

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = src.filename().string();
    props.local_source.path = src.string();
    props.local_dest.path = dest.string();
    tracked_file_master.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_FALSE(result->success);
    const auto rows = transfers.get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].transfer_type, misty::core::FileTransferType::Copy);
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Failed);
    EXPECT_FALSE(rows[0].error_message.empty());
}

TEST_F(FileMasterLocalTest, TrackedValidationFailureDoesNotCreateTransfer) {
    misty::core::FileTransfer transfers;
    misty::core::FileMasterLocal tracked_file_master(worker_pool_, &transfers);

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.file_name = "broken.txt";
    props.local_dest.path = (home_.path() / "dest" / "broken.txt").string();
    tracked_file_master.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(result->success);
    EXPECT_TRUE(transfers.get_all_transfers().empty());
}

TEST_F(FileMasterRemoteTest, RemoveCallsProxyDeleteEndpoint) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";
    props.remote_source.remote_path = "/Documents/report one.txt";

    file_master_.remove(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success) << result->error_message;
    const auto requests = proxy.requests();
    const auto* request = find_request(requests, [](const auto& item) {
        return item.method == "DELETE" &&
               item.target == "/api/remote/file?remote=drive-work&path=%2FDocuments%2Freport%20one.txt";
    });
    ASSERT_NE(request, nullptr);
}

TEST_F(FileMasterRemoteTest, RenameSendsExpectedProxyRequestAndSucceeds) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";
    props.remote_source.remote_path = "/Documents/report.txt";
    props.remote_dest.remote_name = "drive-work";
    props.remote_dest.remote_path = "/Archive/report.txt";

    file_master_.rename(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success) << result->error_message;
    const auto requests = proxy.requests();
    const auto* request = find_request(requests, [](const auto& item) {
        return item.method == "POST" && item.target == "/api/remote/file/rename";
    });
    ASSERT_NE(request, nullptr);
    EXPECT_NE(request->body.find("\"remote\":\"drive-work\""), std::string::npos);
    EXPECT_NE(request->body.find("\"old_path\":\"/Documents/report.txt\""), std::string::npos);
    EXPECT_NE(request->body.find("\"new_path\":\"/Archive/report.txt\""), std::string::npos);
}

TEST_F(FileMasterRemoteTest, RemoteToRemoteCopyCallsProxyTransferEndpoint) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";
    props.remote_source.remote_path = "/Documents/report.txt";
    props.remote_dest.remote_name = "archive";
    props.remote_dest.remote_path = "/Reports/report.txt";

    file_master_.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success) << result->error_message;
    const auto requests = proxy.requests();
    const auto* request = find_request(requests, [](const auto& item) {
        return item.method == "POST" && item.target == "/api/remote/file/copy";
    });
    ASSERT_NE(request, nullptr);
    EXPECT_NE(request->body.find("\"source_remote\":\"drive-work\""), std::string::npos);
    EXPECT_NE(request->body.find("\"dest_remote\":\"archive\""), std::string::npos);
}

TEST_F(FileMasterRemoteTest, RemoteTransferRequestsUseBoundedConcurrencyAcrossWorkerThreads) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());
    proxy.set_copy_delay(std::chrono::milliseconds(120));

    misty::core::WorkerPool parallel_pool(4);
    misty::core::FileMasterRemote parallel_file_master(parallel_pool);

    std::optional<misty::core::FileMasterResult> first_result;
    std::optional<misty::core::FileMasterResult> second_result;
    std::optional<misty::core::FileMasterResult> third_result;

    misty::core::FileMasterProps first_props;
    first_props.remote_source.remote_name = "drive-work";
    first_props.remote_source.remote_path = "/Documents/report-a.txt";
    first_props.remote_dest.remote_name = "archive";
    first_props.remote_dest.remote_path = "/Reports/report-a.txt";

    misty::core::FileMasterProps second_props;
    second_props.remote_source.remote_name = "drive-work";
    second_props.remote_source.remote_path = "/Documents/report-b.txt";
    second_props.remote_dest.remote_name = "archive";
    second_props.remote_dest.remote_path = "/Reports/report-b.txt";

    misty::core::FileMasterProps third_props;
    third_props.remote_source.remote_name = "drive-work";
    third_props.remote_source.remote_path = "/Documents/report-c.txt";
    third_props.remote_dest.remote_name = "archive";
    third_props.remote_dest.remote_path = "/Reports/report-c.txt";

    parallel_file_master.copy(first_props, [&](misty::core::FileMasterResult value) {
        first_result = std::move(value);
    });
    parallel_file_master.copy(second_props, [&](misty::core::FileMasterResult value) {
        second_result = std::move(value);
    });
    parallel_file_master.copy(third_props, [&](misty::core::FileMasterResult value) {
        third_result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() {
                             return first_result.has_value() &&
                                    second_result.has_value() &&
                                    third_result.has_value();
                         },
                         std::chrono::milliseconds(2000)));
    ASSERT_TRUE(first_result->success);
    ASSERT_TRUE(second_result->success);
    ASSERT_TRUE(third_result->success);
    EXPECT_LE(proxy.max_active_copy_requests(), 2);

    parallel_pool.shutdown();
}

TEST_F(FileMasterRemoteTest, RemoteToRemoteCutCallsProxyMoveEndpoint) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";
    props.remote_source.remote_path = "/Documents/report.txt";
    props.remote_dest.remote_name = "archive";
    props.remote_dest.remote_path = "/Reports/report.txt";

    file_master_.cut(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success) << result->error_message;
    const auto requests = proxy.requests();
    const auto* request = find_request(requests, [](const auto& item) {
        return item.method == "POST" && item.target == "/api/remote/file/move";
    });
    ASSERT_NE(request, nullptr);
}

TEST_F(FileMasterRemoteTest, RemoteToLocalCopyWritesFile) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());
    proxy.set_download_body("downloaded payload");

    const fs::path dest = home_.path() / "Downloads" / "report.txt";
    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";
    props.remote_source.remote_path = "/Documents/report.txt";
    props.local_dest.path = dest.string();

    file_master_.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success) << result->error_message;
    std::ifstream in(dest, std::ios::binary);
    ASSERT_TRUE(in.is_open());
    std::stringstream buffer;
    buffer << in.rdbuf();
    EXPECT_EQ(buffer.str(), "downloaded payload");
}

TEST_F(FileMasterRemoteTest, RemoteToLocalCutDoesNotDeleteWhenDownloadFails) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());
    proxy.fail_download();

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";
    props.remote_source.remote_path = "/Documents/report.txt";
    props.local_dest.path = (home_.path() / "Downloads" / "report.txt").string();

    file_master_.cut(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_FALSE(result->success);
    const auto requests = proxy.requests();
    for (const auto& request : requests) {
        EXPECT_NE(request.method, "DELETE");
    }
}

TEST_F(FileMasterRemoteTest, TrackedRemoteToRemoteCopyCreatesCompletedTransfer) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());

    misty::core::FileTransfer transfers;
    misty::core::FileMasterRemote tracked_file_master(worker_pool_, &transfers);

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";
    props.remote_source.remote_path = "/Documents/report.txt";
    props.remote_dest.remote_name = "archive";
    props.remote_dest.remote_path = "/Reports/report.txt";

    tracked_file_master.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success) << result->error_message;
    const auto rows = transfers.get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].transfer_type, misty::core::FileTransferType::Copy);
    EXPECT_EQ(rows[0].item_type, misty::core::FileTransferItemType::Remote);
    EXPECT_EQ(rows[0].file_name, "report.txt");
    EXPECT_EQ(rows[0].remote_source_name, "drive-work");
    EXPECT_EQ(rows[0].remote_source_path, "/Documents/report.txt");
    EXPECT_EQ(rows[0].remote_dest_name, "archive");
    EXPECT_EQ(rows[0].remote_dest_path, "/Reports/report.txt");
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Completed);
}

TEST_F(FileMasterRemoteTest, TrackedRemoteToLocalCutFailureCreatesFailedTransfer) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());
    proxy.fail_download();

    misty::core::FileTransfer transfers;
    misty::core::FileMasterRemote tracked_file_master(worker_pool_, &transfers);

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";
    props.remote_source.remote_path = "/Documents/report.txt";
    props.local_dest.path = (home_.path() / "Downloads" / "report.txt").string();

    tracked_file_master.cut(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_FALSE(result->success);
    const auto rows = transfers.get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].transfer_type, misty::core::FileTransferType::Download);
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Failed);
    EXPECT_FALSE(rows[0].error_message.empty());
}

TEST_F(FileMasterRemoteTest, TrackedRemoteToLocalCopyCreatesCompletedDownloadTransfer) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());
    proxy.set_download_body("downloaded payload");

    misty::core::FileTransfer transfers;
    misty::core::FileMasterRemote tracked_file_master(worker_pool_, &transfers);

    const fs::path dest = home_.path() / "Downloads" / "report.txt";
    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";
    props.remote_source.remote_path = "/Documents/report.txt";
    props.local_dest.path = dest.string();

    tracked_file_master.copy(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_TRUE(result->success) << result->error_message;
    const auto rows = transfers.get_all_transfers();
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].transfer_type, misty::core::FileTransferType::Download);
    EXPECT_EQ(rows[0].remote_source_name, "drive-work");
    EXPECT_EQ(rows[0].remote_source_path, "/Documents/report.txt");
    EXPECT_EQ(rows[0].local_dest_path, dest.string());
    EXPECT_EQ(rows[0].status, misty::core::FileTransferStatus::Completed);
}

TEST_F(FileMasterRemoteTest, TrackedValidationFailureDoesNotCreateTransfer) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());

    misty::core::FileTransfer transfers;
    misty::core::FileMasterRemote tracked_file_master(worker_pool_, &transfers);

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";

    tracked_file_master.remove(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_FALSE(result->success);
    EXPECT_TRUE(transfers.get_all_transfers().empty());
}

TEST_F(FileMasterRemoteTest, ValidationFailureDoesNotCallProxy) {
    FakeRemoteProxy proxy;
    proxy.start();
    proxy.configure_env(home_.path());

    std::optional<misty::core::FileMasterResult> result;
    misty::core::FileMasterProps props;
    props.remote_source.remote_name = "drive-work";

    file_master_.remove(props, [&](misty::core::FileMasterResult value) {
        result = std::move(value);
    });

    ASSERT_TRUE(wait_for([&]() { return result.has_value(); }));
    ASSERT_FALSE(result->success);
    EXPECT_TRUE(proxy.requests().empty());
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

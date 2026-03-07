#include "vault_state.h"

#include <chrono>
#include <cstring>
#include <iostream>
#include <sstream>
#include <thread>

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include "core/manager/env_manager.h"
#include "core/manager/session_manager.h"
#include "core/net/http_client.h"

namespace misty::panel {

    using nlohmann::json;

    namespace {
        // Build "PROXY_SERVICE_URL" + path. Returns empty string if not set.
        std::string proxy_url(const std::string& path) {
            std::string base = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
            if (base.empty()) return "";
            return base + path;
        }

        std::map<std::string, std::string> json_headers() {
            auto headers = core::SessionManager::get().get_auth_headers();
            headers["Content-Type"] = "application/json";
            headers["Accept"] = "application/json";
            return headers;
        }
    } // namespace

    VaultState::VaultState() = default;

    VaultState::~VaultState() {
        // Best-effort: give in-flight SSE consumers up to 2 seconds to drain
        // before we tear down. They run as detached threads so we can't join
        // them, but they only touch this VaultState by capturing `this`, and
        // the application destroys VaultState only at process shutdown when
        // the threads will be killed by the OS regardless.
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
        while (active_streams_.load() > 0 && std::chrono::steady_clock::now() < deadline) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
    }

    void VaultState::init(core::WorkerPool& pool) {
        if (worker_pool_) return;
        worker_pool_ = &pool;
        refresh_repos();
    }

    void VaultState::post_error(const std::string& msg) {
        // Caller MUST hold mu.
        error_msg = msg;
        std::cerr << "vault: " << msg << std::endl;
    }

    // ---- Repos -------------------------------------------------------------

    void VaultState::refresh_repos() {
        if (!worker_pool_) return;
        {
            std::lock_guard<std::mutex> lock(mu);
            error_msg.clear();
            is_refreshing = true;
        }

        worker_pool_->add(
            [this]() {
                std::string url = proxy_url("/api/vault/repos");
                if (url.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("PROXY_SERVICE_URL not set");
                    is_refreshing = false;
                    initial_load_done = true;
                    return;
                }
                auto resp = core::HTTPClient::get().get(
                    url,
                    {.headers = core::SessionManager::get().get_auth_headers()});

                std::lock_guard<std::mutex> lock(mu);
                is_refreshing = false;
                initial_load_done = true;
                if (resp.status_code < 200 || resp.status_code >= 300) {
                    post_error("GET /vault/repos: HTTP " + std::to_string(resp.status_code) + " " + resp.body);
                    return;
                }
                try {
                    auto j = json::parse(resp.body);
                    std::set<VaultRepo> next;
                    if (j.is_array()) {
                        for (const auto& r : j) {
                            VaultRepo repo;
                            repo.name       = r.value("name", "");
                            repo.url        = r.value("url", "");
                            repo.created_at = r.value("created_at", "");
                            if (!repo.name.empty()) next.insert(std::move(repo));
                        }
                    }
                    repos_ = std::move(next);
                } catch (const std::exception& ex) {
                    post_error(std::string("parse repos: ") + ex.what());
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                post_error("refresh_repos: " + err);
                is_refreshing = false;
                initial_load_done = true;
            }
        );
    }

    bool VaultState::has_repos() {
        std::lock_guard<std::mutex> lock(mu);
        return !repos_.empty();
    }

    void VaultState::create_repo(const std::string& name,
                                 const std::string& url,
                                 const std::string& password) {
        if (!worker_pool_) return;
        json body = {{"name", name}, {"url", url}, {"password", password}};
        std::string body_str = body.dump();

        worker_pool_->add(
            [this, body_str]() {
                std::string endpoint = proxy_url("/api/vault/repos");
                if (endpoint.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("PROXY_SERVICE_URL not set");
                    return;
                }
                auto resp = core::HTTPClient::get().post(
                    endpoint,
                    body_str,
                    {.headers = json_headers()});
                if (resp.status_code != 201) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("create_repo: HTTP " + std::to_string(resp.status_code) + " " + resp.body);
                    return;
                }
                {
                    std::lock_guard<std::mutex> lock(mu);
                    success_msg = "Repository created.";
                }
                refresh_repos();
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                post_error("create_repo: " + err);
            }
        );
    }

    void VaultState::delete_repo(const std::string& name) {
        if (!worker_pool_) return;
        worker_pool_->add(
            [this, name]() {
                std::string endpoint = proxy_url("/api/vault/repos?name=" + core::url_encode(name));
                if (endpoint.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("PROXY_SERVICE_URL not set");
                    return;
                }
                auto resp = core::HTTPClient::get().del(
                    endpoint,
                    {.headers = core::SessionManager::get().get_auth_headers()});
                if (resp.status_code < 200 || resp.status_code >= 300) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("delete_repo: HTTP " + std::to_string(resp.status_code) + " " + resp.body);
                    return;
                }
                refresh_repos();
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                post_error("delete_repo: " + err);
            }
        );
    }

    // ---- Snapshots --------------------------------------------------------

    void VaultState::refresh_snapshots(const std::string& repo_name) {
        if (!worker_pool_ || repo_name.empty()) return;
        worker_pool_->add(
            [this, repo_name]() {
                std::string endpoint = proxy_url("/api/vault/snapshots?repo=" + core::url_encode(repo_name));
                if (endpoint.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("PROXY_SERVICE_URL not set");
                    return;
                }
                auto resp = core::HTTPClient::get().get(
                    endpoint,
                    {.headers = core::SessionManager::get().get_auth_headers()});
                if (resp.status_code < 200 || resp.status_code >= 300) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("refresh_snapshots: HTTP " + std::to_string(resp.status_code) + " " + resp.body);
                    return;
                }
                try {
                    auto j = json::parse(resp.body);
                    std::vector<VaultSnapshot> next;
                    if (j.is_array()) {
                        for (const auto& s : j) {
                            VaultSnapshot snap;
                            snap.id       = s.value("short_id", s.value("id", std::string("")));
                            snap.time     = s.value("time", "");
                            snap.hostname = s.value("hostname", "");
                            if (s.contains("paths") && s["paths"].is_array()) {
                                for (const auto& p : s["paths"]) snap.paths.push_back(p.get<std::string>());
                            }
                            if (s.contains("tags") && s["tags"].is_array()) {
                                for (const auto& t : s["tags"]) snap.tags.push_back(t.get<std::string>());
                            }
                            next.push_back(std::move(snap));
                        }
                    }
                    std::lock_guard<std::mutex> lock(mu);
                    snapshots_by_repo_[repo_name] = std::move(next);
                } catch (const std::exception& ex) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error(std::string("parse snapshots: ") + ex.what());
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                post_error("refresh_snapshots: " + err);
            }
        );
    }

    // ---- Backup / restore -------------------------------------------------

    void VaultState::start_backup(const std::string& repo_name,
                                  const std::vector<std::string>& paths,
                                  const std::vector<std::string>& tags) {
        if (!worker_pool_) return;
        json body;
        body["repo"]  = repo_name;
        body["paths"] = paths;
        if (!tags.empty()) body["tags"] = tags;
        std::string body_str = body.dump();

        worker_pool_->add(
            [this, body_str]() {
                std::string endpoint = proxy_url("/api/vault/backup");
                if (endpoint.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("PROXY_SERVICE_URL not set");
                    return;
                }
                auto resp = core::HTTPClient::get().post(
                    endpoint,
                    body_str,
                    {.headers = json_headers()});
                if (resp.status_code != 202) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("start_backup: HTTP " + std::to_string(resp.status_code) + " " + resp.body);
                    return;
                }
                try {
                    auto j = json::parse(resp.body);
                    std::string job_id = j.value("job_id", "");
                    if (job_id.empty()) {
                        std::lock_guard<std::mutex> lock(mu);
                        post_error("start_backup: missing job_id in response");
                        return;
                    }
                    spawn_job_stream(job_id, "backup");
                } catch (const std::exception& ex) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error(std::string("parse start_backup: ") + ex.what());
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                post_error("start_backup: " + err);
            }
        );
    }

    void VaultState::start_restore(const std::string& repo_name,
                                   const std::string& snapshot_id,
                                   const std::string& target_dir) {
        if (!worker_pool_) return;
        json body = {{"repo", repo_name}, {"snapshot_id", snapshot_id}, {"target", target_dir}};
        std::string body_str = body.dump();

        worker_pool_->add(
            [this, body_str]() {
                std::string endpoint = proxy_url("/api/vault/restore");
                if (endpoint.empty()) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("PROXY_SERVICE_URL not set");
                    return;
                }
                auto resp = core::HTTPClient::get().post(
                    endpoint,
                    body_str,
                    {.headers = json_headers()});
                if (resp.status_code != 202) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("start_restore: HTTP " + std::to_string(resp.status_code) + " " + resp.body);
                    return;
                }
                try {
                    auto j = json::parse(resp.body);
                    std::string job_id = j.value("job_id", "");
                    if (job_id.empty()) {
                        std::lock_guard<std::mutex> lock(mu);
                        post_error("start_restore: missing job_id");
                        return;
                    }
                    spawn_job_stream(job_id, "restore");
                } catch (const std::exception& ex) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error(std::string("parse start_restore: ") + ex.what());
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                post_error("start_restore: " + err);
            }
        );
    }

    void VaultState::cancel_job(const std::string& job_id) {
        if (!worker_pool_ || job_id.empty()) return;
        worker_pool_->add(
            [this, job_id]() {
                std::string endpoint = proxy_url("/api/vault/jobs/" + job_id + "/cancel");
                if (endpoint.empty()) return;
                auto resp = core::HTTPClient::get().post(
                    endpoint,
                    "",
                    {.headers = json_headers()});
                if (resp.status_code < 200 || resp.status_code >= 300) {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("cancel_job: HTTP " + std::to_string(resp.status_code) + " " + resp.body);
                }
            },
            []() {},
            [this](const std::string& err) {
                std::lock_guard<std::mutex> lock(mu);
                post_error("cancel_job: " + err);
            }
        );
    }

    // ---- Snapshot accessors -----------------------------------------------

    std::vector<VaultRepo> VaultState::repos_snapshot() {
        std::lock_guard<std::mutex> lock(mu);
        return std::vector<VaultRepo>(repos_.begin(), repos_.end());
    }

    std::vector<VaultSnapshot> VaultState::snapshots_for(const std::string& repo_name) {
        std::lock_guard<std::mutex> lock(mu);
        auto it = snapshots_by_repo_.find(repo_name);
        if (it == snapshots_by_repo_.end()) return {};
        return it->second;
    }

    std::vector<VaultJobProgress> VaultState::active_jobs_snapshot() {
        std::lock_guard<std::mutex> lock(mu);
        std::vector<VaultJobProgress> out;
        out.reserve(job_order_.size());
        for (const auto& id : job_order_) {
            auto it = jobs_.find(id);
            if (it != jobs_.end()) out.push_back(it->second);
        }
        return out;
    }

    bool VaultState::latest_job(VaultJobProgress& out) {
        std::lock_guard<std::mutex> lock(mu);
        if (job_order_.empty()) return false;
        auto it = jobs_.find(job_order_.front());
        if (it == jobs_.end()) return false;
        out = it->second;
        return true;
    }

    // ---- SSE consumer -----------------------------------------------------

    // Implemented as a member function so the libcurl write callback can
    // touch jobs_/job_order_ directly. The consumer runs on a detached
    // thread (not the worker pool) because backups can run for hours and
    // would otherwise starve other tasks.
    void VaultState::spawn_job_stream(const std::string& job_id, const std::string& job_type) {
        // Seed a placeholder so the UI can render the job card immediately
        // even before the first SSE byte arrives.
        {
            std::lock_guard<std::mutex> lock(mu);
            VaultJobProgress p;
            p.job_id   = job_id;
            p.job_type = job_type;
            p.state    = "running";
            jobs_[job_id] = p;
            job_order_.push_front(job_id);
            // Cap history so the UI doesn't accumulate forever.
            while (job_order_.size() > 16) {
                auto evicted = job_order_.back();
                job_order_.pop_back();
                jobs_.erase(evicted);
            }
        }

        active_streams_.fetch_add(1);
        std::string url = proxy_url("/api/vault/jobs/" + job_id + "/stream");
        if (url.empty()) {
            active_streams_.fetch_sub(1);
            std::lock_guard<std::mutex> lock(mu);
            post_error("spawn_job_stream: PROXY_SERVICE_URL not set");
            return;
        }

        // Detached worker — long-lived, doesn't belong on the bounded
        // worker pool because it'd starve other tasks for the duration of
        // the backup.
        std::thread([this, job_id, job_type, url]() {
            CURL* curl = curl_easy_init();
            if (!curl) {
                {
                    std::lock_guard<std::mutex> lock(mu);
                    post_error("SSE: curl_easy_init failed");
                }
                active_streams_.fetch_sub(1);
                return;
            }

            struct Ctx {
                VaultState* self;
                std::string job_id;
                std::string pending;       // raw byte buffer
                std::string current_event; // last "event: …" line
            } ctx{this, job_id, "", ""};

            auto write_cb = +[](void* contents, size_t size, size_t nmemb, void* userp) -> size_t {
                size_t n = size * nmemb;
                Ctx* c = static_cast<Ctx*>(userp);
                c->pending.append(static_cast<char*>(contents), n);

                // Parse line-by-line; SSE frames terminate on a blank line.
                size_t pos;
                while ((pos = c->pending.find('\n')) != std::string::npos) {
                    std::string line = c->pending.substr(0, pos);
                    c->pending.erase(0, pos + 1);
                    if (!line.empty() && line.back() == '\r') line.pop_back();

                    if (line.empty()) {
                        // End of frame — nothing buffered to flush; data
                        // lines have already been applied below.
                        c->current_event.clear();
                        continue;
                    }
                    if (line.rfind("event: ", 0) == 0) {
                        c->current_event = line.substr(7);
                    } else if (line.rfind("data: ", 0) == 0) {
                        std::string payload = line.substr(6);
                        try {
                            auto j = json::parse(payload);

                            std::lock_guard<std::mutex> lock(c->self->mu);
                            auto it = c->self->jobs_.find(c->job_id);
                            if (it == c->self->jobs_.end()) continue;
                            auto& p = it->second;

                            if (c->current_event == "state") {
                                // Final/initial Job snapshot. Fields match
                                // proxy/core/jobs/jobs.go Job struct.
                                if (j.contains("state")) p.state = j.value("state", "running");
                                if (j.contains("type"))  p.job_type = j.value("type", p.job_type);
                                if (j.contains("error")) p.error = j.value("error", "");
                            } else if (c->current_event == "progress") {
                                // Inner Event{Payload:ProgressEvent}.
                                if (j.contains("payload") && j["payload"].is_object()) {
                                    const auto& pe = j["payload"];
                                    if (pe.contains("type") && pe["type"] == "error") {
                                        p.error = pe.value("error_message", "");
                                    } else {
                                        p.percent_done       = pe.value("percent_done", p.percent_done);
                                        p.total_files        = pe.value("total_files", p.total_files);
                                        p.files_processed    = pe.value("files_processed", p.files_processed);
                                        p.total_bytes        = pe.value("total_bytes", p.total_bytes);
                                        p.bytes_processed    = pe.value("bytes_processed", p.bytes_processed);
                                        p.current_file       = pe.value("current_file", p.current_file);
                                        p.seconds_elapsed    = pe.value("seconds_elapsed", p.seconds_elapsed);
                                        p.seconds_remaining  = pe.value("seconds_remaining", p.seconds_remaining);
                                        if (pe.contains("snapshot_id")) {
                                            p.snapshot_id = pe.value("snapshot_id", p.snapshot_id);
                                        }
                                    }
                                }
                            }
                        } catch (const std::exception&) {
                            // ignore malformed JSON line — the SSE stream
                            // is best-effort and may include keepalives
                        }
                    }
                }
                return n;
            };

            auto headers = core::SessionManager::get().get_auth_headers();
            headers["Accept"] = "text/event-stream";

            struct curl_slist* hl = nullptr;
            for (const auto& [k, v] : headers) {
                hl = curl_slist_append(hl, (k + ": " + v).c_str());
            }

            curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hl);
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &ctx);
            // No total timeout — backups can run for hours. Just guard the
            // initial connect.
            curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 10L);
            curl_easy_setopt(curl, CURLOPT_TIMEOUT, 0L);
            curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

            CURLcode rc = curl_easy_perform(curl);
            long http_code = 0;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);

            if (hl) curl_slist_free_all(hl);
            curl_easy_cleanup(curl);

            // Mark the job finished from the C++ side regardless of how the
            // stream ended. The terminal "state" event from the server has
            // usually already updated p.state — we just flag finished=true.
            {
                std::lock_guard<std::mutex> lock(mu);
                auto it = jobs_.find(job_id);
                if (it != jobs_.end()) {
                    it->second.finished = true;
                    if (rc != CURLE_OK) {
                        std::ostringstream oss;
                        oss << "SSE error: " << curl_easy_strerror(rc);
                        if (it->second.error.empty()) it->second.error = oss.str();
                        if (it->second.state == "running") it->second.state = "failed";
                    }
                }
            }
            active_streams_.fetch_sub(1);
        }).detach();
    }

}

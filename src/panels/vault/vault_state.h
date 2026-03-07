#pragma once

#include <atomic>
#include <deque>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/threading/worker_pool.h"
#include "core/ui/ui_registry.h"

namespace misty::panel {

    // VaultRepo mirrors restic.RepoConfig over the wire (proxy/api/vault).
    struct VaultRepo {
        std::string name;
        std::string url;          // e.g. "local:/path", "rclone:onedrive-x:/dir"
        std::string created_at;   // RFC3339; we don't parse, just display

        bool operator<(const VaultRepo& other) const { return name < other.name; }
    };

    struct VaultSnapshot {
        std::string id;           // short id from restic
        std::string time;         // RFC3339
        std::string hostname;
        std::vector<std::string> paths;
        std::vector<std::string> tags;
    };

    // Latest progress snapshot from the proxy SSE stream. The fields match
    // proxy/core/restic ProgressEvent.
    struct VaultJobProgress {
        std::string job_id;
        std::string job_type;     // "backup" | "restore" | "forget"
        std::string state;        // "running" | "succeeded" | "failed" | "cancelled"

        // Live progress (from "progress" SSE events).
        double percent_done = 0.0;
        long long total_files = 0;
        long long files_processed = 0;
        long long total_bytes = 0;
        long long bytes_processed = 0;
        std::string current_file;
        double seconds_elapsed = 0.0;
        double seconds_remaining = 0.0;

        // Set on terminal "state" event (success only).
        std::string snapshot_id;

        // Last error string we saw on the wire (proxy job error or "error"
        // type progress event).
        std::string error;

        // True once the SSE stream closed cleanly (job done, channel closed
        // server-side).
        bool finished = false;
    };

    // VaultState owns all of the C++-side mvault state: registry of repos,
    // last-seen snapshots per repo, and one live progress record per active
    // job. All public methods are safe to call from the UI thread; HTTP work
    // happens on the worker pool, SSE consumers run on dedicated detached
    // threads.
    class VaultState : public core::UIState {
    public:
        VaultState();
        ~VaultState() override;

        // Idempotent — first call wires the worker pool and kicks off an
        // initial repo refresh.
        void init(core::WorkerPool& pool);

        // -------- Repos -------------------------------------------------

        void refresh_repos();
        bool has_repos();

        // POST /api/vault/repos. On success, refreshes repos.
        void create_repo(const std::string& name,
                         const std::string& url,
                         const std::string& password);

        // DELETE /api/vault/repos?name=…
        void delete_repo(const std::string& name);

        // -------- Snapshots --------------------------------------------

        // GET /api/vault/snapshots?repo=… and update snapshots_by_repo[name].
        void refresh_snapshots(const std::string& repo_name);

        // -------- Backup / restore -------------------------------------

        // POST /api/vault/backup. On success, the returned job_id is
        // automatically subscribed to via spawn_job_stream().
        void start_backup(const std::string& repo_name,
                          const std::vector<std::string>& paths,
                          const std::vector<std::string>& tags);

        // POST /api/vault/restore. Same SSE auto-subscribe behavior.
        void start_restore(const std::string& repo_name,
                           const std::string& snapshot_id,
                           const std::string& target_dir);

        // POST /api/vault/jobs/{id}/cancel
        void cancel_job(const std::string& job_id);

        // -------- Snapshots ---------------------------------------------

        // Locked accessors so the panel can render without exposing mu.
        std::vector<VaultRepo>     repos_snapshot();
        std::vector<VaultSnapshot> snapshots_for(const std::string& repo_name);
        std::vector<VaultJobProgress> active_jobs_snapshot();

        // The most recently active job — used by the panel to surface a
        // progress card without forcing the user to pick which job to watch.
        // Returns false if no job has been started this session.
        bool latest_job(VaultJobProgress& out);

        // -------- UI-shared state --------------------------------------

        std::mutex mu;                       // protects all fields below
        std::string error_msg;
        std::string success_msg;
        bool is_refreshing = false;
        bool initial_load_done = false;

        // Modal flags driven by panel buttons.
        bool show_create_repo_modal = false;
        bool show_backup_modal = false;
        bool show_restore_modal = false;

        // Currently selected repo (for snapshot list / backup target).
        std::string selected_repo;

        // Currently selected snapshot id (for restore).
        std::string selected_snapshot;

        // Buffers backing the modal text fields. Owned by VaultState (not
        // the panel) so the modal can survive a render restart.
        char create_name_buf[128]    = {0};
        char create_url_buf[512]     = {0};
        char create_password_buf[256] = {0};

        char backup_paths_buf[1024]  = {0};   // newline-separated
        char backup_tags_buf[256]    = {0};   // comma-separated

        char restore_target_buf[1024] = {0};

    private:
        // Internal: spawn a detached SSE consumer thread for a job.
        void spawn_job_stream(const std::string& job_id, const std::string& job_type);

        // Push an error onto the UI under mu_.
        void post_error(const std::string& msg);

        core::WorkerPool* worker_pool_ = nullptr;

        // Registry, indexed by repo name.
        std::set<VaultRepo> repos_;
        std::unordered_map<std::string, std::vector<VaultSnapshot>> snapshots_by_repo_;

        // job_id -> live progress
        std::unordered_map<std::string, VaultJobProgress> jobs_;
        std::deque<std::string> job_order_;   // newest at the front

        // Number of detached SSE consumers in flight; used by destructor to
        // refuse cleanup until they exit (we keep these threads short-lived).
        std::atomic<int> active_streams_{0};
    };
}

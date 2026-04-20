#pragma once

#include <string>
#include <mutex>
#include <atomic>
#include <memory>
#include <set>
#include <unordered_map>
#include <vector>
#include <functional>
#include "core/ui/ui_registry.h"
#include "core/net/http_client.h"
#include "core/threading/worker_pool.h"
#include "core/sync/fs_watcher.h"

namespace misty::panel {

    // Unified remote connection — replaces per-provider MSConnection, GDConnection, etc.
    struct RemoteConnection {
        std::string name;           // rclone remote name, e.g. "onedrive-john"
        std::string type;           // provider type: "onedrive", "drive", "dropbox", etc.
        std::string display_name;   // friendly display name
        std::string alias;          // user-defined local label shown in UI and paths
        bool connected = true;

        bool operator<(const RemoteConnection& other) const {
            return name < other.name;
        }
    };

    // Snapshot for rendering a remote card in the UI
    struct RemoteCardState {
        std::string name;
        std::string type;
        std::string display_name;
        std::string alias;
        bool connected = false;
    };

    // Unified callback types
    using FilesCallback = std::function<void(bool success,
                                             const std::string& response_body,
                                             const std::string& error)>;

    using DownloadCallback = std::function<void(bool success,
                                                const std::string& local_path,
                                                const std::string& error)>;
    using DownloadProgressCallback = core::DownloadProgressCallback;

    using CreateFolderCallback = std::function<void(bool success,
                                                     const std::string& response_body,
                                                     const std::string& error)>;

    using UploadCallback = std::function<void(bool success, const std::string& error_msg)>;
    using DirtyIndicatorCallback = std::function<void(const std::string& remote,
                                                      const std::string& path,
                                                      bool local_exists,
                                                      bool is_dir,
                                                      const std::string& mtime,
                                                      int64_t size)>;

    class ServicesState : public core::UIState {
    public:
        ServicesState();
        ~ServicesState();

        void init(core::WorkerPool& pool);

        // Refresh all connections from GET /api/remotes
        void refresh_connections();

        // Check if any remotes are connected
        bool has_connections();

        // Check if a specific remote is connected by name
        bool is_remote_connected(const std::string& remote_name);

        // Initiate login for a new remote (POST /api/remotes)
        // Opens rclone's OAuth flow in browser
        void initiate_login(const std::string& provider_type, const std::string& remote_name);

        // Delete a remote (DELETE /api/remotes?name=X)
        void disconnect_remote(const std::string& remote_name);

        // Get a card state for rendering
        bool get_remote_card_state(const std::string& remote_name, RemoteCardState& out);
        std::string get_remote_alias(const std::string& remote_name);
        bool set_remote_alias(const std::string& remote_name, const std::string& alias);

        // File operations — all use unified rclone proxy endpoints
        void fetch_files(const std::string& remote,
                        const std::string& path,
                        FilesCallback callback);

        void refetch_sync_items(const std::string& remote,
                                const std::string& path,
                                FilesCallback callback);

        void watch_sync_dir(const std::string& remote,
                            const std::string& path,
                            FilesCallback callback);

        void unwatch_sync_dir(const std::string& remote,
                              const std::string& path,
                              FilesCallback callback);

        // Triggers an out-of-band poll + reconcile pass on the proxy without
        // waiting for the 30s tick. Intended for the toolbar Refresh button:
        // a click should drain any pending dirty entries and pull remote-side
        // drift immediately before the UI re-lists. When remote is empty the
        // proxy walks every enabled root. Callback carries the JSON summary
        // ({refetched_dirs, dirty_entries}) so the caller can surface progress.
        void run_sync_now(const std::string& remote,
                          FilesCallback callback);

        void fetch_sync_items(const std::string& remote,
                              const std::string& path,
                              FilesCallback callback);

        // Reports a local-only filesystem change to the proxy so the sync
        // index picks it up before the next refetch. mtime may be empty — the
        // proxy will default to "now" in that case.
        void mark_local_dirty(const std::string& remote,
                              const std::string& path,
                              bool local_exists,
                              bool is_dir,
                              const std::string& mtime,
                              int64_t size,
                              FilesCallback callback);

        void download_file(const std::string& remote,
                          const std::string& remote_path,
                          const std::string& local_path,
                          DownloadProgressCallback progress_cb,
                          DownloadCallback callback);

        void upload_file(const std::string& remote,
                        const std::string& remote_path,
                        const std::string& local_path,
                        core::UploadProgressCallback progress_cb,
                        UploadCallback callback);

        void create_folder(const std::string& remote,
                          const std::string& path,
                          CreateFolderCallback callback);

        void search_files(const std::string& remote,
                         const std::string& query,
                         const std::string& path,
                         FilesCallback callback);

        // ----- Local filesystem watcher orchestration -----

        struct RemoteWatchInfo {
            std::string remote_name;   // rclone remote name
            std::string mount_path;    // absolute local path to watch
        };

        // Start/stop FSEvents-backed watchers so each connected remote's
        // on-disk mirror drains change notifications to /api/sync/dirty.
        // Called by the file explorer whenever remote_mappings is rebuilt.
        void reconcile_fs_watchers(const std::vector<RemoteWatchInfo>& watches);

        // Suppress/unsuppress a local path across all active watchers, used
        // by the downloader so its own writes don't round-trip back through
        // the dirty pipeline.
        void suppress_fs_path(const std::string& local_path);
        void unsuppress_fs_path(const std::string& local_path);
        void register_dirty_indicator_callback(const std::string& key, DirtyIndicatorCallback callback);

        std::mutex mu;
        std::string error_msg;
        std::string success_msg;
        bool is_refreshing = false;
        bool initial_load_done = false;

        std::set<RemoteConnection> connections;

        // Set to true whenever `connections` changes (e.g. after a successful
        // refresh or a new remote is added). The file explorer panel polls
        // this on each render and re-runs sync_account_mappings() to keep
        // workspace.remote_mappings and on-disk mount directories in sync
        // without requiring the user to navigate.
        std::atomic<bool> mappings_dirty{false};

        // Login modal state
        bool show_login_modal = false;
        std::string login_provider_type;  // which type to add
        std::string auth_error;

        // ----- Interactive remote-config flow -----

        enum class ConfigStepKind {
            NONE,     // no flow active
            DONE,     // flow completed
            CHOOSE,   // exclusive: must pick from examples
            SUGGEST,  // examples + free text
            CONFIRM,  // yes/no
            INPUT,    // free text
        };

        struct ConfigChoice {
            std::string value;
            std::string label;
            std::string help;
        };

        // Current step from the proxy. Mutated by config_step_loaded() on
        // worker callbacks; read by the modal on the UI thread under `mu`.
        bool          config_modal_open    = false;
        bool          config_in_flight     = false; // POST in progress
        ConfigStepKind config_kind         = ConfigStepKind::NONE;
        std::string   config_remote_name;            // rclone name being built
        std::string   config_provider_type;          // "onedrive", etc.
        std::string   config_state;                  // opaque round-trip token
        std::string   config_question_name;          // option.name
        std::string   config_question_help;          // option.help
        std::string   config_default;                // option.default
        bool          config_question_password = false;
        char          config_input_buf[512] = {0};   // ImGui::InputText buffer
        std::vector<ConfigChoice> config_choices;    // for CHOOSE/SUGGEST/CONFIRM
        std::string   config_error;                  // last server-side error
        std::string   config_warning;                // non-fatal step warning

        // POST /api/remotes/config/start
        void start_remote_config(const std::string& provider_type,
                                 const std::string& remote_name);

        // POST /api/remotes/config/continue with the user's chosen result
        void continue_remote_config(const std::string& result);

        // DELETE /api/remotes/config?name=… and reset modal state
        void cancel_remote_config();

    private:
        void load_remote_aliases_locked();
        void save_remote_aliases_locked() const;

        struct WatchEntry {
            std::string mount_path;
            std::unique_ptr<core::sync::FsWatcher> watcher;
        };

        void dispatch_fs_events(const std::string& remote_name,
                                const std::string& mount_path,
                                std::vector<core::sync::FsEvent> events);

        core::WorkerPool* worker_pool_ = nullptr;
        std::unordered_map<std::string, std::string> remote_aliases_;

        std::mutex watchers_mu_;
        std::unordered_map<std::string, WatchEntry> watchers_;
        std::mutex dirty_indicator_mu_;
        std::unordered_map<std::string, DirtyIndicatorCallback> dirty_indicator_callbacks_;
    };
}

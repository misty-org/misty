#pragma once

#include <string>
#include <mutex>
#include <atomic>
#include <set>
#include <vector>
#include <functional>
#include "core/ui/ui_registry.h"
#include "core/net/http_client.h"
#include "core/threading/worker_pool.h"

namespace misty::panel {

    // Unified remote connection — replaces per-provider MSConnection, GDConnection, etc.
    struct RemoteConnection {
        std::string name;           // rclone remote name, e.g. "onedrive-john"
        std::string type;           // provider type: "onedrive", "drive", "dropbox", etc.
        std::string display_name;   // friendly display name
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

        // File operations — all use unified rclone proxy endpoints
        void fetch_files(const std::string& remote,
                        const std::string& path,
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
        core::WorkerPool* worker_pool_ = nullptr;
    };
}

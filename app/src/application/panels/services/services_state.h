#pragma once

#include <string>
#include <mutex>
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

        // Login modal state
        bool show_login_modal = false;
        std::string login_provider_type;  // which type to add
        std::string auth_error;

    private:
        core::WorkerPool* worker_pool_ = nullptr;
    };
}

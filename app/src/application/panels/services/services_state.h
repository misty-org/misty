#pragma once

#include <string>
#include <mutex>
#include <set>
#include <functional>
#include "core/ui_registry.h"
#include "core/worker_pool.h"

namespace misty::panel {

    // Microsoft account profile information (returned by proxy)
    struct MSUserProfile {
        std::string display_name;
        std::string email;
        std::string user_principal_name;
        std::string id;
        bool loaded = false;
    };

    // Represents a single OneDrive connection (no tokens stored client-side)
    struct MSConnection {
        MSUserProfile profile;
        bool is_authenticated = false;

        // Comparison operator for std::set - use profile.id (ms_user_id) as primary key
        bool operator<(const MSConnection& other) const {
            return profile.id < other.profile.id;
        }
    };

    // Callback types for OneDrive API operations
    using DriveCallback = std::function<void(const std::string& ms_user_id,
                                              const std::string& drive_id,
                                              bool success,
                                              const std::string& error)>;

    using FilesCallback = std::function<void(bool success,
                                              const std::string& response_body,
                                              const std::string& error)>;

    using DownloadCallback = std::function<void(bool success,
                                                 const std::string& local_path,
                                                 const std::string& error)>;

    // Snapshot of a single OneDrive connection for UI rendering
    struct OneDriveCardState {
        bool profile_loaded = false;
        bool is_connected = false;
        MSUserProfile profile;
    };

    // Google Drive account profile information (returned by proxy)
    struct GDUserProfile {
        std::string display_name;
        std::string email;
        std::string id;
        bool loaded = false;
    };

    // Represents a single Google Drive connection (no tokens stored client-side)
    struct GDConnection {
        GDUserProfile profile;
        bool is_authenticated = false;

        bool operator<(const GDConnection& other) const {
            return profile.id < other.profile.id;
        }
    };

    // Callback types for Google Drive API operations
    using GDFilesCallback = std::function<void(bool success,
                                                const std::string& response_body,
                                                const std::string& error)>;

    using GDDownloadCallback = std::function<void(bool success,
                                                   const std::string& local_path,
                                                   const std::string& error)>;

    // Snapshot of a single Google Drive connection for UI rendering
    struct GDriveCardState {
        bool profile_loaded = false;
        bool is_connected = false;
        GDUserProfile profile;
    };

    class ServicesState : public core::UIState {
    public:
        ServicesState();
        ~ServicesState();

        // Must be called before any async methods. Idempotent.
        void init(core::WorkerPool& pool);

        bool has_ms_connections();
        void check_connections();
        bool get_onedrive_card_state(const std::string& ms_user_id, OneDriveCardState& out);
        void mark_disconnected(const std::string& ms_user_id);
        void initiate_ms_login();
        void disconnect_onedrive(const std::string& ms_user_id);
        bool is_account_folder_connected(const std::string& folder_name);

        // OneDrive file operations (proxy handles tokens internally)
        void fetch_drive(const std::string& ms_user_id, DriveCallback callback);
        void fetch_onedrive_files(const std::string& ms_user_id,
                                  const std::string& drive_id,
                                  const std::string& folder_id,
                                  FilesCallback callback);
        void download_file(const std::string& ms_user_id,
                          const std::string& drive_id,
                          const std::string& file_id,
                          const std::string& local_path,
                          DownloadCallback callback);

        // Helper to find connections
        std::set<MSConnection>::iterator find_by_ms_user_id(const std::string& ms_user_id);

        // Google Drive connection management
        bool has_gd_connections();
        void check_gd_connections();
        bool get_gdrive_card_state(const std::string& gd_user_id, GDriveCardState& out);
        void mark_gd_disconnected(const std::string& gd_user_id);
        void initiate_gd_login();
        void disconnect_gdrive(const std::string& gd_user_id);
        bool is_gd_account_folder_connected(const std::string& folder_name);

        // Google Drive file operations
        void fetch_gdrive_files(const std::string& gd_user_id,
                                const std::string& folder_id,
                                GDFilesCallback callback);
        void download_gd_file(const std::string& gd_user_id,
                              const std::string& file_id,
                              const std::string& local_path,
                              GDDownloadCallback callback);

        std::set<GDConnection>::iterator find_by_gd_user_id(const std::string& gd_user_id);

        std::mutex mu;
        std::string error_msg = "";
        std::string success_msg = "";
        std::set<MSConnection> ms_connections;
        bool show_ms_login_modal = false;
        std::string ms_auth_error;

        std::set<GDConnection> gd_connections;
        bool show_gd_login_modal = false;
        std::string gd_auth_error;

    private:
        core::WorkerPool* worker_pool_ = nullptr;
    };
}

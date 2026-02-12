#include "core/file_sync_service.h"
#include "panels/file_explorer/file_explorer_state.h"
#include <chrono>
#include <filesystem>
#include <iostream>

namespace fs = std::filesystem;

namespace misty::core {

    FileSyncService::FileSyncService(UIRegistry& registry)
        : registry_(registry) {}

    FileSyncService::~FileSyncService() {
        stop();
    }

    void FileSyncService::start() {
        if (running_) return;
        running_ = true;
        worker_thread_ = std::thread(&FileSyncService::update_loop, this);
    }

    void FileSyncService::stop() {
        running_ = false;
        if (worker_thread_.joinable()) {
            worker_thread_.join();
        }
    }

    void FileSyncService::update_loop() {
        while (running_) {
            try {
                // Access FileExplorer state
                // Note: We need to be careful about thread safety.
                // FileExplorerState has a mutex 'mu'.
                
                // We use try_lock to avoid blocking UI thread if it's busy?
                // Or just lock. UI is fast.
                
                auto& state = registry_.get_state<panel::FileExplorerState>("FileExplorer");
                
                bool updated = false;
                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    
                    for (auto& file : state.files) {
                        panel::SyncStatus old_status = file.status;
                        panel::SyncStatus new_status = old_status; // Default keep same

                        if (file.is_dir) {
                            new_status = panel::SyncStatus::LOCAL;
                        } else if (file.source == panel::FileSource::LOCAL) {
                            new_status = panel::SyncStatus::LOCAL;
                        } else {
                            // Cloud file (OneDrive/GDrive)
                            std::error_code ec;
                            if (fs::exists(file.path, ec) && !ec) {
                                // Exists locally
                                if (file.source == panel::FileSource::GDRIVE 
                                    && file.gd_mime_type.rfind("application/vnd.google-apps.", 0) == 0
                                    && file.size == 0) {
                                    // GDrive doc link
                                    new_status = panel::SyncStatus::SYNCED;
                                } else {
                                    // Check size
                                    try {
                                        uintmax_t local_size = fs::file_size(file.path, ec);
                                        if (!ec && local_size == (uintmax_t)file.size) {
                                            new_status = panel::SyncStatus::SYNCED;
                                        } else {
                                            new_status = panel::SyncStatus::MODIFIED;
                                        }
                                    } catch (...) {
                                        new_status = panel::SyncStatus::MODIFIED;
                                    }
                                }
                            } else {
                                new_status = panel::SyncStatus::NOT_SYNCED;
                            }
                        }

                        if (new_status != old_status) {
                            file.status = new_status;
                            updated = true;
                        }
                    }
                }
                
                // Sleep for 1 second
                std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            } catch (const std::exception& e) {
                std::cerr << "FileSyncService error: " << e.what() << std::endl;
                std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            }
        }
    }

} // namespace misty::core

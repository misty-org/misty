#include "core/threading/file_sync_service.h"
#include "panels/file_explorer/file_explorer_state.h"
#include <chrono>
#include <filesystem>
#include <iostream>
#include <unordered_map>

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
                // 1. Snapshot state (hold lock briefly)
                std::vector<panel::UnifiedFileItem> snapshot_files;
                std::string snapshot_path;
                {
                    auto& state = registry_.get_state<panel::FileExplorerState>("Files");
                    std::lock_guard<std::mutex> lock(state.mu);
                    snapshot_files = state.files;
                    snapshot_path = state.current_path;
                }

                if (snapshot_files.empty()) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
                    continue;
                }

                // 2. Process IO (no lock)
                std::vector<std::pair<std::string, panel::SyncStatus>> updates;
                bool any_update = false;

                for (const auto& file : snapshot_files) {
                    panel::SyncStatus old_status = file.status;
                    panel::SyncStatus new_status = old_status;

                    if (file.is_dir) {
                        new_status = panel::SyncStatus::LOCAL;
    } else if (file.source == panel::FileSource::LOCAL) {
                        new_status = panel::SyncStatus::LOCAL;
                    } else {
                        // Remote file
                        std::error_code ec;
                        if (fs::exists(file.path, ec) && !ec) {
                            // Exists locally — check size
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
                        } else {
                            new_status = panel::SyncStatus::NOT_SYNCED;
                        }
                    }

                    // Check for trash (Global Override)
                    const char* home = std::getenv("HOME");
                    if (home) {
                        if (file.path.find("/misty/.cache/trash") != std::string::npos) {
                            new_status = panel::SyncStatus::DELETED;
                        }
                    }

                    if (new_status != old_status) {
                        updates.push_back({file.path, new_status});
                        any_update = true;
                    }
                }

                // 3. Apply updates (hold lock briefly)
                if (any_update) {
                    auto& state = registry_.get_state<panel::FileExplorerState>("Files");
                    std::lock_guard<std::mutex> lock(state.mu);
                    
                    // Only apply if we are still in the same directory
                    if (state.current_path == snapshot_path) {
                        std::unordered_map<std::string, size_t> path_map;
                        for (size_t i = 0; i < state.files.size(); ++i) {
                            path_map[state.files[i].path] = i;
                        }

                        for (const auto& update : updates) {
                            auto it = path_map.find(update.first);
                            if (it != path_map.end()) {
                                state.files[it->second].status = update.second;
                            }
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

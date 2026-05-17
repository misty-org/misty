#include "core/threading/file_sync_service.h"
#include "panels/file_explorer/state/file_explorer_state.h"
#include <chrono>
#include <filesystem>
#include <iostream>
#include <unordered_map>

namespace fs = std::filesystem;

namespace misty::core {

    namespace {
        struct FileStatusSnapshot {
            std::string path;
            panel::SyncStatus status = panel::SyncStatus::LOCAL;
        };
    }

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
        uint64_t last_processed_revision = 0;
        while (running_) {
            try {
                // 1. Snapshot state (hold lock briefly)
                std::vector<FileStatusSnapshot> snapshot_files;
                std::string snapshot_path;
                uint64_t snapshot_revision = 0;
                bool snapshot_loading = false;
                {
                    auto& state = registry_.get_state<panel::FileExplorerState>("Files");
                    std::lock_guard<std::mutex> lock(state.mu);
                    snapshot_loading = state.is_loading;
                    snapshot_revision = state.listing_revision.load(std::memory_order_relaxed);
                    snapshot_files.reserve(state.files.size());
                    for (const auto& file : state.files) {
                        snapshot_files.push_back(FileStatusSnapshot{
                            .path = file.path,
                            .status = file.status,
                        });
                    }
                    snapshot_path = state.current_path;
                }

                if (snapshot_loading ||
                    snapshot_files.empty() ||
                    snapshot_revision == 0 ||
                    snapshot_revision == last_processed_revision) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(1000));
                    continue;
                }

                // 2. Process IO (no lock)
                std::vector<std::pair<std::string, panel::SyncStatus>> updates;
                bool any_update = false;

                for (const auto& file : snapshot_files) {
                    panel::SyncStatus new_status = file.status;

                    new_status = panel::SyncStatus::LOCAL;

                    // Check for trash (Global Override)
                    const char* home = std::getenv("HOME");
                    if (home) {
                        if (file.path.find("/misty/.cache/trash") != std::string::npos) {
                            new_status = panel::SyncStatus::DELETED;
                        }
                    }

                    if (new_status != file.status) {
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

                last_processed_revision = snapshot_revision;
                
                // Sleep for 1 second
                std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            } catch (const std::exception& e) {
                std::cerr << "FileSyncService error: " << e.what() << std::endl;
                std::this_thread::sleep_for(std::chrono::milliseconds(1000));
            }
        }
    }

} // namespace misty::core

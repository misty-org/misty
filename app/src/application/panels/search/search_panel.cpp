#include "panels/search/search_panel.h"
#include "panels/search/fuzzy_match.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/services/services_state.h"
#include "core/net/http_client.h"
#include "core/manager/env_manager.h"
#include "core/manager/asset_manager.h"

#include <imgui.h>
#include <nlohmann/json.hpp>
#include <filesystem>
#include <algorithm>
#include <chrono>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace misty::panel {

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static std::string format_size(int64_t bytes) {
    if (bytes <= 0) return "";
    if (bytes < 1024) return std::to_string(bytes) + " B";
    if (bytes < 1024 * 1024) return std::to_string(bytes / 1024) + " KB";
    return std::to_string(bytes / (1024 * 1024)) + " MB";
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

SearchPanel::SearchPanel(core::UIRegistry& ui_registry, core::WorkerPool& worker_pool)
    : ui_registry_(ui_registry), worker_pool_(worker_pool) {}

// ---------------------------------------------------------------------------
// toggle / open
// ---------------------------------------------------------------------------

void SearchPanel::toggle() {
    auto& state = ui_registry_.get_state<SearchState>("Search");
    state.is_open = !state.is_open;
    if (state.is_open) {
        std::lock_guard<std::mutex> lock(state.mu);
        state.cache_results.clear();
        state.api_results.clear();
        state.seen_ids.clear();
        state.pending_api_tasks.store(0);
        state.api_search_done = true;
        state.selected_index = 0;
        state.just_opened = true;
        std::memset(state.query_buf, 0, sizeof(state.query_buf));
        state.last_submitted_query = "";
    }
}

// ---------------------------------------------------------------------------
// submit_search — dispatches local scan + API searches per remote
// ---------------------------------------------------------------------------

void SearchPanel::submit_search(const std::string& query) {
    auto& state = ui_registry_.get_state<SearchState>("Search");

    uint64_t gen;
    {
        std::lock_guard<std::mutex> lock(state.mu);
        ++state.query_generation;
        gen = state.query_generation;
        state.cache_results.clear();
        state.api_results.clear();
        state.seen_ids.clear();
        state.pending_api_tasks.store(0);
        state.api_search_done = false;
        state.selected_index = 0;
    }

    state.last_submitted_query = query;

    // Read current_path on the main thread
    std::string local_root;
    {
        auto& fe_state = ui_registry_.get_state<FileExplorerState>("Files");
        std::lock_guard<std::mutex> lk(fe_state.mu);
        local_root = std::string(fe_state.current_path);
    }

    // Local filesystem scan on worker thread
    worker_pool_.add(
        [this, &state, query, gen, local_root]() {
            scan_local(state, query, gen, local_root);
        },
        []() {},
        [](const std::string&) {}
    );

    // API searches fire in parallel per connected remote
    launch_api_searches(state, query, gen);
}

// ---------------------------------------------------------------------------
// scan_local — recursive local filesystem scan with fuzzy matching
// ---------------------------------------------------------------------------

void SearchPanel::scan_local(SearchState& state, const std::string& query, uint64_t generation, const std::string& local_root) {
    std::vector<SearchResult> results;

    if (!local_root.empty()) {
        std::error_code ec;
        if (fs::exists(local_root, ec)) {
            int local_count = 0;
            const int kMaxLocal = 3000;
            auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(800);
            try {
                for (auto it = fs::recursive_directory_iterator(local_root,
                         fs::directory_options::skip_permission_denied);
                     it != fs::recursive_directory_iterator(); ++it) {
                    if (local_count >= kMaxLocal) break;
                    if (std::chrono::steady_clock::now() > deadline) break;

                    std::string name = it->path().filename().string();
                    if (name.empty() || name[0] == '.') {
                        if (it->is_directory(ec)) it.disable_recursion_pending();
                        continue;
                    }
                    if (it->is_directory(ec) &&
                        (name == "node_modules" || name == "__pycache__" ||
                         name == "build" || name == "dist" || name == ".git")) {
                        it.disable_recursion_pending();
                        continue;
                    }

                    if (state.query_generation != generation) return;

                    int score = search::fuzzy_score(query, name);
                    if (score < 0) continue;

                    std::string path_str = it->path().string();
                    std::string dedup = "local:" + path_str;
                    {
                        std::lock_guard<std::mutex> lk(state.mu);
                        if (state.query_generation != generation) return;
                        if (state.seen_ids.count(dedup)) continue;
                        state.seen_ids.insert(dedup);
                    }

                    SearchResult r;
                    r.name         = name;
                    r.source       = FileSource::LOCAL;
                    r.is_dir       = it->is_directory(ec);
                    r.size         = 0;
                    r.fuzzy_score  = score;
                    r.dedup_key    = dedup;
                    r.virtual_path = path_str;
                    auto rel = fs::relative(it->path(), local_root, ec);
                    r.path_display = rel.parent_path().string();
                    if (r.path_display.empty() || r.path_display == ".")
                        r.path_display = "local";
                    results.push_back(std::move(r));
                    ++local_count;
                }
            } catch (...) {}
        }
    }

    std::sort(results.begin(), results.end(), [](const SearchResult& a, const SearchResult& b) {
        return a.fuzzy_score > b.fuzzy_score;
    });

    {
        std::lock_guard<std::mutex> lock(state.mu);
        if (state.query_generation == generation) {
            state.cache_results = std::move(results);
        }
    }
}

// ---------------------------------------------------------------------------
// launch_api_searches — fires one search per connected remote via unified API
// ---------------------------------------------------------------------------

void SearchPanel::launch_api_searches(SearchState& state, const std::string& query, uint64_t generation) {
    auto& services = ui_registry_.get_state<ServicesState>("Services");

    // Snapshot connections
    std::vector<RemoteConnection> remotes;
    {
        std::lock_guard<std::mutex> lock(services.mu);
        remotes.assign(services.connections.begin(), services.connections.end());
    }

    if (remotes.empty()) {
        state.api_search_done = true;
        return;
    }

    int total_tasks = static_cast<int>(remotes.size());
    state.pending_api_tasks.store(total_tasks);

    auto finish_task = [&state, generation]() {
        if (state.pending_api_tasks.fetch_sub(1) == 1) {
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.query_generation == generation) {
                state.api_search_done = true;
            }
        }
    };

    for (auto& remote : remotes) {
        std::string remote_name = remote.name;
        std::string display_name = remote.display_name.empty() ? remote.name : remote.display_name;

        services.search_files(remote_name, query, "",
            [this, &state, generation, remote_name, display_name, query, finish_task]
            (bool success, const std::string& body, const std::string& /*error*/) {
                if (!success) {
                    finish_task();
                    return;
                }

                json j = json::parse(body, nullptr, false);
                if (j.is_discarded()) {
                    finish_task();
                    return;
                }

                std::string mount_root = path_utils::get_mount_root();
                std::vector<SearchResult> results;

                for (auto& item : j.value("items", json::array())) {
                    std::string name = item.value("name", "");
                    if (name.empty()) continue;

                    int score = search::fuzzy_score(query, name);
                    if (score < 0) score = 0;

                    std::string item_path = item.value("path", "");
                    std::string dedup = "remote:" + remote_name + "/" + item_path;

                    SearchResult r;
                    r.name         = name;
                    r.source       = FileSource::REMOTE;
                    r.is_dir       = item.value("is_dir", false);
                    r.size         = item.value("size", int64_t(0));
                    r.fuzzy_score  = score;
                    r.dedup_key    = dedup;
                    r.remote_name  = remote_name;
                    r.remote_path  = item_path;
                    r.virtual_path = mount_root + "/" + remote_name + (item_path.empty() ? "" : "/" + item_path);
                    r.path_display = display_name + (item_path.empty() ? "" : " › " + item_path);

                    // Trim filename from path_display to show parent
                    if (!r.is_dir && !item_path.empty()) {
                        fs::path p(item_path);
                        std::string parent = p.parent_path().string();
                        r.path_display = display_name + (parent.empty() ? "" : " › " + parent);
                    }

                    results.push_back(std::move(r));
                }

                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.query_generation == generation) {
                        for (auto& r : results) {
                            if (!state.seen_ids.count(r.dedup_key)) {
                                state.seen_ids.insert(r.dedup_key);
                                state.api_results.push_back(std::move(r));
                            }
                        }
                    }
                }
                finish_task();
            });
    }
}

// ---------------------------------------------------------------------------
// navigate_to_result — navigates the file explorer to the item's location.
//
// POLICY: search results NEVER open or execute files. We only reveal the
// containing directory so the user can decide what to do next.
//
// • Local file  → parent directory (never the file path itself)
// • Local dir   → the directory
// • Remote item → virtual_path is the remote folder path
// ---------------------------------------------------------------------------

void SearchPanel::navigate_to_result(const SearchResult& result) {
    auto& fe_state = ui_registry_.get_state<FileExplorerState>("Files");
    std::lock_guard<std::mutex> lock(fe_state.mu);

    std::string dest;
    if (!result.is_dir) {
        fs::path vp(result.virtual_path);
        dest = vp.has_parent_path() ? vp.parent_path().string() : result.virtual_path;
    } else {
        dest = result.virtual_path;
    }

    fe_state.pending_navigation_path = dest;
}

// ---------------------------------------------------------------------------
// render_results — draws the combined sorted result list
// ---------------------------------------------------------------------------

static const char* source_label(FileSource src) {
    switch (src) {
        case FileSource::LOCAL:  return "LOC";
        case FileSource::REMOTE: return "REM";
        default:                 return "?";
    }
}

static ImVec4 source_color(FileSource src) {
    switch (src) {
        case FileSource::LOCAL:  return { 0.70f, 0.70f, 0.70f, 1.0f }; // gray
        case FileSource::REMOTE: return { 0.00f, 0.60f, 0.88f, 1.0f }; // blue
        default:                 return { 0.60f, 0.60f, 0.60f, 1.0f };
    }
}

void SearchPanel::render_results(SearchState& state) {
    std::vector<const SearchResult*> merged;
    {
        std::lock_guard<std::mutex> lock(state.mu);
        merged.reserve(state.cache_results.size() + state.api_results.size());
        for (auto& r : state.cache_results) merged.push_back(&r);
        for (auto& r : state.api_results)   merged.push_back(&r);
    }
    std::stable_sort(merged.begin(), merged.end(), [](const SearchResult* a, const SearchResult* b) {
        return a->fuzzy_score > b->fuzzy_score;
    });

    ImGui::BeginChild("##search_results", ImVec2(0, 0), false, ImGuiWindowFlags_None);

    auto& dir_tex  = core::AssetManager::get().get_svg_texture("file-directory-fill-16", 14);
    auto& file_tex = core::AssetManager::get().get_svg_texture("file-16", 14);

    for (int i = 0; i < static_cast<int>(merged.size()); ++i) {
        const SearchResult& r = *merged[i];
        bool selected = (i == state.selected_index);

        ImGui::PushID(i);

        if (selected) {
            ImVec2 row_min = ImGui::GetCursorScreenPos();
            ImVec2 row_max = { row_min.x + ImGui::GetContentRegionAvail().x, row_min.y + 28.0f };
            ImGui::GetWindowDrawList()->AddRectFilled(row_min, row_max, IM_COL32(60, 60, 80, 200));
        }

        if (ImGui::Selectable("##row", selected, ImGuiSelectableFlags_AllowOverlap, { 0, 28.0f })) {
            state.pending_navigate_index = i;
        }
        if (ImGui::IsItemHovered()) {
            state.selected_index = i;
        }

        // Source badge
        ImGui::SameLine(8.0f);
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 6.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, source_color(r.source));
        ImGui::TextUnformatted(source_label(r.source));
        ImGui::PopStyleColor();

        // File/folder icon
        ImGui::SameLine(46.0f);
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 2.0f);
        const auto& icon = r.is_dir ? dir_tex : file_tex;
        if (icon.id != 0) {
            ImVec2 p = ImGui::GetCursorScreenPos();
            ImU32 col = r.is_dir ? IM_COL32(230, 191, 76, 255)
                                 : IM_COL32(100, 170, 230, 255);
            ImGui::GetWindowDrawList()->AddImage(
                icon.id, p, ImVec2(p.x + 14, p.y + 14),
                ImVec2(0,0), ImVec2(1,1), col);
            ImGui::Dummy(ImVec2(14, 14));
        } else {
            ImGui::TextUnformatted(r.is_dir ? "D" : "F");
        }

        // Name
        ImGui::SameLine(68.0f);
        ImGui::TextUnformatted(r.name.c_str());

        // Path (right-aligned)
        if (!r.path_display.empty()) {
            float path_w = ImGui::CalcTextSize(r.path_display.c_str()).x + 8.0f;
            ImGui::SameLine(ImGui::GetWindowWidth() - path_w - 4.0f);
            ImGui::TextDisabled("%s", r.path_display.c_str());
        }

        ImGui::PopID();
    }

    ImGui::EndChild();
}

// ---------------------------------------------------------------------------
// render — no-op; search is now rendered inline by FileExplorerPanel
// ---------------------------------------------------------------------------

void SearchPanel::render() {}

} // namespace misty::panel

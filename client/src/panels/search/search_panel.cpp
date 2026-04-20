#include "panels/search/search_panel.h"
#include "panels/search/fuzzy_match.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "panels/services/services_state.h"
#include "panels/workspace/workspace_state.h"
#include "core/net/http_client.h"
#include "core/manager/env_manager.h"
#include "core/manager/asset_manager.h"

#include <imgui.h>
#include <nlohmann/json.hpp>
#include <filesystem>
#include <algorithm>
#include <cctype>
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

static std::string lowercase_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

static std::string trim_copy(std::string value) {
    auto not_space = [](unsigned char c) { return !std::isspace(c); };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), not_space));
    value.erase(std::find_if(value.rbegin(), value.rend(), not_space).base(), value.end());
    return value;
}

static std::string type_label_for_item(const UnifiedFileItem& file) {
    if (file.is_dir) return "folder";
    if (!file.mime_type.empty()) return lowercase_copy(file.mime_type);
    std::string ext = fs::path(file.name).extension().string();
    if (!ext.empty() && ext[0] == '.') ext.erase(ext.begin());
    return lowercase_copy(ext);
}

static bool type_filter_matches(const UnifiedFileItem& file, const std::string& raw_token) {
    const std::string token = lowercase_copy(trim_copy(raw_token));
    if (token.empty()) return true;
    if (file.is_dir) {
        return token == "dir" || token == "dirs" || token == "folder" || token == "folders";
    }

    const std::string ext = lowercase_copy(fs::path(file.name).extension().string());
    if (!ext.empty()) {
        if (ext == "." + token) return true;
        if (ext.size() > 1 && ext.substr(1) == token) return true;
    }

    const std::string mime_type = lowercase_copy(file.mime_type);
    if (!mime_type.empty()) {
        if (mime_type == token) return true;
        if (mime_type.find(token) != std::string::npos) return true;
        const size_t slash = mime_type.find('/');
        if (slash != std::string::npos && mime_type.substr(slash + 1) == token) return true;
    }
    return false;
}

static SearchResult make_result_from_item(const UnifiedFileItem& item,
                                          const std::string& current_path,
                                          int fuzzy_score) {
    SearchResult result;
    result.name = item.name;
    result.source = item.source;
    result.is_dir = item.is_dir;
    result.size = item.size;
    result.fuzzy_score = fuzzy_score;
    result.virtual_path = item.path;
    result.dedup_key = (item.source == FileSource::REMOTE ? "remote:" : "local:") + item.path;
    result.remote_name = item.remote_name;
    result.remote_path = item.remote_path;

    if (item.source == FileSource::REMOTE) {
        std::string parent = fs::path(item.remote_path).parent_path().string();
        if (parent == ".") parent.clear();
        result.path_display = parent.empty() ? current_path : parent;
    } else {
        fs::path current(current_path);
        fs::path item_path(item.path);
        fs::path display_path = item.is_dir ? item_path : item_path.parent_path();
        std::error_code ec;
        fs::path relative = current.empty() ? display_path : fs::relative(display_path, current, ec);
        if (!ec && !relative.empty() && relative != ".") {
            result.path_display = relative.string();
        } else {
            result.path_display = display_path.string();
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

SearchPanel::SearchPanel(core::UIRegistry& ui_registry,
                         core::WorkerPool& worker_pool,
                         std::string explorer_state_key,
                         std::string search_state_key)
    : ui_registry_(ui_registry),
      worker_pool_(worker_pool),
      explorer_state_key_(std::move(explorer_state_key)),
      search_state_key_(std::move(search_state_key)) {}

// ---------------------------------------------------------------------------
// toggle / open
// ---------------------------------------------------------------------------

void SearchPanel::toggle() {
    auto& state = ui_registry_.get_state<SearchState>(search_state_key_);
    if (state.is_open && state.query_buf[0] != '\0') {
        std::lock_guard<std::mutex> lock(state.mu);
        state.is_open = false;
        state.pending_submit = false;
        state.pending_navigate_index = -1;
        state.selected_index = 0;
        state.cache_results.clear();
        state.api_results.clear();
        state.seen_ids.clear();
        state.pending_api_tasks.store(0);
        state.api_search_done = true;
        std::memset(state.query_buf, 0, sizeof(state.query_buf));
        state.last_submitted_query.clear();
        return;
    }

    state.is_open = true;
    state.just_opened = true;
}

// ---------------------------------------------------------------------------
// submit_search — dispatches local scan + API searches per remote
// ---------------------------------------------------------------------------

void SearchPanel::submit_search(const std::string& query) {
    auto& state = ui_registry_.get_state<SearchState>(search_state_key_);

    std::string current_path;
    std::vector<UnifiedFileItem> current_files;
    {
        auto& fe_state = ui_registry_.get_state<FileExplorerState>(explorer_state_key_);
        std::lock_guard<std::mutex> lock(fe_state.mu);
        current_path = fe_state.current_path;
        current_files = fe_state.files;
    }

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

    if (!query.empty() && query[0] == ':') {
        const std::string type_token = query.substr(1);
        std::vector<SearchResult> filtered;
        filtered.reserve(current_files.size());
        for (const auto& item : current_files) {
            if (!type_filter_matches(item, type_token)) continue;
            filtered.push_back(make_result_from_item(item, current_path, 0));
        }
        std::sort(filtered.begin(), filtered.end(), [](const SearchResult& a, const SearchResult& b) {
            if (a.is_dir != b.is_dir) return a.is_dir > b.is_dir;
            return lowercase_copy(a.name) < lowercase_copy(b.name);
        });
        std::lock_guard<std::mutex> lock(state.mu);
        if (state.query_generation == gen) {
            state.cache_results = std::move(filtered);
            state.api_search_done = true;
        }
        return;
    }

    std::vector<SearchResult> current_results;
    current_results.reserve(current_files.size());
    for (const auto& item : current_files) {
        int score = search::fuzzy_score(query, item.name);
        if (score < 0) continue;
        current_results.push_back(make_result_from_item(item, current_path, score));
    }
    std::sort(current_results.begin(), current_results.end(), [](const SearchResult& a, const SearchResult& b) {
        return a.fuzzy_score > b.fuzzy_score;
    });
    {
        std::lock_guard<std::mutex> lock(state.mu);
        if (state.query_generation == gen) {
            state.cache_results = current_results;
            for (const auto& result : current_results) {
                state.seen_ids.insert(result.dedup_key);
            }
        }
    }

    if (path_utils::is_remote_path(current_path)) {
        std::string remote_name;
        std::string remote_path;
        std::string provider_folder;
        std::string folder_name;
        const auto info = path_utils::parse_remote_path(current_path);
        if (!info.provider_folder.empty() && !info.remote_name.empty()) {
            remote_path = info.relative_path;
            remote_name = info.remote_name;
            provider_folder = info.provider_folder;
            folder_name = info.remote_name;
            auto& workspace = ui_registry_.get_state<WorkspaceState>("Workspace");
            for (const auto& mapping : workspace.remote_mappings) {
                if (mapping.provider_folder == info.provider_folder &&
                    (mapping.folder_name == info.remote_name || mapping.remote_name == info.remote_name)) {
                    remote_name = mapping.remote_name;
                    folder_name = mapping.folder_name;
                    break;
                }
            }
        }
        if (!remote_name.empty()) {
            search_remote_scope(state, query, gen, remote_name, remote_path, provider_folder, folder_name);
            return;
        }
    }

    worker_pool_.add(
        [this, &state, query, gen, current_path]() {
            scan_local(state, query, gen, current_path);
        },
        []() {},
        [](const std::string&) {}
    );
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
            const int kMaxDepth = 8;
            auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(800);
            try {
                for (auto it = fs::recursive_directory_iterator(local_root,
                         fs::directory_options::skip_permission_denied);
                     it != fs::recursive_directory_iterator(); ++it) {
                    if (local_count >= kMaxLocal) break;
                    if (std::chrono::steady_clock::now() > deadline) break;
                    if (it.depth() >= kMaxDepth && it->is_directory(ec)) {
                        it.disable_recursion_pending();
                    }

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
            for (auto& r : results) {
                if (!state.seen_ids.count(r.dedup_key)) {
                    state.seen_ids.insert(r.dedup_key);
                    state.api_results.push_back(std::move(r));
                }
            }
            state.api_search_done = true;
        }
    }
}

void SearchPanel::search_remote_scope(SearchState& state,
                                      const std::string& query,
                                      uint64_t generation,
                                      const std::string& remote_name,
                                      const std::string& remote_path,
                                      const std::string& provider_folder,
                                      const std::string& folder_name) {
    auto& services = ui_registry_.get_state<ServicesState>("Services");
    state.pending_api_tasks.store(1);

    auto finish_task = [&state, generation]() {
        if (state.pending_api_tasks.fetch_sub(1) == 1) {
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.query_generation == generation) {
                state.api_search_done = true;
            }
        }
    };

    services.search_files(remote_name, query, remote_path,
        [this, &state, generation, remote_name, provider_folder, folder_name, query, finish_task]
        (bool success, const std::string& body, const std::string&) {
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
                r.virtual_path = mount_root + "/" + provider_folder + "/" + folder_name + (item_path.empty() ? "" : "/" + item_path);

                std::string parent = item_path.empty() ? "" : fs::path(item_path).parent_path().string();
                if (parent == ".") parent.clear();
                r.path_display = provider_folder + " › " + folder_name + (parent.empty() ? "" : " › " + parent);
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
    auto& fe_state = ui_registry_.get_state<FileExplorerState>(explorer_state_key_);
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
            ImGui::SameLine();
            ImGui::Dummy(ImVec2(std::max(0.0f, ImGui::GetContentRegionAvail().x - path_w), 0.0f));
            ImGui::SameLine();
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

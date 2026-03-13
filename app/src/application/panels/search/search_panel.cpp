#include "panels/search/search_panel.h"
#include "panels/search/fuzzy_match.h"
#include "panels/file_explorer/file_explorer_state.h"
#include "core/net/http_client.h"
#include "core/manager/env_manager.h"
#include "core/manager/asset_manager.h"

#include <imgui.h>
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <chrono>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace misty::panel {

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static std::string read_file(const fs::path& p) {
    std::ifstream f(p);
    if (!f) return "";
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

static std::string format_size(int64_t bytes) {
    if (bytes <= 0) return "";
    if (bytes < 1024) return std::to_string(bytes) + " B";
    if (bytes < 1024 * 1024) return std::to_string(bytes / 1024) + " KB";
    return std::to_string(bytes / (1024 * 1024)) + " MB";
}

// Each provider's cache JSON has a different schema — extract name/id/is_dir uniformly.
struct CacheItem {
    std::string name;
    std::string id;          // stable identifier for dedup
    std::string path_display; // human-readable path hint (Dropbox path, iCloud path, etc.)
    bool is_dir = false;
    int64_t size = 0;
};

static std::vector<CacheItem> extract_items(const json& j, FileSource source) {
    std::vector<CacheItem> out;
    try {
        if (source == FileSource::ONEDRIVE) {
            for (auto& item : j.value("value", json::array())) {
                CacheItem ci;
                ci.name  = item.value("name", "");
                ci.id    = item.value("id", "");
                ci.is_dir = item.contains("folder");
                ci.size  = item.value("size", int64_t(0));
                if (!ci.name.empty()) out.push_back(std::move(ci));
            }
        } else if (source == FileSource::GDRIVE) {
            for (auto& item : j.value("files", json::array())) {
                CacheItem ci;
                ci.name  = item.value("name", "");
                ci.id    = item.value("id", "");
                ci.is_dir = (item.value("mimeType", "") == "application/vnd.google-apps.folder");
                // GDrive sizes come back as strings
                std::string sz = item.value("size", std::string("0"));
                try { ci.size = std::stoll(sz); } catch (...) {}
                if (!ci.name.empty()) out.push_back(std::move(ci));
            }
        } else if (source == FileSource::DROPBOX) {
            for (auto& item : j.value("entries", json::array())) {
                CacheItem ci;
                ci.name         = item.value("name", "");
                ci.id           = item.value("id", "");
                ci.path_display = item.value("path_display", "");
                ci.is_dir       = (item.value(".tag", "") == "folder");
                ci.size         = item.value("size", int64_t(0));
                if (!ci.name.empty()) out.push_back(std::move(ci));
            }
        } else if (source == FileSource::ICLOUD) {
            for (auto& item : j.value("items", json::array())) {
                CacheItem ci;
                ci.name   = item.value("name", "");
                ci.is_dir = item.value("is_folder", false);
                // iCloud has no stable ID — use name as id for dedup
                ci.id = ci.name;
                if (!ci.name.empty()) out.push_back(std::move(ci));
            }
        }
    } catch (...) {}
    return out;
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
        // Clear previous results when opening
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
// submit_search — dispatches cache scan + API searches
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

    // Read current_path on the main thread — never touch fe_state.mu from a worker.
    std::string local_root;
    {
        auto& fe_state = ui_registry_.get_state<FileExplorerState>("Files");
        std::lock_guard<std::mutex> lk(fe_state.mu);
        local_root = std::string(fe_state.current_path);
    }

    // Cache scan runs on a worker thread; results arrive quickly.
    worker_pool_.add(
        [this, &state, query, gen, local_root]() {
            scan_caches(state, query, gen, local_root);
        },
        []() {},
        [](const std::string&) {}
    );

    // API searches fire in parallel per account.
    launch_api_searches(state, query, gen);
}

// ---------------------------------------------------------------------------
// scan_caches — walks all provider cache dirs, fuzzy-matches filenames
// ---------------------------------------------------------------------------

void SearchPanel::scan_caches(SearchState& state, const std::string& query, uint64_t generation, const std::string& local_root) {
    auto& env = core::EnvManager::get();
    std::string home = env.get_user_home_dir();
    if (home.empty()) home = std::getenv("HOME") ? std::getenv("HOME") : "";

    struct CacheRoot { FileSource source; std::string path; };
    std::vector<CacheRoot> roots = {
        { FileSource::ONEDRIVE, home + "/.cache/onedrive/" },
        { FileSource::GDRIVE,   home + "/.cache/gdrive/" },
        { FileSource::DROPBOX,  home + "/.cache/dropbox/" },
        { FileSource::ICLOUD,   home + "/.cache/icloud/" },
    };

    // Copy account mappings to know folder_name → service IDs
    auto& ws = ui_registry_.get_state<WorkspaceState>("Workspace");
    std::vector<AccountMapping>    od_accts;
    std::vector<GDAccountMapping>  gd_accts;
    std::vector<DBXAccountMapping> dbx_accts;
    std::vector<ICLAccountMapping> icl_accts;
    {
        std::lock_guard<std::mutex> lock(ws.mu);
        od_accts  = ws.account_mappings;
        gd_accts  = ws.gd_account_mappings;
        dbx_accts = ws.dbx_account_mappings;
        icl_accts = ws.icl_account_mappings;
    }

    std::vector<SearchResult> results;

    for (auto& root : roots) {
        std::error_code ec;
        if (!fs::exists(root.path, ec)) continue;

        for (auto& acct_dir : fs::directory_iterator(root.path, ec)) {
            if (!acct_dir.is_directory()) continue;
            std::string folder_name = acct_dir.path().filename().string();

            for (auto& cache_file : fs::directory_iterator(acct_dir.path(), ec)) {
                if (cache_file.path().extension() != ".json") continue;

                std::string body = read_file(cache_file.path());
                if (body.empty()) continue;

                json j = json::parse(body, nullptr, false);
                if (j.is_discarded()) continue;

                for (auto& ci : extract_items(j, root.source)) {
                    int score = search::fuzzy_score(query, ci.name);
                    if (score < 0) continue;

                    // Build dedup key
                    std::string dedup;
                    if (root.source == FileSource::ONEDRIVE)
                        dedup = "od:" + ci.id;
                    else if (root.source == FileSource::GDRIVE)
                        dedup = "gd:" + ci.id;
                    else if (root.source == FileSource::DROPBOX)
                        dedup = "dbx:" + (ci.path_display.empty() ? ci.name : ci.path_display);
                    else
                        dedup = "icl:" + folder_name + "/" + ci.name;

                    {
                        std::lock_guard<std::mutex> lock(state.mu);
                        if (state.query_generation != generation) return;
                        if (state.seen_ids.count(dedup)) continue;
                        state.seen_ids.insert(dedup);
                    }

                    SearchResult r;
                    r.name        = ci.name;
                    r.source      = root.source;
                    r.is_dir      = ci.is_dir;
                    r.size        = ci.size;
                    r.fuzzy_score = score;
                    r.dedup_key   = dedup;

                    // Build virtual path (parent folder) and display string
                    if (root.source == FileSource::ONEDRIVE) {
                        r.virtual_path  = path_utils::get_onedrive_root() + "/" + folder_name;
                        r.path_display  = "OneDrive › " + folder_name;
                        // Find account metadata
                        for (auto& a : od_accts) {
                            if (a.folder_name == folder_name) {
                                r.od_ms_user_id = a.ms_user_id;
                                r.od_drive_id   = a.drive_id;
                                break;
                            }
                        }
                        r.od_item_id = ci.id;
                    } else if (root.source == FileSource::GDRIVE) {
                        r.virtual_path = path_utils::get_gdrive_root() + "/" + folder_name;
                        r.path_display = "Google Drive › " + folder_name;
                        for (auto& a : gd_accts) {
                            if (a.folder_name == folder_name) {
                                r.gd_user_id = a.gd_user_id;
                                break;
                            }
                        }
                        r.gd_item_id = ci.id;
                    } else if (root.source == FileSource::DROPBOX) {
                        r.virtual_path  = path_utils::get_dropbox_root() + "/" + folder_name;
                        r.path_display  = "Dropbox › " + folder_name;
                        for (auto& a : dbx_accts) {
                            if (a.folder_name == folder_name) {
                                r.dbx_user_id = a.dbx_user_id;
                                break;
                            }
                        }
                        r.dbx_item_id      = ci.id;
                        r.dbx_path_display = ci.path_display;
                    } else if (root.source == FileSource::ICLOUD) {
                        r.virtual_path  = path_utils::get_icloud_root() + "/" + folder_name;
                        r.path_display  = "iCloud › " + folder_name;
                        for (auto& a : icl_accts) {
                            if (a.folder_name == folder_name) {
                                r.icl_email = a.email;
                                break;
                            }
                        }
                        r.icl_path_display = ci.name;
                    }

                    results.push_back(std::move(r));
                }
            }
        }
    }

    // --- Local files: recursive scan of $HOME (up to 3000 items / 800ms) ---
    if (!local_root.empty()) {
        std::error_code ec2;
        if (fs::exists(local_root, ec2)) {
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
                    // Skip hidden entries; for directories also suppress recursion
                    if (name.empty() || name[0] == '.') {
                        if (it->is_directory(ec2)) it.disable_recursion_pending();
                        continue;
                    }
                    // Skip noisy directories
                    if (it->is_directory(ec2) &&
                        (name == "node_modules" || name == "__pycache__" ||
                         name == "build" || name == "dist" || name == ".git")) {
                        it.disable_recursion_pending();
                        continue;
                    }

                    // Check cancellation without holding search_state.mu
                    if (state.query_generation != generation) return;

                    int score = search::fuzzy_score(query, name);
                    if (score < 0) continue;

                    std::string path_str = it->path().string();
                    std::string dedup = "local:" + path_str;
                    {
                        std::lock_guard<std::mutex> lk2(state.mu);
                        if (state.query_generation != generation) return;
                        if (state.seen_ids.count(dedup)) continue;
                        state.seen_ids.insert(dedup);
                    }

                    SearchResult r;
                    r.name         = name;
                    r.source       = FileSource::LOCAL;
                    r.is_dir       = it->is_directory(ec2);
                    r.size         = 0;
                    r.fuzzy_score  = score;
                    r.dedup_key    = dedup;
                    r.virtual_path = path_str;
                    auto rel = fs::relative(it->path(), local_root, ec2);
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
// launch_api_searches — fires one WorkerPool task per account per provider
// ---------------------------------------------------------------------------

void SearchPanel::launch_api_searches(SearchState& state, const std::string& query, uint64_t generation) {
    auto& env      = core::EnvManager::get();
    std::string proxy_url = env.get("PROXY_SERVICE_URL", "");
    std::string user_id   = env.get("USER_ID", "");

    if (proxy_url.empty() || user_id.empty()) {
        state.api_search_done = true;
        return;
    }

    auto& ws = ui_registry_.get_state<WorkspaceState>("Workspace");
    std::vector<AccountMapping>    od_accts;
    std::vector<GDAccountMapping>  gd_accts;
    std::vector<DBXAccountMapping> dbx_accts;
    {
        std::lock_guard<std::mutex> lock(ws.mu);
        od_accts  = ws.account_mappings;
        gd_accts  = ws.gd_account_mappings;
        dbx_accts = ws.dbx_account_mappings;
    }

    int total_tasks = static_cast<int>(od_accts.size() + gd_accts.size() + dbx_accts.size());
    if (total_tasks == 0) {
        state.api_search_done = true;
        return;
    }
    state.pending_api_tasks.store(total_tasks);

    auto finish_task = [&state, generation]() {
        if (state.pending_api_tasks.fetch_sub(1) == 1) {
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.query_generation == generation) {
                state.api_search_done = true;
            }
        }
    };

    std::string q_enc = core::url_encode(query);

    // --- OneDrive ---
    for (auto& acct : od_accts) {
        std::string url = proxy_url + "/api/ms/search?user_id=" + user_id
            + "&ms_user_id=" + acct.ms_user_id
            + "&drive_id="   + acct.drive_id
            + "&q="          + q_enc;
        std::string folder_name = acct.folder_name;
        std::string ms_user_id  = acct.ms_user_id;
        std::string drive_id    = acct.drive_id;

        auto results = std::make_shared<std::vector<SearchResult>>();

        worker_pool_.add(
            [url, folder_name, ms_user_id, drive_id, results, query]() {
                auto resp = core::HTTPClient::get().get(url);
                if (resp.status_code != 200) return;

                json j = json::parse(resp.body, nullptr, false);
                if (j.is_discarded()) return;

                for (auto& item : j.value("value", json::array())) {
                    std::string name = item.value("name", "");
                    if (name.empty()) continue;
                    int score = search::fuzzy_score(query, name);
                    if (score < 0) score = 0;

                    SearchResult r;
                    r.name          = name;
                    r.source        = FileSource::ONEDRIVE;
                    r.is_dir        = item.contains("folder");
                    r.size          = item.value("size", int64_t(0));
                    r.fuzzy_score   = score;
                    r.od_item_id    = item.value("id", "");
                    r.od_drive_id   = drive_id;
                    r.od_ms_user_id = ms_user_id;
                    r.virtual_path  = path_utils::get_onedrive_root() + "/" + folder_name;
                    r.path_display  = "OneDrive › " + folder_name;
                    r.dedup_key     = "od:" + r.od_item_id;
                    results->push_back(std::move(r));
                }
            },
            [&state, results, generation, finish_task]() {
                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.query_generation == generation) {
                        for (auto& r : *results) {
                            if (!state.seen_ids.count(r.dedup_key)) {
                                state.seen_ids.insert(r.dedup_key);
                                state.api_results.push_back(r);
                            }
                        }
                    }
                }
                finish_task();
            },
            [finish_task](const std::string&) { finish_task(); }
        );
    }

    // --- Google Drive ---
    for (auto& acct : gd_accts) {
        std::string url = proxy_url + "/api/gd/search?user_id=" + user_id
            + "&gd_user_id=" + acct.gd_user_id
            + "&q="          + q_enc;
        std::string folder_name = acct.folder_name;
        std::string gd_user_id  = acct.gd_user_id;

        auto results = std::make_shared<std::vector<SearchResult>>();

        worker_pool_.add(
            [url, folder_name, gd_user_id, results, query]() {
                auto resp = core::HTTPClient::get().get(url);
                if (resp.status_code != 200) return;

                json j = json::parse(resp.body, nullptr, false);
                if (j.is_discarded()) return;

                for (auto& item : j.value("files", json::array())) {
                    std::string name = item.value("name", "");
                    if (name.empty()) continue;
                    int score = search::fuzzy_score(query, name);
                    if (score < 0) score = 0;

                    std::string sz_str = item.value("size", std::string("0"));
                    int64_t sz = 0;
                    try { sz = std::stoll(sz_str); } catch (...) {}

                    SearchResult r;
                    r.name         = name;
                    r.source       = FileSource::GDRIVE;
                    r.is_dir       = (item.value("mimeType", "") == "application/vnd.google-apps.folder");
                    r.size         = sz;
                    r.fuzzy_score  = score;
                    r.gd_item_id   = item.value("id", "");
                    r.gd_user_id   = gd_user_id;
                    r.gd_mime_type = item.value("mimeType", "");
                    r.virtual_path = path_utils::get_gdrive_root() + "/" + folder_name;
                    r.path_display = "Google Drive › " + folder_name;
                    r.dedup_key    = "gd:" + r.gd_item_id;
                    results->push_back(std::move(r));
                }
            },
            [&state, results, generation, finish_task]() {
                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.query_generation == generation) {
                        for (auto& r : *results) {
                            if (!state.seen_ids.count(r.dedup_key)) {
                                state.seen_ids.insert(r.dedup_key);
                                state.api_results.push_back(r);
                            }
                        }
                    }
                }
                finish_task();
            },
            [finish_task](const std::string&) { finish_task(); }
        );
    }

    // --- Dropbox ---
    for (auto& acct : dbx_accts) {
        std::string url = proxy_url + "/api/dbx/search?user_id=" + user_id
            + "&dbx_user_id=" + acct.dbx_user_id
            + "&q="           + q_enc;
        std::string folder_name = acct.folder_name;
        std::string dbx_user_id = acct.dbx_user_id;

        auto results = std::make_shared<std::vector<SearchResult>>();

        worker_pool_.add(
            [url, folder_name, dbx_user_id, results, query]() {
                auto resp = core::HTTPClient::get().get(url);
                if (resp.status_code != 200) return;

                json j = json::parse(resp.body, nullptr, false);
                if (j.is_discarded()) return;

                for (auto& item : j.value("entries", json::array())) {
                    std::string name = item.value("name", "");
                    if (name.empty()) continue;
                    int score = search::fuzzy_score(query, name);
                    if (score < 0) score = 0;

                    SearchResult r;
                    r.name             = name;
                    r.source           = FileSource::DROPBOX;
                    r.is_dir           = (item.value(".tag", "") == "folder");
                    r.size             = item.value("size", int64_t(0));
                    r.fuzzy_score      = score;
                    r.dbx_item_id      = item.value("id", "");
                    r.dbx_user_id      = dbx_user_id;
                    r.dbx_path_display = item.value("path_display", "");
                    r.virtual_path     = path_utils::get_dropbox_root() + "/" + folder_name;
                    r.path_display     = "Dropbox › " + folder_name;
                    r.dedup_key        = "dbx:" + (r.dbx_path_display.empty() ? name : r.dbx_path_display);
                    results->push_back(std::move(r));
                }
            },
            [&state, results, generation, finish_task]() {
                {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.query_generation == generation) {
                        for (auto& r : *results) {
                            if (!state.seen_ids.count(r.dedup_key)) {
                                state.seen_ids.insert(r.dedup_key);
                                state.api_results.push_back(r);
                            }
                        }
                    }
                }
                finish_task();
            },
            [finish_task](const std::string&) { finish_task(); }
        );
    }
}

// ---------------------------------------------------------------------------
// navigate_to_result — navigates the file explorer to the item's location.
//
// POLICY: search results NEVER open or execute files. We only reveal the
// containing directory so the user can decide what to do next. This prevents
// accidentally launching malicious scripts or binaries that match a search.
//
// • Local file  → parent directory (never the file path itself)
// • Local dir   → the directory
// • Cloud item  → virtual_path is always the provider folder, never a file
// ---------------------------------------------------------------------------

void SearchPanel::navigate_to_result(const SearchResult& result) {
    auto& fe_state = ui_registry_.get_state<FileExplorerState>("Files");
    std::lock_guard<std::mutex> lock(fe_state.mu);

    std::string dest;
    if (!result.is_dir) {
        // For any non-directory result: always navigate to the parent folder.
        // For cloud files, virtual_path is already a folder path by construction,
        // but we guard uniformly here so this policy cannot silently regress.
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
        case FileSource::LOCAL:    return "LOC";
        case FileSource::ONEDRIVE: return "OD";
        case FileSource::GDRIVE:   return "GD";
        case FileSource::DROPBOX:  return "DBX";
        case FileSource::ICLOUD:   return "ICL";
        default:                   return "?";
    }
}

static ImVec4 source_color(FileSource src) {
    switch (src) {
        case FileSource::LOCAL:    return { 0.70f, 0.70f, 0.70f, 1.0f }; // gray
        case FileSource::ONEDRIVE: return { 0.00f, 0.47f, 0.84f, 1.0f }; // blue
        case FileSource::GDRIVE:   return { 0.26f, 0.52f, 0.96f, 1.0f }; // indigo
        case FileSource::DROPBOX:  return { 0.00f, 0.60f, 0.88f, 1.0f }; // cyan
        case FileSource::ICLOUD:   return { 0.40f, 0.80f, 1.00f, 1.0f }; // light blue
        default:                   return { 0.60f, 0.60f, 0.60f, 1.0f };
    }
}

void SearchPanel::render_results(SearchState& state) {
    // Build merged sorted view (cache first, then api, sorted by score within each group)
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

        // Highlight row on selection
        if (selected) {
            ImVec2 row_min = ImGui::GetCursorScreenPos();
            ImVec2 row_max = { row_min.x + ImGui::GetContentRegionAvail().x, row_min.y + 28.0f };
            ImGui::GetWindowDrawList()->AddRectFilled(row_min, row_max, IM_COL32(60, 60, 80, 200));
        }

        if (ImGui::Selectable("##row", selected, ImGuiSelectableFlags_AllowOverlap, { 0, 28.0f })) {
            // Defer navigation — fe_state.mu is held by caller; navigate_to_result re-acquires it.
            // pending_navigate_index is consumed after the lock is released in FileExplorerPanel::render().
            state.pending_navigate_index = i;
        }
        if (ImGui::IsItemHovered()) {
            state.selected_index = i;
        }

        // Provider badge
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

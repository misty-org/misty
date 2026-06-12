#include "panels/search/files_search_palette.h"

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "panels/providers/cards/provider_cards_util.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstring>
#include <cstdlib>
#include <filesystem>
#include <optional>
#include <string_view>

namespace fs = std::filesystem;

namespace misty::panel {

namespace {

constexpr auto kSearchDebounceDelay = std::chrono::milliseconds(250);
constexpr float kPaletteWidth = 760.0f;
constexpr float kPaletteMaxHeight = 520.0f;
constexpr float kInputHeight = 40.0f;
constexpr float kRowHeight = 34.0f;

std::string trim_copy(std::string value) {
    const auto not_space = [](unsigned char c) { return !std::isspace(c); };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), not_space));
    value.erase(std::find_if(value.rbegin(), value.rend(), not_space).base(), value.end());
    return value;
}

std::string ellipsize_text(const std::string& text, float max_width) {
    if (text.empty() || max_width <= 0.0f) {
        return {};
    }
    if (ImGui::CalcTextSize(text.c_str()).x <= max_width) {
        return text;
    }

    static constexpr const char* kEllipsis = "...";
    const float ellipsis_width = ImGui::CalcTextSize(kEllipsis).x;
    if (ellipsis_width >= max_width) {
        return kEllipsis;
    }

    std::string truncated = text;
    while (!truncated.empty()) {
        truncated.pop_back();
        const std::string candidate = truncated + kEllipsis;
        if (ImGui::CalcTextSize(candidate.c_str()).x <= max_width) {
            return candidate;
        }
    }
    return kEllipsis;
}

std::string lowercase_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

bool contains_case_insensitive(const std::string& text, const std::string& needle) {
    if (needle.empty()) {
        return true;
    }
    return lowercase_copy(text).find(lowercase_copy(needle)) != std::string::npos;
}

bool is_remote_search_not_supported_error(const std::string& error) {
    return contains_case_insensitive(error, "only local search is currently supported") ||
           contains_case_insensitive(error, "only local search is supported");
}

std::vector<std::string> split_tokens(const std::string& text) {
    std::vector<std::string> tokens;
    std::string current;
    bool quoted = false;
    for (char ch : text) {
        if (ch == '"') {
            quoted = !quoted;
            continue;
        }
        if (!quoted && std::isspace(static_cast<unsigned char>(ch))) {
            if (!current.empty()) {
                tokens.push_back(current);
                current.clear();
            }
            continue;
        }
        current.push_back(ch);
    }
    if (!current.empty()) {
        tokens.push_back(current);
    }
    return tokens;
}

std::optional<std::int64_t> parse_size_bytes(const std::string& text) {
    const std::string lower = lowercase_copy(trim_copy(text));
    if (lower.empty()) {
        return std::nullopt;
    }
    std::size_t idx = 0;
    while (idx < lower.size() && (std::isdigit(static_cast<unsigned char>(lower[idx])) || lower[idx] == '.')) {
        ++idx;
    }
    if (idx == 0) {
        return std::nullopt;
    }
    const double value = std::stod(lower.substr(0, idx));
    const std::string suffix = lower.substr(idx);
    double multiplier = 1.0;
    if (suffix == "k" || suffix == "kb") multiplier = 1024.0;
    else if (suffix == "m" || suffix == "mb") multiplier = 1024.0 * 1024.0;
    else if (suffix == "g" || suffix == "gb") multiplier = 1024.0 * 1024.0 * 1024.0;
    else if (!suffix.empty() && suffix != "b") return std::nullopt;
    return static_cast<std::int64_t>(value * multiplier);
}

bool match_size_filter(const std::string& filter, const std::string& path, bool is_dir) {
    if (filter.empty() || is_dir) {
        return true;
    }
    std::error_code ec;
    const auto size = fs::file_size(path, ec);
    if (ec) {
        return true;
    }
    std::string token = trim_copy(filter);
    char op = '=';
    if (!token.empty() && (token[0] == '>' || token[0] == '<' || token[0] == '=')) {
        op = token[0];
        token.erase(token.begin());
    }
    const auto threshold = parse_size_bytes(token);
    if (!threshold.has_value()) {
        return true;
    }
    if (op == '>') return static_cast<std::int64_t>(size) >= *threshold;
    if (op == '<') return static_cast<std::int64_t>(size) <= *threshold;
    return static_cast<std::int64_t>(size) == *threshold;
}

bool match_mtime_filter(const std::string& filter, const std::string& path) {
    if (filter.empty()) {
        return true;
    }
    std::error_code ec;
    const auto file_time = fs::last_write_time(path, ec);
    if (ec) {
        return true;
    }

    std::string token = lowercase_copy(trim_copy(filter));
    int days = 0;
    char op = '<';
    if (!token.empty() && (token[0] == '>' || token[0] == '<')) {
        op = token[0];
        token.erase(token.begin());
    }
    if (token == "today") {
        days = 1;
    } else if (!token.empty() && token.back() == 'd') {
        token.pop_back();
        days = std::max(0, std::atoi(token.c_str()));
    } else {
        return true;
    }

    const auto system_now = std::chrono::system_clock::now();
    const auto approx_write = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
        file_time - fs::file_time_type::clock::now() + system_now);
    const auto age = std::chrono::duration_cast<std::chrono::hours>(system_now - approx_write);
    const auto threshold = std::chrono::hours(days * 24);
    if (op == '>') {
        return age >= threshold;
    }
    return age <= threshold;
}

bool match_result_filters(const SearchQuery& query, const SearchResult& result) {
    if (query.type_filter == SearchTypeFilter::File && result.is_dir) {
        return false;
    }
    if (query.type_filter == SearchTypeFilter::Folder && !result.is_dir) {
        return false;
    }
    if (!query.ext_filter.empty()) {
        const std::string ext = lowercase_copy(fs::path(result.name).extension().string());
        std::string filter_ext = lowercase_copy(query.ext_filter);
        if (!filter_ext.empty() && filter_ext.front() != '.') {
            filter_ext.insert(filter_ext.begin(), '.');
        }
        if (ext != filter_ext) {
            return false;
        }
    }
    if (!match_size_filter(query.size_filter, result.path, result.is_dir)) {
        return false;
    }
    if (!match_mtime_filter(query.mtime_filter, result.path)) {
        return false;
    }
    return true;
}

const char* kind_label(SearchResultKind kind) {
    switch (kind) {
        case SearchResultKind::File: return "File";
        case SearchResultKind::Folder: return "Folder";
        case SearchResultKind::Location: return "Goto";
        case SearchResultKind::Command: return "Command";
    }
    return "";
}

const char* source_label(FileSource src) {
    return src == FileSource::REMOTE ? "REM" : "LOC";
}

ImVec4 kind_color(SearchResultKind kind) {
    switch (kind) {
        case SearchResultKind::Command: return ImVec4(0.95f, 0.78f, 0.28f, 1.0f);
        case SearchResultKind::Location: return ImVec4(0.42f, 0.74f, 0.96f, 1.0f);
        case SearchResultKind::Folder: return ImVec4(0.86f, 0.74f, 0.30f, 1.0f);
        case SearchResultKind::File: return ImVec4(0.72f, 0.72f, 0.76f, 1.0f);
    }
    return ImVec4(0.72f, 0.72f, 0.76f, 1.0f);
}

ImVec4 source_color(FileSource src) {
    return src == FileSource::REMOTE
        ? ImVec4(0.00f, 0.60f, 0.88f, 1.0f)
        : ImVec4(0.65f, 0.65f, 0.70f, 1.0f);
}

std::string remote_display_name(const SearchResult& result) {
    if (!result.remote_id.empty()) {
        return result.remote_id;
    }
    if (!result.account_id.empty()) {
        return result.account_id;
    }
    if (!result.provider_id.empty()) {
        return result.provider_id;
    }
    return "Remote";
}

float draw_remote_source_affordance(const SearchResult& result,
                                    const ImVec2& row_min,
                                    const ImVec2& row_max,
                                    float text_y) {
    ImDrawList* draw_list = ImGui::GetWindowDrawList();
    const std::string label = remote_display_name(result);
    const ImVec2 label_size = ImGui::CalcTextSize(label.c_str());
    const float icon_size = 15.0f;
    const float spacing = 6.0f;
    const float right_padding = 12.0f;
    const float total_width = icon_size + spacing + label_size.x;
    const float start_x = row_max.x - right_padding - total_width;
    const float icon_y = row_min.y + (kRowHeight - icon_size) * 0.5f;

    const std::string icon_path = provider_logo_path_for_id(result.provider_id);
    if (!icon_path.empty()) {
        auto& icon = core::AssetManager::get().get_svg_texture_path(
            icon_path,
            static_cast<int>(icon_size * 2.0f),
            false);
        if (icon.id != 0) {
            draw_list->AddImage(icon.id,
                                ImVec2(start_x, icon_y),
                                ImVec2(start_x + icon_size, icon_y + icon_size));
        }
    }

    draw_list->AddText(
        ImVec2(start_x + icon_size + spacing, text_y),
        ImGui::ColorConvertFloat4ToU32(source_color(result.source)),
        label.c_str());
    return start_x - 10.0f;
}

void sort_results(std::vector<SearchResult>& results) {
    std::stable_sort(results.begin(), results.end(), [](const SearchResult& a, const SearchResult& b) {
        if (a.kind != b.kind) {
            if (a.kind == SearchResultKind::Command) return false;
            if (b.kind == SearchResultKind::Command) return true;
        }
        if (a.score != b.score) {
            return a.score > b.score;
        }
        return lowercase_copy(a.name) < lowercase_copy(b.name);
    });
}

std::string backend_query_text(const SearchQuery& query) {
    if (!query.name_filter.empty()) {
        return query.name_filter;
    }
    return query.query;
}

void reset_palette_session_state(SearchState& state) {
    std::memset(state.query_buf, 0, sizeof(state.query_buf));
    state.results.clear();
    state.selected_index = 0;
    state.search_pending = false;
    state.search_in_flight = false;
    ++state.request_generation;
    state.last_input_change_at = {};
    state.last_submitted_query.clear();
    state.last_err.clear();
    state.results_cached = false;
    state.refresh_in_progress = false;
    state.results_updated = false;
    state.updated_at.clear();
    state.request_id.clear();
    state.remote_statuses.clear();
}

} // namespace

FilesSearchPalette::FilesSearchPalette(core::StateRegistry& state_registry,
                                       core::WorkerPool& worker_pool,
                                       std::string state_key)
    : state_registry_(state_registry),
      worker_pool_(worker_pool),
      state_key_(std::move(state_key)) {
    state_registry_.get_state<SearchState>(state_key_);
}

void FilesSearchPalette::set_local_result_provider(LocalResultProvider provider) {
    local_result_provider_ = std::move(provider);
}

void FilesSearchPalette::set_execute_handler(ExecuteHandler handler) {
    execute_handler_ = std::move(handler);
}

void FilesSearchPalette::set_workspace_paths_provider(WorkspacePathsProvider provider) {
    workspace_paths_provider_ = std::move(provider);
}

void FilesSearchPalette::open(const std::string& current_path) {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    std::lock_guard<std::mutex> lock(state.mu);
    reset_palette_session_state(state);
    state.is_open = true;
    state.focus_query = true;
    state.just_opened = true;
    state.context_path = current_path;
}

void FilesSearchPalette::close() {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    std::lock_guard<std::mutex> lock(state.mu);
    reset_palette_session_state(state);
    state.is_open = false;
    state.focus_query = false;
    state.just_opened = false;
}

bool FilesSearchPalette::is_open() const {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    std::lock_guard<std::mutex> lock(state.mu);
    return state.is_open;
}

std::string FilesSearchPalette::current_query() const {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    std::lock_guard<std::mutex> lock(state.mu);
    return state.query_buf;
}

SearchQuery FilesSearchPalette::build_query(const std::string& raw_query, const std::string& current_path) const {
    SearchQuery query;
    query.raw_query = raw_query;
    query.path = current_path;
    query.paths = workspace_paths_provider_ ? workspace_paths_provider_() : std::vector<std::string>{};
    if (query.paths.empty() && !current_path.empty()) {
        query.paths.push_back(current_path);
    }
    query.depth = SearchScope::workspace();
    query.source = SearchSource::ALL;

    std::string trimmed = trim_copy(raw_query);
    if (!trimmed.empty() && trimmed.front() == '>') {
        query.commands_only = true;
        query.query = trim_copy(trimmed.substr(1));
        return query;
    }

    std::vector<std::string> free_terms;
    for (const auto& token : split_tokens(trimmed)) {
        const std::size_t colon = token.find(':');
        if (colon == std::string::npos) {
            free_terms.push_back(token);
            continue;
        }
        const std::string key = lowercase_copy(token.substr(0, colon));
        const std::string value = trim_copy(token.substr(colon + 1));
        if (key == "name") query.name_filter = value;
        else if (key == "type") {
            const std::string lower = lowercase_copy(value);
            if (lower == "file") query.type_filter = SearchTypeFilter::File;
            else if (lower == "folder" || lower == "dir" || lower == "directory") query.type_filter = SearchTypeFilter::Folder;
        } else if (key == "ext") query.ext_filter = value;
        else if (key == "size") query.size_filter = value;
        else if (key == "mtime") query.mtime_filter = value;
        else if (key == "scope") {
            const std::string lower = lowercase_copy(value);
            if (lower == "workspace") query.depth = SearchScope::workspace();
            else if (lower == "system" || lower == "all") query.depth = SearchScope::system();
            else query.depth = SearchScope::cwd();
        } else if (key == "source") {
            const std::string lower = lowercase_copy(value);
            if (lower == "local") query.source = SearchSource::LOCAL;
            else if (lower == "remote") query.source = SearchSource::REMOTE;
            else query.source = SearchSource::ALL;
        } else {
            free_terms.push_back(token);
        }
    }

    query.query = free_terms.empty() ? std::string() : free_terms.front();
    if (query.name_filter.empty()) {
        query.name_filter = query.query;
    }
    if (query.depth.scope_ != SearchDepth::WORKSPACE) {
        query.paths.clear();
    }
    return query;
}

void FilesSearchPalette::submit_search(const SearchQuery& query) {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    std::uint64_t request_generation = 0;
    std::vector<SearchResult> local_results;
    if (local_result_provider_) {
        local_results = local_result_provider_(query);
    }
    std::vector<SearchResult> fallback_local_results = local_results;
    {
        std::lock_guard<std::mutex> lock(state.mu);
        state.results.clear();
        state.selected_index = 0;
        state.search_pending = false;
        state.search_in_flight = true;
        state.last_submitted_query = query.raw_query;
        state.last_err.clear();
        state.results_cached = false;
        state.refresh_in_progress = false;
        state.results_updated = false;
        state.updated_at.clear();
        state.request_id.clear();
        state.remote_statuses.clear();
        state.last_query_source = query.source;
        request_generation = ++state.request_generation;
    }

    worker_pool_.add(
        [this, &state, query, request_generation, local_results = std::move(local_results)]() mutable {
            if (!query.commands_only && !backend_query_text(query).empty()) {
                SearchQuery backend_query = query;
                backend_query.query = backend_query_text(query);
                search_impl_.search(
                    backend_query,
                    [&](SearchResponse& backend_response) {
                        std::vector<SearchResult> merged_results = local_results;
                        for (auto& result : backend_response.results) {
                            if (match_result_filters(query, result)) {
                                merged_results.push_back(std::move(result));
                            }
                        }
                        sort_results(merged_results);
                        std::lock_guard<std::mutex> lock(state.mu);
                        if (state.request_generation != request_generation) {
                            return;
                        }
                        state.results = std::move(merged_results);
                        state.search_in_flight = false;
                        state.results_cached = backend_response.is_cached;
                        state.refresh_in_progress = backend_response.refresh_in_progress;
                        state.results_updated = backend_response.updated;
                        state.updated_at = backend_response.updated_at;
                        state.request_id = backend_response.request_id;
                        state.remote_statuses = std::move(backend_response.remote_statuses);
                    },
                    [&](const std::string& error) {
                        std::lock_guard<std::mutex> lock(state.mu);
                        if (state.request_generation != request_generation) {
                            return;
                        }
                        if (!local_results.empty()) {
                            sort_results(local_results);
                            state.results = local_results;
                        }
                        state.search_in_flight = false;
                        state.refresh_in_progress = false;
                        state.last_err = error;
                    },
                    [&](SearchResponse& backend_response) {
                        std::vector<SearchResult> merged_results = local_results;
                        for (auto& result : backend_response.results) {
                            if (match_result_filters(query, result)) {
                                merged_results.push_back(std::move(result));
                            }
                        }
                        sort_results(merged_results);
                        std::lock_guard<std::mutex> lock(state.mu);
                        if (state.request_generation != request_generation) {
                            return;
                        }
                        state.results = std::move(merged_results);
                        state.search_in_flight = false;
                        state.results_cached = backend_response.is_cached;
                        state.refresh_in_progress = backend_response.refresh_in_progress;
                        state.results_updated = backend_response.updated;
                        state.updated_at = backend_response.updated_at;
                        state.request_id = backend_response.request_id;
                        state.remote_statuses = std::move(backend_response.remote_statuses);
                    });
                return;
            }

            sort_results(local_results);
            {
                std::lock_guard<std::mutex> lock(state.mu);
                if (state.request_generation != request_generation) {
                    return;
                }
                state.results = std::move(local_results);
                state.search_in_flight = false;
            }
        },
        []() {},
        [&state, request_generation, fallback_local_results = std::move(fallback_local_results)](const std::string& error) {
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.request_generation != request_generation) {
                return;
            }
            if (!fallback_local_results.empty()) {
                auto fallback_results = fallback_local_results;
                sort_results(fallback_results);
                state.results = std::move(fallback_results);
            } else {
                state.results.clear();
            }
            state.search_in_flight = false;
            state.refresh_in_progress = false;
            state.last_err = error;
        });
}

void FilesSearchPalette::activate_selected_result(SearchState& state) {
    SearchResult result;
    {
        std::lock_guard<std::mutex> lock(state.mu);
        if (state.selected_index < 0 ||
            state.selected_index >= static_cast<int>(state.results.size())) {
            return;
        }
        result = state.results[state.selected_index];
        state.is_open = false;
    }
    if (execute_handler_) {
        execute_handler_(result);
    }
}

void FilesSearchPalette::render_results(SearchState& state) {
    std::vector<SearchResult> results;
    int selected_index = 0;
    {
        std::lock_guard<std::mutex> lock(state.mu);
        results = state.results;
        selected_index = state.selected_index;
    }

    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.08f, 0.09f, 0.10f, 1.0f));
    ImGui::BeginChild("##files_search_results", ImVec2(0.0f, 0.0f), false, ImGuiWindowFlags_None);
    for (int i = 0; i < static_cast<int>(results.size()); ++i) {
        const SearchResult& result = results[i];

        ImGui::PushID(i);
        const bool selected = i == selected_index;
        if (ImGui::Selectable("##palette_row", selected, ImGuiSelectableFlags_AllowOverlap, ImVec2(0.0f, kRowHeight))) {
            {
                std::lock_guard<std::mutex> lock(state.mu);
                state.selected_index = i;
            }
            activate_selected_result(state);
            ImGui::PopID();
            break;
        }
        if (ImGui::IsItemHovered()) {
            std::lock_guard<std::mutex> lock(state.mu);
            state.selected_index = i;
        }

        const ImVec2 row_min = ImGui::GetItemRectMin();
        const ImVec2 row_max = ImGui::GetItemRectMax();
        if (selected) {
            ImGui::GetWindowDrawList()->AddRectFilled(row_min, row_max, IM_COL32(46, 50, 60, 220), 7.0f);
        }

        const float text_y = row_min.y + 7.0f;
        float right_limit_x = row_max.x - 12.0f;
        ImGui::GetWindowDrawList()->AddText(ImVec2(row_min.x + 10.0f, text_y),
                                            ImGui::ColorConvertFloat4ToU32(kind_color(result.kind)),
                                            kind_label(result.kind));
        if (result.kind == SearchResultKind::File || result.kind == SearchResultKind::Folder) {
            if (result.source == FileSource::REMOTE) {
                right_limit_x = draw_remote_source_affordance(result, row_min, row_max, text_y);
            } else {
                const std::string source = source_label(result.source);
                const ImVec2 source_size = ImGui::CalcTextSize(source.c_str());
                ImGui::GetWindowDrawList()->AddText(
                    ImVec2(row_max.x - source_size.x - 12.0f, text_y),
                    ImGui::ColorConvertFloat4ToU32(source_color(result.source)),
                    source.c_str());
                right_limit_x = row_max.x - source_size.x - 22.0f;
            }
        } else if (!result.badge.empty()) {
            const ImVec2 badge_size = ImGui::CalcTextSize(result.badge.c_str());
            ImGui::GetWindowDrawList()->AddText(
                ImVec2(row_max.x - badge_size.x - 12.0f, text_y),
                IM_COL32(180, 184, 191, 255),
                result.badge.c_str());
            right_limit_x = row_max.x - badge_size.x - 22.0f;
        }

        const float text_x = row_min.x + 92.0f;
        const float text_width = std::max(0.0f, right_limit_x - text_x);
        const ImVec2 clip_min(text_x, row_min.y + 2.0f);
        const ImVec2 clip_max(std::max(text_x, right_limit_x), row_max.y - 2.0f);
        ImDrawList* draw_list = ImGui::GetWindowDrawList();
        draw_list->PushClipRect(clip_min, clip_max, true);

        const std::string display_name = ellipsize_text(result.name, text_width);
        draw_list->AddText(ImVec2(text_x, text_y),
                           IM_COL32(236, 238, 242, 255),
                           display_name.c_str());

        const std::string subtitle = !result.subtitle.empty()
            ? result.subtitle
            : (result.path.empty() ? std::string() : result.path);
        if (!subtitle.empty()) {
            const std::string display_subtitle = ellipsize_text(subtitle, text_width);
            draw_list->AddText(ImVec2(text_x, text_y + 15.0f),
                               IM_COL32(150, 154, 162, 255),
                               display_subtitle.c_str());
        }
        draw_list->PopClipRect();
        ImGui::PopID();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();
}

void FilesSearchPalette::render(const std::string& current_path, const ImVec2& viewport_pos, const ImVec2& viewport_size) {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    bool just_opened = false;
    {
        std::lock_guard<std::mutex> lock(state.mu);
        state.context_path = current_path;
        if (!state.is_open) {
            return;
        }
        just_opened = state.just_opened;
    }

    const float width = std::min(kPaletteWidth, viewport_size.x - 80.0f);
    const float height = std::min(kPaletteMaxHeight, viewport_size.y - 120.0f);
    const ImVec2 palette_pos(viewport_pos.x + (viewport_size.x - width) * 0.5f,
                             viewport_pos.y + 72.0f);
    const ImVec2 palette_max(palette_pos.x + width, palette_pos.y + height);

    ImGui::SetNextWindowPos(viewport_pos);
    ImGui::SetNextWindowSize(viewport_size);
    ImGui::SetNextWindowViewport(ImGui::GetMainViewport()->ID);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));

    bool close_from_background_click = false;
    ImGuiWindowFlags backdrop_flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoSavedSettings |
        ImGuiWindowFlags_NoScrollbar |
        ImGuiWindowFlags_NoBackground;
    if (ImGui::Begin("##files_search_palette_backdrop", nullptr, backdrop_flags)) {
        ImGui::InvisibleButton("##files_search_palette_backdrop_button", viewport_size);
        if (!just_opened && ImGui::IsItemClicked(ImGuiMouseButton_Left)) {
            const ImVec2 mouse_pos = ImGui::GetMousePos();
            const bool inside_palette = mouse_pos.x >= palette_pos.x && mouse_pos.x <= palette_max.x &&
                                        mouse_pos.y >= palette_pos.y && mouse_pos.y <= palette_max.y;
            if (!inside_palette) {
                close_from_background_click = true;
            }
        }
    }
    ImGui::End();
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(3);

    ImGui::SetNextWindowPos(palette_pos);
    ImGui::SetNextWindowSize(ImVec2(width, height));
    if (just_opened) {
        ImGui::SetNextWindowFocus();
    }
    ImGuiWindowFlags flags =
        ImGuiWindowFlags_NoTitleBar |
        ImGuiWindowFlags_NoResize |
        ImGuiWindowFlags_NoMove |
        ImGuiWindowFlags_NoCollapse |
        ImGuiWindowFlags_NoSavedSettings |
        ImGuiWindowFlags_NoScrollbar;
    ImGui::SetNextWindowViewport(ImGui::GetMainViewport()->ID);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 12.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.08f, 0.09f, 0.10f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.18f, 0.20f, 0.24f, 1.0f));

    if (ImGui::Begin("##files_search_palette", nullptr, flags)) {
        if (state.focus_query) {
            ImGui::SetKeyboardFocusHere();
            state.focus_query = false;
        }
        if (just_opened) {
            std::lock_guard<std::mutex> lock(state.mu);
            state.just_opened = false;
        }

        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f, 10.0f));
        ImGui::SetNextItemWidth(-1.0f);
        const bool submitted = ImGui::InputTextWithHint("##files_palette_query",
                                                        "Search files, locations, or type > for commands",
                                                        state.query_buf,
                                                        sizeof(state.query_buf),
                                                        ImGuiInputTextFlags_EnterReturnsTrue);
        ImGui::PopStyleVar();

        const std::string raw_query = state.query_buf;
        if (ImGui::IsItemEdited()) {
            std::lock_guard<std::mutex> lock(state.mu);
            state.selected_index = 0;
            state.search_pending = true;
            state.last_input_change_at = std::chrono::steady_clock::now();
            state.last_err.clear();
        }

        if (core::CommandManager::get().matches("search.cancel")) {
            close();
        } else {
            if (core::CommandManager::get().matches("search.prev", true) && state.selected_index > 0) {
                std::lock_guard<std::mutex> lock(state.mu);
                --state.selected_index;
            }
            if (core::CommandManager::get().matches("search.next", true)) {
                std::lock_guard<std::mutex> lock(state.mu);
                if (state.selected_index < static_cast<int>(state.results.size()) - 1) {
                    ++state.selected_index;
                }
            }
            if (submitted || core::CommandManager::get().matches("search.confirm")) {
                activate_selected_result(state);
            }
        }

        bool should_submit = false;
        SearchQuery query = build_query(raw_query, current_path);
        {
            std::lock_guard<std::mutex> lock(state.mu);
            const auto age = std::chrono::steady_clock::now() - state.last_input_change_at;
            should_submit = state.search_pending && !state.search_in_flight &&
                            (submitted || age >= kSearchDebounceDelay);
        }
        if (should_submit) {
            submit_search(query);
        }

        ImGui::Spacing();
        const bool has_query = !trim_copy(raw_query).empty();
        {
            std::lock_guard<std::mutex> lock(state.mu);
            if (!has_query) {
                ImGui::TextDisabled("Try `report ext:pdf scope:workspace`, `type:folder source:remote`, or `>refresh`.");
            } else if (state.search_in_flight) {
                ImGui::TextDisabled("Searching...");
            } else if (!state.last_err.empty()) {
                if ((state.last_query_source == SearchSource::REMOTE ||
                     state.last_query_source == SearchSource::ALL) &&
                    is_remote_search_not_supported_error(state.last_err)) {
                    ImGui::TextColored(ImVec4(0.91f, 0.72f, 0.28f, 1.0f), "Cloud search not available yet");
                    if (!state.results.empty()) {
                        ImGui::TextWrapped("Showing local results only. Cloud search will work once the proxy search backend supports remote indexing.");
                    } else {
                        ImGui::TextWrapped("This build can parse remote search responses, but the proxy backend is still returning local-only support.");
                    }
                } else if (!state.results.empty()) {
                    ImGui::TextColored(ImVec4(0.91f, 0.72f, 0.28f, 1.0f), "Cloud search unavailable");
                    ImGui::TextWrapped("Showing local results only. %s", state.last_err.c_str());
                } else {
                    ImGui::TextColored(ImVec4(0.92f, 0.45f, 0.45f, 1.0f), "Search failed");
                    ImGui::TextWrapped("%s", state.last_err.c_str());
                }
            } else if (state.refresh_in_progress) {
                int refreshing_remotes = 0;
                for (const auto& remote : state.remote_statuses) {
                    if (remote.refreshing || remote.status == "refreshing") {
                        ++refreshing_remotes;
                    }
                }
                if (state.results_cached) {
                    ImGui::TextDisabled("Showing cached cloud results. Updating %d remote%s...",
                                        refreshing_remotes,
                                        refreshing_remotes == 1 ? "" : "s");
                } else {
                    ImGui::TextDisabled("Updating cloud results...");
                }
            } else if (state.results.empty()) {
                ImGui::TextDisabled("No results");
            } else if (state.results_updated) {
                ImGui::TextDisabled("Cloud results updated.");
            }
        }

        if (has_query) {
            render_results(state);
        }
    }
    ImGui::End();

    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(2);

    if (close_from_background_click) {
        close();
    }
}

} // namespace misty::panel

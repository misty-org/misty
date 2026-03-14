#include "panels/search/files_search_palette.h"

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"

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
        case SearchResultKind::Location: return "Location";
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

void FilesSearchPalette::open(const std::string& current_path) {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    std::lock_guard<std::mutex> lock(state.mu);
    state.is_open = true;
    state.focus_query = true;
    state.context_path = current_path;
}

void FilesSearchPalette::close() {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    std::lock_guard<std::mutex> lock(state.mu);
    state.is_open = false;
    state.focus_query = false;
    state.search_pending = false;
    state.search_in_flight = false;
    ++state.request_generation;
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
    query.depth = SearchScope::cwd();
    query.source = current_path.find("/.misty/mnt/") != std::string::npos
        ? SearchSource::REMOTE
        : SearchSource::LOCAL;

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
    return query;
}

void FilesSearchPalette::submit_search(const SearchQuery& query) {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    std::uint64_t request_generation = 0;
    {
        std::lock_guard<std::mutex> lock(state.mu);
        state.results.clear();
        state.selected_index = 0;
        state.search_pending = false;
        state.search_in_flight = true;
        state.last_submitted_query = query.raw_query;
        state.last_err.clear();
        request_generation = ++state.request_generation;
    }

    worker_pool_.add(
        [this, &state, query, request_generation]() mutable {
            std::vector<SearchResult> merged_results;
            if (local_result_provider_) {
                merged_results = local_result_provider_(query);
            }

            if (!query.commands_only && !backend_query_text(query).empty()) {
                SearchQuery backend_query = query;
                backend_query.query = backend_query_text(query);
                search_impl_.search(
                    backend_query,
                    [&](std::vector<SearchResult>& backend_results) {
                        for (auto& result : backend_results) {
                            if (match_result_filters(query, result)) {
                                merged_results.push_back(std::move(result));
                            }
                        }
                    },
                    [&](const std::string& error) {
                        std::lock_guard<std::mutex> lock(state.mu);
                        if (state.request_generation != request_generation) {
                            return;
                        }
                        state.search_in_flight = false;
                        state.last_err = error;
                    });
            }

            sort_results(merged_results);
            {
                std::lock_guard<std::mutex> lock(state.mu);
                if (state.request_generation != request_generation) {
                    return;
                }
                state.results = std::move(merged_results);
                state.search_in_flight = false;
            }
        },
        []() {},
        [&state, request_generation](const std::string& error) {
            std::lock_guard<std::mutex> lock(state.mu);
            if (state.request_generation != request_generation) {
                return;
            }
            state.results.clear();
            state.search_in_flight = false;
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

    ImGui::BeginChild("##files_search_results", ImVec2(0.0f, 0.0f), false, ImGuiWindowFlags_None);
    SearchResultKind last_kind = SearchResultKind::File;
    bool first = true;
    for (int i = 0; i < static_cast<int>(results.size()); ++i) {
        const SearchResult& result = results[i];
        if (first || result.kind != last_kind) {
            first = false;
            last_kind = result.kind;
            ImGui::Spacing();
            ImGui::TextDisabled("%s", kind_label(result.kind));
        }

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
        ImGui::GetWindowDrawList()->AddText(ImVec2(row_min.x + 10.0f, text_y),
                                            ImGui::ColorConvertFloat4ToU32(kind_color(result.kind)),
                                            kind_label(result.kind));
        ImGui::GetWindowDrawList()->AddText(ImVec2(row_min.x + 92.0f, text_y),
                                            IM_COL32(236, 238, 242, 255),
                                            result.name.c_str());

        const std::string subtitle = !result.subtitle.empty()
            ? result.subtitle
            : (result.path.empty() ? std::string() : result.path);
        if (!subtitle.empty()) {
            ImGui::GetWindowDrawList()->AddText(ImVec2(row_min.x + 92.0f, text_y + 15.0f),
                                                IM_COL32(150, 154, 162, 255),
                                                subtitle.c_str());
        }

        if (result.kind == SearchResultKind::File || result.kind == SearchResultKind::Folder) {
            const std::string source = source_label(result.source);
            const ImVec2 source_size = ImGui::CalcTextSize(source.c_str());
            ImGui::GetWindowDrawList()->AddText(
                ImVec2(row_max.x - source_size.x - 12.0f, text_y),
                ImGui::ColorConvertFloat4ToU32(source_color(result.source)),
                source.c_str());
        } else if (!result.badge.empty()) {
            const ImVec2 badge_size = ImGui::CalcTextSize(result.badge.c_str());
            ImGui::GetWindowDrawList()->AddText(
                ImVec2(row_max.x - badge_size.x - 12.0f, text_y),
                IM_COL32(180, 184, 191, 255),
                result.badge.c_str());
        }
        ImGui::PopID();
    }
    ImGui::EndChild();
}

void FilesSearchPalette::render(const std::string& current_path, const ImVec2& viewport_pos, const ImVec2& viewport_size) {
    auto& state = state_registry_.get_state<SearchState>(state_key_);
    {
        std::lock_guard<std::mutex> lock(state.mu);
        state.context_path = current_path;
        if (!state.is_open) {
            return;
        }
    }

    ImDrawList* bg = ImGui::GetForegroundDrawList(ImGui::GetMainViewport());
    bg->AddRectFilled(viewport_pos,
                      ImVec2(viewport_pos.x + viewport_size.x, viewport_pos.y + viewport_size.y),
                      IM_COL32(0, 0, 0, 110));

    const float width = std::min(kPaletteWidth, viewport_size.x - 80.0f);
    const float height = std::min(kPaletteMaxHeight, viewport_size.y - 120.0f);
    const ImVec2 palette_pos(viewport_pos.x + (viewport_size.x - width) * 0.5f,
                             viewport_pos.y + 72.0f);

    ImGui::SetNextWindowPos(palette_pos);
    ImGui::SetNextWindowSize(ImVec2(width, height));
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
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.08f, 0.09f, 0.10f, 0.98f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.18f, 0.20f, 0.24f, 1.0f));

    if (ImGui::Begin("##files_search_palette", nullptr, flags)) {
        if (state.focus_query) {
            ImGui::SetKeyboardFocusHere();
            state.focus_query = false;
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
                ImGui::TextColored(ImVec4(0.92f, 0.45f, 0.45f, 1.0f), "Search failed");
                ImGui::TextWrapped("%s", state.last_err.c_str());
            } else if (state.results.empty()) {
                ImGui::TextDisabled("No results");
            }
        }

        if (has_query) {
            render_results(state);
        }
    }
    ImGui::End();

    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(2);
}

} // namespace misty::panel

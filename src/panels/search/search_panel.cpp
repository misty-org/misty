#include "panels/search/search_panel.h"

#include "core/commands/command_manager.h"
#include "core/manager/asset_manager.h"
#include "core/ui/ui_layout.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <utility>

#include <imgui.h>

namespace fs = std::filesystem;

namespace misty::panel {

namespace {

struct QueryInputState {
    bool changed = false;
    bool submitted = false;
    bool input_active = false;
    std::string query;
};

struct OverlaySnapshot {
    bool has_results = false;
    bool pending = false;
    bool waiting = false;
    std::string error_message;
};


constexpr auto kSearchDebounceDelay = std::chrono::milliseconds(450);

std::string lowercase_copy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

const char* source_label(FileSource src) {
    switch (src) {
        case FileSource::LOCAL:  return "LOC";
        case FileSource::REMOTE: return "REM";
        default:                 return "LOC";
    }
}

ImVec4 source_color(FileSource src) {
    switch (src) {
        case FileSource::LOCAL:  return { 0.70f, 0.70f, 0.70f, 1.0f };
        case FileSource::REMOTE: return { 0.00f, 0.60f, 0.88f, 1.0f };
        default:                 return { 0.60f, 0.60f, 0.60f, 1.0f };
    }
}

std::string display_path_for_result(const SearchResult& result, const std::string& current_path) {
    fs::path current(current_path);
    fs::path item_path(result.path);
    fs::path display_path = result.is_dir ? item_path : item_path.parent_path();
    std::error_code ec;
    fs::path relative = current.empty() ? display_path : fs::relative(display_path, current, ec);
    if (!ec && !relative.empty() && relative != ".") {
        return relative.string();
    }
    return display_path.string();
}

void sort_results(std::vector<SearchResult>& results) {
    std::sort(results.begin(), results.end(), [](const SearchResult& a, const SearchResult& b) {
        if (a.score != b.score) {
            return a.score > b.score;
        }
        if (a.is_dir != b.is_dir) {
            return a.is_dir > b.is_dir;
        }
        return lowercase_copy(a.name) < lowercase_copy(b.name);
    });
}

void selected_row_background(bool selected) {
    if (selected) {
        ImVec2 row_min = ImGui::GetCursorScreenPos();
        ImVec2 row_max = { row_min.x + ImGui::GetContentRegionAvail().x, row_min.y + 28.0f };
        ImGui::GetWindowDrawList()->AddRectFilled(row_min, row_max, IM_COL32(60, 60, 80, 200));
    }
}

void result_icon(const SearchResult& result,
                 const core::SVGTexture& dir_tex,
                 const core::SVGTexture& file_tex) {
    const auto& icon = result.is_dir ? dir_tex : file_tex;
    if (icon.id != 0) {
        UI::image({
            .texture_id = static_cast<ImTextureID>(icon.id),
            .width = UI::Size::px(14.0f),
            .height = UI::Size::px(14.0f),
            .tint_color = result.is_dir
                ? ImVec4(230.0f / 255.0f, 191.0f / 255.0f, 76.0f / 255.0f, 1.0f)
                : ImVec4(100.0f / 255.0f, 170.0f / 255.0f, 230.0f / 255.0f, 1.0f),
        });
        return;
    }

    UI::text({
        .text = result.is_dir ? "D" : "F",
        .width = UI::Size::px(14.0f),
    });
}

void result_text(const SearchResult& result, const std::string& path_display) {
    UI::text({
        .text = result.name.c_str(),
        .width = UI::Size::fill(),
        .overflow = UI::TextOverflow::Clip,
    });

    if (!path_display.empty()) {
        UI::text({
            .text = path_display.c_str(),
            .width = UI::Size::auto_size(),
            .align = UI::Align::End,
            .color = ImVec4(0.60f, 0.60f, 0.64f, 1.0f),
            .overflow = UI::TextOverflow::Clip,
        });
        return;
    }

    UI::spacer(0.0f, 0.0f);
}

void result_row(const SearchResult& result,
                const std::string& current_path,
                bool selected,
                const core::SVGTexture& dir_tex,
                const core::SVGTexture& file_tex) {
    const std::string path_display = display_path_for_result(result, current_path);

    selected_row_background(selected);
    UI::row("##search_result_row", {
        .mode = UI::Mode::LayoutOnly,
        .width = UI::Size::fill(),
        .height = UI::Size::px(28.0f),
        .padding = UI::Spacing::sides(8.0f, 8.0f, 4.0f, 4.0f),
        .gap = UI::Spacing::xy(8.0f, 0.0f),
        .align = UI::Align::Center,
    }, [&]() {
        UI::text({
            .text = source_label(result.source),
            .width = UI::Size::px(30.0f),
            .color = source_color(result.source),
        });

        result_icon(result, dir_tex, file_tex);
        result_text(result, path_display);
    });
}

bool submittable_query(const std::string& query) {
    return (!query.empty() && query[0] == ':' && query.size() > 1) || query.size() >= 2;
}

void clear_results(SearchState& state) {
    std::lock_guard<std::mutex> lock(state.mu);
    state.results.clear();
    state.search_pending = false;
    state.search_in_flight = false;
    state.last_submitted_query.clear();
    state.last_err.clear();
}

void close_overlay(SearchState& state) {
    std::memset(state.query_buf, 0, sizeof(state.query_buf));
    std::lock_guard<std::mutex> lock(state.mu);
    state.is_open = false;
    state.focus_query = false;
    state.selected_index = 0;
    state.results.clear();
    state.search_pending = false;
    state.search_in_flight = false;
    ++state.request_generation;
    state.last_input_change_at = {};
    state.last_submitted_query.clear();
    state.last_err.clear();
}

QueryInputState query_input(SearchState& state) {
    QueryInputState input;
    UI::div("##search_query_input_shell", {
        .width = UI::Size::fill(),
        .height = UI::Size::px(36.0f),
    }, [&]() {
        input.changed = UI::input_text({
            .label = "##overlay_search_query",
            .buffer = state.query_buf,
            .buffer_size = sizeof(state.query_buf),
            .hint = "Find in folder...  (:pdf)",
            .width = UI::Size::fill(),
            .height = UI::Size::px(36.0f),
            .padding = UI::Spacing::xy(10.0f, 8.0f),
            .rounding = 6.0f,
            .bg_color = ImVec4(0.21f, 0.21f, 0.21f, 1.0f),
            .border_color = ImVec4(0.21f, 0.21f, 0.21f, 1.0f),
            .text_color = ImVec4(0.92f, 0.92f, 0.92f, 1.0f),
            .flags = ImGuiInputTextFlags_EnterReturnsTrue,
        });
    });
    input.submitted = ImGui::IsItemDeactivatedAfterEdit();
    input.input_active = ImGui::IsItemActive();
    input.query = state.query_buf;
    return input;
}

void update_query_state(SearchState& state, const QueryInputState& input) {
    if (input.changed) {
        std::lock_guard<std::mutex> lock(state.mu);
        state.selected_index = 0;
        state.search_pending = false;
        state.last_input_change_at = std::chrono::steady_clock::now();
        if (input.query.empty()) {
            state.results.clear();
            state.last_submitted_query.clear();
            state.last_err.clear();
        }
    }

    if (input.submitted && submittable_query(input.query)) {
        std::lock_guard<std::mutex> lock(state.mu);
        if (input.query != state.last_submitted_query) {
            state.search_pending = true;
        }
        return;
    }

    if (!input.query.empty()) {
        const bool type_filter = input.query[0] == ':' && input.query.size() > 1;
        std::lock_guard<std::mutex> lock(state.mu);
        const auto since_last_change = state.last_input_change_at.time_since_epoch().count() == 0
            ? kSearchDebounceDelay
            : std::chrono::steady_clock::now() - state.last_input_change_at;
        if ((type_filter || input.query.size() >= 2) &&
            input.query != state.last_submitted_query &&
            !state.search_pending &&
            since_last_change >= (type_filter ? std::chrono::milliseconds(0) : kSearchDebounceDelay)) {
            state.search_pending = true;
        }
        return;
    }

    if (!input.input_active) {
        clear_results(state);
    }
}

void move_selection(SearchState& state) {
    std::lock_guard<std::mutex> lock(state.mu);
    if (core::CommandManager::get().matches("search.prev", true) && state.selected_index > 0) {
        --state.selected_index;
    }
    if (core::CommandManager::get().matches("search.next", true)) {
        ++state.selected_index;
    }
}

bool selected_result(SearchState& state, SearchResult& out) {
    std::lock_guard<std::mutex> lock(state.mu);
    if (state.selected_index < 0 ||
        state.selected_index >= static_cast<int>(state.results.size())) {
        return false;
    }
    out = state.results[state.selected_index];
    return true;
}

bool take_pending_query(SearchState& state, std::string& query) {
    std::lock_guard<std::mutex> lock(state.mu);
    if (!state.search_pending || state.search_in_flight) {
        return false;
    }
    state.search_pending = false;
    query = state.query_buf;
    return submittable_query(query);
}

OverlaySnapshot overlay_snapshot(SearchState& state) {
    OverlaySnapshot snapshot;
    std::lock_guard<std::mutex> lock(state.mu);
    snapshot.has_results = !state.results.empty();
    snapshot.pending = state.search_in_flight;
    const std::string query = state.query_buf;
    if (submittable_query(query) &&
        query != state.last_submitted_query &&
        !state.search_in_flight) {
        const auto since_last_change = state.last_input_change_at.time_since_epoch().count() == 0
            ? kSearchDebounceDelay
            : std::chrono::steady_clock::now() - state.last_input_change_at;
        snapshot.waiting = state.search_pending || since_last_change < kSearchDebounceDelay;
    }
    snapshot.error_message = state.last_err;
    return snapshot;
}

void pending_indicator() {
    const float t = static_cast<float>(ImGui::GetTime());
    const char* frames[] = { "|", "/", "-", "\\" };
    ImGui::TextDisabled("Searching... %s", frames[static_cast<int>(t * 8.0f) % 4]);
}

void overlay_status(const OverlaySnapshot& snapshot, bool has_query) {
    if (!has_query) {
        return;
    }
    if (snapshot.pending || snapshot.waiting) {
        pending_indicator();
    } else if (!snapshot.error_message.empty()) {
        ImGui::TextColored(ImVec4(0.92f, 0.45f, 0.45f, 1.0f), "Search failed");
        ImGui::Spacing();
        ImGui::PushTextWrapPos();
        ImGui::TextDisabled("%s", snapshot.error_message.c_str());
        ImGui::PopTextWrapPos();
    } else {
        ImGui::TextDisabled("No files found");
    }
}

} // namespace

SearchPanel::SearchPanel(core::StateRegistry& state_registry,
    core::WorkerPool& worker_pool,
                         std::string explorer_state_key,
                         std::string search_state_key)
    : state_registry_(state_registry),
      worker_pool_(worker_pool),
      explorer_state_key_(std::move(explorer_state_key)),
      search_state_key_(std::move(search_state_key)) {}

void SearchPanel::toggle() {
    auto& state = state_registry_.get_state<SearchState>(search_state_key_);
    std::lock_guard<std::mutex> lock(state.mu);

    if (state.is_open) {
        state.is_open = false;
        state.focus_query = false;
        state.selected_index = 0;
        state.search_pending = false;
        state.search_in_flight = false;
        ++state.request_generation;
        state.last_submitted_query.clear();
        state.last_err.clear();
        state.results.clear();
        std::memset(state.query_buf, 0, sizeof(state.query_buf));
        return;
    }

    state.is_open = true;
    state.focus_query = true;
}

SearchQuery SearchPanel::build_query(const std::string& query_text, const std::string& current_path) const {
    SearchQuery query;
    query.query = query_text;
    query.path = current_path;
    query.depth = SearchScope::cwd();
    query.source = SearchSource::LOCAL;
    return query;
}

void SearchPanel::submit_search(const std::string& query_text, const std::string& current_path) {
    auto& state = state_registry_.get_state<SearchState>(search_state_key_);
    SearchQuery query = build_query(query_text, current_path);
    std::uint64_t request_generation = 0;

    {
        std::lock_guard<std::mutex> lock(state.mu);
        state.results.clear();
        state.selected_index = 0;
        state.search_pending = false;
        state.search_in_flight = true;
        state.last_submitted_query = query_text;
        state.last_err.clear();
        request_generation = ++state.request_generation;
    }

    worker_pool_.add(
        [this, &state, query = std::move(query), request_generation]() mutable {
            search_impl_.search(
                query,
                [&state, request_generation](SearchResponse& response) {
                    sort_results(response.results);
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.request_generation != request_generation) {
                        return;
                    }
                    state.results = std::move(response.results);
                    state.search_in_flight = false;
                    state.results_cached = response.is_cached;
                    state.refresh_in_progress = response.refresh_in_progress;
                    state.results_updated = response.updated;
                    state.updated_at = response.updated_at;
                    state.request_id = response.request_id;
                    state.remote_statuses = std::move(response.remote_statuses);
                },
                [&state, request_generation](const std::string& error) {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.request_generation != request_generation) {
                        return;
                    }
                    state.results.clear();
                    state.search_in_flight = false;
                    state.refresh_in_progress = false;
                    state.last_err = error;
                },
                [&state, request_generation](SearchResponse& response) {
                    sort_results(response.results);
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.request_generation != request_generation) {
                        return;
                    }
                    state.results = std::move(response.results);
                    state.search_in_flight = false;
                    state.results_cached = response.is_cached;
                    state.refresh_in_progress = response.refresh_in_progress;
                    state.results_updated = response.updated;
                    state.updated_at = response.updated_at;
                    state.request_id = response.request_id;
                    state.remote_statuses = std::move(response.remote_statuses);
                });
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

void SearchPanel::navigate_to_result(const SearchResult& result) {
    std::string dest;
    if (result.is_dir) {
        dest = result.path;
    } else {
        fs::path path(result.path);
        dest = path.has_parent_path() ? path.parent_path().string() : result.path;
    }

    if (navigation_handler_) {
        navigation_handler_(dest);
    }
}

void SearchPanel::set_navigation_handler(std::function<void(const std::string& path)> handler) {
    navigation_handler_ = std::move(handler);
}

void SearchPanel::render_results(SearchState& state, const std::string& current_path) {
    std::vector<SearchResult> results;
    int selected_index = 0;
    {
        std::lock_guard<std::mutex> lock(state.mu);
        results = state.results;
        selected_index = state.selected_index;
    }

    ImGui::BeginChild("##search_results", ImVec2(0, 0), false, ImGuiWindowFlags_None);

    auto& dir_tex  = core::AssetManager::get().get_svg_texture("file-directory-fill-16", 14);
    auto& file_tex = core::AssetManager::get().get_svg_texture("file-16", 14);

    for (int i = 0; i < static_cast<int>(results.size()); ++i) {
        const SearchResult& result = results[i];
        const bool selected = (i == selected_index);

        ImGui::PushID(i);

        if (ImGui::Selectable("##row", selected, ImGuiSelectableFlags_AllowOverlap, {0, 28.0f})) {
            navigate_to_result(result);
            std::lock_guard<std::mutex> lock(state.mu);
            state.is_open = false;
        }
        if (ImGui::IsItemHovered()) {
            std::lock_guard<std::mutex> lock(state.mu);
            state.selected_index = i;
        }

        result_row(result, current_path, selected, dir_tex, file_tex);

        ImGui::PopID();
    }

    ImGui::EndChild();
}

void SearchPanel::render(const std::string& current_path, float available_height) {
    auto& state = state_registry_.get_state<SearchState>(search_state_key_);
    if (!state.is_open) {
        return;
    }

    const float overlay_h = std::min(350.0f, available_height);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.14f, 0.14f, 0.14f, 0.97f));
    if (ImGui::BeginChild("##search_overlay", {0, overlay_h}, false, ImGuiWindowFlags_NoScrollbar)) {
        if (state.focus_query) {
            ImGui::SetKeyboardFocusHere();
            state.focus_query = false;
        }
        UI::column("##search_overlay_content", {
            .mode = UI::Mode::LayoutOnly,
            .width = UI::Size::fill(),
            .height = UI::Size::fill(),
            .gap = UI::Spacing::xy(0.0f, 8.0f),
        }, [&]() {
            const QueryInputState input = query_input(state);
            update_query_state(state, input);

            if (core::CommandManager::get().matches("search.cancel")) {
                close_overlay(state);
                return;
            }

            move_selection(state);

            if (core::CommandManager::get().matches("search.confirm")) {
                SearchResult selected;
                if (selected_result(state, selected)) {
                    navigate_to_result(selected);
                    state.is_open = false;
                }
            }

            std::string pending_query;
            if (take_pending_query(state, pending_query)) {
                submit_search(pending_query, current_path);
            }

            const OverlaySnapshot snapshot = overlay_snapshot(state);
            if (snapshot.has_results) {
                if (snapshot.pending) {
                    pending_indicator();
                }
                render_results(state, current_path);
                return;
            }

            overlay_status(snapshot, state.query_buf[0] != '\0');
        });
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();
}

} // namespace misty::panel

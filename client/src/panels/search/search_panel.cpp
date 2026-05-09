#include "panels/search/search_panel.h"

#include "core/manager/asset_manager.h"
#include "core/ui/ui_layout.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <filesystem>

#include <imgui.h>

namespace fs = std::filesystem;

namespace misty::panel {

namespace {

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

} // namespace

SearchPanel::SearchPanel(core::UIRegistry& ui_registry,
    core::WorkerPool& worker_pool,
                         std::string explorer_state_key,
                         std::string search_state_key)
    : ui_registry_(ui_registry),
      worker_pool_(worker_pool),
      explorer_state_key_(std::move(explorer_state_key)),
      search_state_key_(std::move(search_state_key)) {}

void SearchPanel::toggle() {
    auto& state = ui_registry_.get_state<SearchState>(search_state_key_);
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

SearchQuery SearchPanel::build_query(const std::string& query_text) const {
    SearchQuery query;
    query.query = query_text;

    auto& fe_state = ui_registry_.get_state<FileExplorerState>(explorer_state_key_);
    std::lock_guard<std::mutex> lock(fe_state.mu);
    query.path = fe_state.current_path;
    query.depth = SearchScope::cwd();
    query.source = SearchSource::LOCAL;
    return query;
}

void SearchPanel::submit_search(const std::string& query_text) {
    auto& state = ui_registry_.get_state<SearchState>(search_state_key_);
    SearchQuery query = build_query(query_text);
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
                [&state, request_generation](std::vector<SearchResult>& results) {
                    sort_results(results);
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.request_generation != request_generation) {
                        return;
                    }
                    state.results = std::move(results);
                    state.search_in_flight = false;
                },
                [&state, request_generation](const std::string& error) {
                    std::lock_guard<std::mutex> lock(state.mu);
                    if (state.request_generation != request_generation) {
                        return;
                    }
                    state.results.clear();
                    state.search_in_flight = false;
                    state.last_err = error;
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
    auto& fe_state = ui_registry_.get_state<FileExplorerState>(explorer_state_key_);

    std::string dest;
    if (result.is_dir) {
        dest = result.path;
    } else {
        fs::path path(result.path);
        dest = path.has_parent_path() ? path.parent_path().string() : result.path;
    }

    fe_state.pending_navigation_path = dest;
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

void SearchPanel::render() {
    //



}

} // namespace misty::panel

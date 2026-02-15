#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <cctype>
#include <cfloat>
#include <cstdio>
#include <fstream>
#include <set>
#include <sstream>

#include <nlohmann/json.hpp>

#include "core/manager/asset_manager.h"
#include "core/manager/env_manager.h"
#include "core/net/http_client.h"

namespace misty::panel {
namespace {

using json = nlohmann::json;
using misty::core::AssetManager;

std::string trim_copy(const std::string& value) {
    const auto start = std::find_if_not(value.begin(), value.end(), [](unsigned char c) {
        return std::isspace(c);
    });
    const auto end = std::find_if_not(value.rbegin(), value.rend(), [](unsigned char c) {
        return std::isspace(c);
    }).base();
    if (start >= end) {
        return "";
    }
    return std::string(start, end);
}

bool is_probably_text_file(const UnifiedFileItem& item) {
    if (item.is_dir) {
        return false;
    }
    static const std::set<std::string> text_extensions = {
        ".txt", ".md", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
        ".cpp", ".cc", ".c", ".h", ".hpp", ".py", ".js", ".ts", ".tsx", ".jsx",
        ".go", ".rs", ".java", ".cs", ".html", ".css", ".scss", ".xml", ".sql",
        ".sh", ".zsh", ".bash", ".env", ".log"
    };
    const std::string ext = std::filesystem::path(item.name).extension().string();
    if (text_extensions.contains(ext)) {
        return true;
    }
    return item.mime_type.rfind("text/", 0) == 0 || item.mime_type == "application/json";
}

std::string read_file_excerpt(const std::string& path, size_t max_bytes) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) {
        return "";
    }

    std::string content;
    content.resize(max_bytes);
    file.read(content.data(), static_cast<std::streamsize>(max_bytes));
    content.resize(static_cast<size_t>(file.gcount()));
    return content;
}

std::string response_error_message(const core::HttpResponse& response) {
    if (response.body.empty()) {
        return "Request failed with status " + std::to_string(response.status_code) + ".";
    }

    try {
        const json body = json::parse(response.body);
        if (body.contains("error")) {
            const json& error = body["error"];
            if (error.is_string()) {
                return error.get<std::string>();
            }
            if (error.contains("message")) {
                return error.value("message", "Request failed.");
            }
        }
    } catch (...) {
    }

    const std::string plain = trim_copy(response.body);
    if (!plain.empty()) {
        return plain;
    }

    return "Request failed with status " + std::to_string(response.status_code) + ".";
}

void render_message_bubble(int index,
                           const char* speaker,
                           const std::string& content,
                           const ImVec4& bg_color,
                           const ImVec4& text_color,
                           bool allow_copy = true) {
    if (content.empty()) {
        return;
    }

    ImGui::PushID(index);
    ImGui::BeginGroup();
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.65f, 0.65f, 0.65f, 1.0f));
    ImGui::TextUnformatted(speaker);
    ImGui::PopStyleColor();

    const float wrap_width = std::max(180.0f, ImGui::GetContentRegionAvail().x - 18.0f);
    const ImVec2 text_size = ImGui::CalcTextSize(content.c_str(), nullptr, false, wrap_width);
    const float bubble_h = std::max(52.0f, text_size.y + 22.0f);

    ImGui::PushStyleColor(ImGuiCol_ChildBg, bg_color);
    ImGui::PushStyleColor(ImGuiCol_Border, IM_COL32(52, 52, 52, 255));
    ImGui::PushStyleColor(ImGuiCol_Text, text_color);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, bg_color);
    if (ImGui::BeginChild("##bubble", ImVec2(0.0f, bubble_h), true,
                          ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(0.0f, 0.0f));
        ImGui::InputTextMultiline("##bubble_text",
                                  const_cast<char*>(content.c_str()),
                                  content.size() + 1,
                                  ImVec2(-FLT_MIN, text_size.y + 8.0f),
                                  ImGuiInputTextFlags_ReadOnly | ImGuiInputTextFlags_NoHorizontalScroll);
        ImGui::PopStyleVar();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor(4);
    ImGui::Dummy(ImVec2(0.0f, 8.0f));
    ImGui::EndGroup();

    bool copy_hovered = false;
    if (allow_copy) {
        const ImVec2 group_min = ImGui::GetItemRectMin();
        const ImVec2 group_max = ImGui::GetItemRectMax();
        const bool group_hovered = ImGui::IsMouseHoveringRect(group_min, group_max, true);
        if (group_hovered) {
            auto& copy_icon = AssetManager::get().get_svg_texture("copy-16", 16);
            const ImVec2 saved_cursor = ImGui::GetCursorScreenPos();
            const ImVec2 button_size(20.0f, 20.0f);
            const ImVec2 button_pos(group_max.x - button_size.x - 6.0f, group_min.y - 2.0f);
            ImGui::SetCursorScreenPos(button_pos);
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0, 0, 0, 0));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.24f, 0.24f, 0.24f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.18f, 0.18f, 0.18f, 1.0f));
            const bool copy_clicked = copy_icon.id != 0
                ? ImGui::ImageButton("##copy_message", copy_icon.id, ImVec2(16.0f, 16.0f),
                                     ImVec2(0, 0), ImVec2(1, 1), ImVec4(0, 0, 0, 0),
                                     ImVec4(0.82f, 0.82f, 0.82f, 1.0f))
                : ImGui::SmallButton("C");
            copy_hovered = ImGui::IsItemHovered();
            ImGui::PopStyleColor(3);
            if (copy_clicked) {
                ImGui::SetClipboardText(content.c_str());
            }
            ImGui::SetCursorScreenPos(saved_cursor);
        }
    }
    if (copy_hovered) {
        ImGui::SetTooltip("Copy");
    }
    ImGui::PopID();
}

} // namespace

std::string FileExplorerPanel::build_chat_context(const FileExplorerState& state) const {
    std::ostringstream out;
    out << "Current path: " << (state.current_path[0] ? state.current_path : "(none)") << "\n";
    out << "Visible items: " << state.files.size() << "\n";

    const size_t file_limit = std::min<size_t>(state.files.size(), 40);
    for (size_t i = 0; i < file_limit; ++i) {
        const UnifiedFileItem& item = state.files[i];
        out << "- " << (item.is_dir ? "[dir] " : "[file] ") << item.name;
        if (!item.is_dir && item.size > 0) {
            out << " (" << item.size << " bytes)";
        }
        if (!item.last_modified.empty()) {
            out << " modified " << item.last_modified;
        }
        out << "\n";
    }
    if (state.files.size() > file_limit) {
        out << "- ... " << (state.files.size() - file_limit) << " more items omitted\n";
    }

    std::vector<const UnifiedFileItem*> selected_items;
    selected_items.reserve(state.selected_files.size());
    for (const auto& item : state.files) {
        if (state.selected_files.contains(item.id)) {
            selected_items.push_back(&item);
        }
    }

    out << "Selected items: " << selected_items.size() << "\n";
    for (const UnifiedFileItem* item : selected_items) {
        out << "- " << item->path << "\n";
    }

    size_t included_files = 0;
    size_t included_bytes = 0;
    constexpr size_t kMaxFiles = 4;
    constexpr size_t kMaxBytesPerFile = 8192;
    constexpr size_t kMaxBytesTotal = 24576;

    for (const UnifiedFileItem* item : selected_items) {
        if (included_files >= kMaxFiles || included_bytes >= kMaxBytesTotal) {
            break;
        }
        if (!is_probably_text_file(*item)) {
            continue;
        }
        if (!std::filesystem::exists(item->path)) {
            continue;
        }

        const size_t remaining = kMaxBytesTotal - included_bytes;
        const std::string excerpt = read_file_excerpt(item->path, std::min(kMaxBytesPerFile, remaining));
        if (excerpt.empty()) {
            continue;
        }

        included_files++;
        included_bytes += excerpt.size();
        out << "\n[Selected file excerpt: " << item->path << "]\n";
        out << excerpt << "\n";
    }

    return out.str();
}

void FileExplorerPanel::submit_chat_message(FileExplorerState& state) {
    if (state.chat_request_in_flight) {
        return;
    }

    const std::string proxy_url = core::EnvManager::get().get("PROXY_SERVICE_URL", "");
    if (proxy_url.empty()) {
        state.chat_error_msg = "PROXY_SERVICE_URL is not configured.";
        return;
    }

    const std::string prompt = trim_copy(state.chat_input_buffer);
    if (prompt.empty()) {
        return;
    }

    state.chat_messages.push_back({"user", prompt});
    state.chat_request_in_flight = true;
    state.chat_error_msg.clear();
    state.chat_input_buffer[0] = '\0';

    const std::string url = proxy_url + "/api/ai/file-context";
    const std::string context = build_chat_context(state);
    json request = {
        {"prompt", prompt},
        {"context", context},
        {"history", json::array()},
    };
    for (const auto& message : state.chat_messages) {
        request["history"].push_back({
            {"role", message.role},
            {"content", message.content},
        });
    }

    worker_pool_.add(
        [&state, url, request = request.dump()]() {
            const core::HttpResponse response = core::HTTPClient::get().post(
                url,
                request,
                {{"Content-Type", "application/json"}}
            );

            std::lock_guard<std::mutex> lock(state.mu);
            state.chat_request_in_flight = false;

            if (response.status_code < 200 || response.status_code >= 300) {
                state.chat_error_msg = response_error_message(response);
                return;
            }

            try {
                const json body = json::parse(response.body);
                const std::string assistant_text = trim_copy(body.value("reply", ""));
                if (assistant_text.empty()) {
                    state.chat_error_msg = "The API returned an empty response.";
                    return;
                }
                state.chat_messages.push_back({"assistant", assistant_text});
            } catch (const std::exception& ex) {
                state.chat_error_msg = ex.what();
            }
        },
        []() {},
        [&state](const std::string& err) {
            std::lock_guard<std::mutex> lock(state.mu);
            state.chat_request_in_flight = false;
            state.chat_error_msg = err;
        }
    );
}

void FileExplorerPanel::render_chat_overlay(FileExplorerState& state,
                                            float overlay_width,
                                            float overlay_height,
                                            float min_overlay_height,
                                            float max_overlay_height,
                                            float overlay_bottom_y) {
    constexpr float kResizeHandleHeight = 8.0f;
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14.0f, 12.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 12.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, IM_COL32(18, 18, 18, 255));
    ImGui::PushStyleColor(ImGuiCol_Border, IM_COL32(44, 44, 44, 255));
    ImGui::PushStyleColor(ImGuiCol_FrameBg, IM_COL32(28, 28, 28, 255));

    if (ImGui::BeginChild("##llm_chat_overlay", ImVec2(overlay_width, overlay_height), true,
                          ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse)) {
        const ImVec2 window_pos = ImGui::GetWindowPos();
        const ImVec2 window_size = ImGui::GetWindowSize();
        const ImVec2 saved_cursor = ImGui::GetCursorScreenPos();
        const ImVec2 handle_pos(window_pos.x, window_pos.y);
        const ImVec2 handle_size(window_size.x, kResizeHandleHeight);
        ImGui::SetCursorScreenPos(handle_pos);
        ImGui::InvisibleButton("##chat_resize_handle", handle_size);
        const bool handle_hovered = ImGui::IsItemHovered();
        if (handle_hovered || state.chat_resizing) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeNS);
        }
        if (handle_hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            state.chat_resizing = true;
        }
        if (state.chat_resizing) {
            if (ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
                const float new_height = overlay_bottom_y - ImGui::GetIO().MousePos.y;
                state.chat_overlay_height = std::clamp(new_height, min_overlay_height, max_overlay_height);
            } else {
                state.chat_resizing = false;
                state.chat_resize_just_finished = true;
            }
        }
        ImDrawList* dl = ImGui::GetWindowDrawList();
        const ImU32 handle_col = handle_hovered || state.chat_resizing
            ? IM_COL32(185, 185, 185, 150)
            : IM_COL32(110, 110, 110, 110);
        const float line_y = handle_pos.y + 1.0f;
        dl->AddLine(ImVec2(handle_pos.x + 10.0f, line_y),
                    ImVec2(handle_pos.x + handle_size.x - 10.0f, line_y),
                    handle_col, 2.0f);
        ImGui::SetCursorScreenPos(saved_cursor);

        const char* current_path = state.current_path[0] ? state.current_path : "(no active path)";
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.96f, 0.96f, 0.96f, 1.0f));
        ImGui::TextUnformatted("Context");
        ImGui::PopStyleColor();
        ImGui::SameLine();
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.74f, 0.74f, 0.74f, 1.0f));
        ImGui::TextUnformatted(current_path);
        ImGui::PopStyleColor();
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip("%s", current_path);
        }
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
        ImGui::TextDisabled("Questions are limited to this path and files currently visible or selected inside it.");
        ImGui::PopStyleColor();

        const float button_w = 72.0f;
        const float close_w = 32.0f;
        const float right_x = ImGui::GetWindowContentRegionMax().x - button_w - close_w - 12.0f;
        if (right_x > ImGui::GetCursorPosX()) {
            ImGui::SameLine(right_x);
        }
        ImGui::BeginDisabled(state.chat_resize_just_finished);
        if (ImGui::Button("Clear", ImVec2(button_w, 0.0f))) {
            state.chat_messages.clear();
            state.chat_error_msg.clear();
        }
        ImGui::SameLine();
        if (ImGui::Button("X", ImVec2(close_w, 0.0f))) {
            state.chat_overlay_open = false;
        }
        ImGui::EndDisabled();
        state.chat_resize_just_finished = false;

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        const float composer_height = 124.0f;
        const float history_height = std::max(60.0f, ImGui::GetContentRegionAvail().y - composer_height);

        if (ImGui::BeginChild("##chat_messages", ImVec2(0.0f, history_height), false)) {
            if (state.chat_messages.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.58f, 0.58f, 0.58f, 1.0f));
                ImGui::TextWrapped("Ask for a summary of this path, explain a selected file, or ask about files currently shown here. Misty only sends the current path context with each prompt.");
                ImGui::PopStyleColor();
            } else {
                for (size_t i = 0; i < state.chat_messages.size(); ++i) {
                    const auto& message = state.chat_messages[i];
                    if (message.role == "assistant") {
                        render_message_bubble(static_cast<int>(i), "Misty", message.content,
                                              ImVec4(0.13f, 0.13f, 0.13f, 1.0f),
                                              ImVec4(0.93f, 0.93f, 0.93f, 1.0f));
                    } else {
                        render_message_bubble(static_cast<int>(i), "You", message.content,
                                              ImVec4(0.20f, 0.20f, 0.20f, 1.0f),
                                              ImVec4(0.95f, 0.95f, 0.95f, 1.0f));
                    }
                    ImGui::Spacing();
                }
            }

            if (state.chat_request_in_flight) {
                const float t = static_cast<float>(ImGui::GetTime());
                const char* frames[] = {"thinking.", "thinking..", "thinking..."};
                render_message_bubble(-1, "Misty", frames[static_cast<int>(t * 2.5f) % 3],
                                      ImVec4(0.13f, 0.13f, 0.13f, 1.0f),
                                      ImVec4(0.74f, 0.74f, 0.74f, 1.0f),
                                      false);
            }

            if (!state.chat_error_msg.empty()) {
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.44f, 0.44f, 1.0f));
                ImGui::TextWrapped("%s", state.chat_error_msg.c_str());
                ImGui::PopStyleColor();
            }

        }
        ImGui::EndChild();

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        if (state.chat_focus_input) {
            ImGui::SetKeyboardFocusHere();
            state.chat_focus_input = false;
        }

        ImGui::SetNextItemWidth(-90.0f);
        ImGui::InputTextMultiline("##chat_input", state.chat_input_buffer, IM_ARRAYSIZE(state.chat_input_buffer),
                                  ImVec2(0.0f, 78.0f));

        bool send = false;
        if (ImGui::IsItemActive() &&
            ImGui::IsKeyPressed(ImGuiKey_Enter, false) &&
            !ImGui::GetIO().KeyShift) {
            std::string trimmed = trim_copy(state.chat_input_buffer);
            while (!trimmed.empty() && trimmed.back() == '\n') {
                trimmed.pop_back();
            }
            std::snprintf(state.chat_input_buffer, sizeof(state.chat_input_buffer), "%s", trimmed.c_str());
            send = true;
        }

        ImGui::SameLine();
        ImGui::BeginDisabled(state.chat_request_in_flight);
        if (ImGui::Button("Send", ImVec2(76.0f, 78.0f))) {
            send = true;
        }
        ImGui::EndDisabled();

        if (send) {
            submit_chat_message(state);
        }
    }
    ImGui::EndChild();

    ImGui::PopStyleColor(3);
    ImGui::PopStyleVar(3);
}

} // namespace misty::panel

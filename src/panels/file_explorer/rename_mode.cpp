#include "panels/file_explorer/file_explorer_panel.h"

#include <algorithm>
#include <filesystem>
#include <memory>
#include <string>
#include <tuple>
#include <unordered_set>
#include <utility>
#include <vector>

#include "core/file_transfer/file_transfer.h"
#include "imgui.h"
#include "panels/file_explorer/content/directory_content_util.h"
#include "panels/file_explorer/content/file_explorer_content_util.h"
#include "panels/file_explorer/operations/file_master_operations.h"
#include "panels/file_explorer/operations/file_operation_jobs.h"
#include "panels/file_explorer/operations/operation_queue_state.h"

#include <cfloat>

namespace fs = std::filesystem;

namespace misty::panel {
namespace {

struct RenameExecutionItem {
    std::string owner_key;
    std::string directory_path;
    FileItem item;
    std::string new_name;
};

std::unordered_set<std::string> sibling_names_for_item(const FileListing& listing, const FileItem& item) {
    std::unordered_set<std::string> siblings;
    siblings.reserve(listing.files.size());
    for (const auto& candidate : listing.files) {
        if (candidate.path == item.path) {
            continue;
        }
        siblings.insert(candidate.name);
    }
    return siblings;
}

FileItem renamed_item_snapshot(const RenameParticipant& participant, const std::string& new_name) {
    FileItem item = participant.item;
    item.name = new_name;
    item.path = renamed_path_for_item(participant, new_name);
    item.id = item.path;
    if (!item.sync_remote_path.empty()) {
        item.sync_remote_path = (fs::path(item.sync_remote_path).parent_path() / new_name).generic_string();
    }
    return item;
}

void replace_selected_id(FileExplorerState& state,
                         const std::string& old_id,
                         const std::string& new_id) {
    if (old_id.empty() || new_id.empty()) {
        return;
    }
    if (state.selected_files.erase(old_id) > 0) {
        state.selected_files.insert(new_id);
    }
}

void apply_successful_rename_to_loaded_state(core::StateRegistry& registry,
                                             const RenameParticipant& participant,
                                             const std::string& new_name) {
    auto& listings_state = registry.get_state<FileListingsState>(kFileListingsStateKey);
    if (FileListing* listing = listings_state.find(participant.owner_key)) {
        const FileItem new_item = renamed_item_snapshot(participant, new_name);
        bool changed = false;
        for (auto& candidate : listing->files) {
            if (candidate.path == participant.original_path || candidate.id == participant.item_id) {
                candidate = new_item;
                changed = true;
                break;
            }
        }
        if (changed) {
            listing->note_listing_changed();
        }
    }

    if (registry.has_state(participant.owner_key)) {
        auto& owner_state = registry.get_state<FileExplorerState>(participant.owner_key);
        std::lock_guard<std::recursive_mutex> lock(owner_state.mu);
        replace_selected_id(owner_state, participant.item_id, renamed_path_for_item(participant, new_name));
    }

    registry.get_state<LibraryState>(kLibraryStateKey).track_move(
        participant.original_path,
        renamed_item_snapshot(participant, new_name));
}

std::vector<std::string> ordered_session_keys(const RenameSessionState& session) {
    std::vector<std::string> keys;
    keys.reserve(session.participant_order.size());
    for (const auto& key : session.participant_order) {
        if (session.participants.find(key) != session.participants.end()) {
            keys.push_back(key);
        }
    }
    return keys;
}

std::string shared_inline_editable_name(const RenameSessionState& session) {
    for (const auto& key : session.participant_order) {
        const auto it = session.participants.find(key);
        if (it != session.participants.end()) {
            return it->second.editable_name;
        }
    }
    return {};
}

}  // namespace

RenameSessionState& FileExplorerPanel::rename_session_state() {
    return registry_.get_state<RenameSessionState>(kRenameSessionStateKey);
}

bool FileExplorerPanel::rename_mode_active() const {
    return const_cast<core::StateRegistry&>(registry_).get_state<RenameSessionState>(kRenameSessionStateKey).active;
}

bool FileExplorerPanel::rename_participant_snapshot_for_file(const FileExplorerState& state,
                                                             const FileItem& file,
                                                             RenameParticipant* out) const {
    auto& session = const_cast<core::StateRegistry&>(registry_).get_state<RenameSessionState>(kRenameSessionStateKey);
    std::lock_guard<std::mutex> lock(session.mu);
    if (!session.active || session.review_modal_open) {
        return false;
    }
    const auto it = session.participants.find(rename_participant_key(state_key_, file.path));
    if (it == session.participants.end()) {
        return false;
    }
    if (it->second.directory_path != state.current_path) {
        return false;
    }
    if (out) {
        *out = it->second;
    }
    return true;
}

void FileExplorerPanel::update_rename_participant_draft(const std::string& participant_key,
                                                        const std::string& draft_name,
                                                        bool propagate_to_all) {
    auto& session = rename_session_state();
    std::lock_guard<std::mutex> lock(session.mu);
    apply_rename_participant_draft(session, participant_key, draft_name, propagate_to_all);
}

void FileExplorerPanel::sync_rename_session_selection(FileExplorerState& state,
                                                      const FileListing& listing,
                                                      bool clear_visible_directory) {
    auto& session = rename_session_state();
    std::lock_guard<std::mutex> lock(session.mu);
    if (!session.active) {
        return;
    }

    const std::string directory_path(state.current_path);
    std::unordered_set<std::string> selected_keys;
    for (const auto& file : listing.files) {
        if (!is_file_master_item(file) || ui_.selected_files.count(file.id) == 0) {
            continue;
        }
        selected_keys.insert(rename_participant_key(state_key_, file.path));
        const std::string key = rename_participant_key(state_key_, file.path);
        if (session.participants.find(key) == session.participants.end()) {
            RenameParticipant participant = make_rename_participant(
                state_key_,
                directory_path,
                file,
                sibling_names_for_item(listing, file),
                session.next_added_order++);
            if (!session.participants.empty()) {
                participant.editable_name = shared_inline_editable_name(session);
            }
            session.participant_order.push_back(participant.key);
            session.participants.emplace(participant.key, std::move(participant));
            session.focus_requested = true;
            session.focus_key = key;
        }
    }

    std::vector<std::string> remove_keys;
    if (clear_visible_directory) {
        for (const auto& [key, participant] : session.participants) {
            if (participant.owner_key == state_key_ && participant.directory_path == directory_path) {
                remove_keys.push_back(key);
            }
        }
    } else {
        for (const auto& [key, participant] : session.participants) {
            if (participant.owner_key == state_key_ &&
                participant.directory_path == directory_path &&
                selected_keys.count(key) == 0) {
                remove_keys.push_back(key);
            }
        }
    }

    for (const auto& key : remove_keys) {
        session.participants.erase(key);
    }

    session.participant_order.erase(
        std::remove_if(session.participant_order.begin(),
                       session.participant_order.end(),
                       [&](const std::string& key) { return session.participants.find(key) == session.participants.end(); }),
        session.participant_order.end());

    update_rename_session_validation(session);
    if (session.participants.empty()) {
        session.clear();
    }
}

void FileExplorerPanel::cancel_rename_mode() {
    auto& session = rename_session_state();
    std::lock_guard<std::mutex> lock(session.mu);
    session.clear();
}

void FileExplorerPanel::initiate_rename(TransientUiState& ui) {
    (void)ui;

    auto& session = rename_session_state();
    {
        std::lock_guard<std::mutex> lock(session.mu);
        if (!session.active) {
            session.clear();
            session.active = true;
        }
    }

    std::vector<std::tuple<std::string, std::string, FileItem, std::unordered_set<std::string>>> initial_items;
    auto& listings_state = file_listings_state();
    std::lock_guard<std::mutex> listings_lock(listings_state.mu);
    for (const auto& [owner_key, listing_ptr] : listings_state.listings) {
        if (!listing_ptr || !registry_.has_state(owner_key)) {
            continue;
        }

        auto& owner_state = registry_.get_state<FileExplorerState>(owner_key);
        std::lock_guard<std::recursive_mutex> state_lock(owner_state.mu);
        const std::string directory_path(owner_state.current_path);
        for (const auto& file : listing_ptr->files) {
            if (owner_state.selected_files.count(file.id) == 0 || !is_file_master_item(file)) {
                continue;
            }
            initial_items.emplace_back(
                owner_key,
                directory_path,
                file,
                sibling_names_for_item(*listing_ptr, file));
        }
    }

    {
        std::lock_guard<std::mutex> lock(session.mu);
        for (const auto& [owner_key, directory_path, file, sibling_names] : initial_items) {
            const std::string key = rename_participant_key(owner_key, file.path);
            if (session.participants.find(key) != session.participants.end()) {
                continue;
            }
            RenameParticipant participant = make_rename_participant(
                owner_key,
                directory_path,
                file,
                sibling_names,
                session.next_added_order++);
            if (!session.participants.empty()) {
                participant.editable_name = shared_inline_editable_name(session);
            }
            session.participant_order.push_back(participant.key);
            session.participants.emplace(participant.key, std::move(participant));
            session.focus_requested = true;
            session.focus_key = key;
        }
        update_rename_session_validation(session);
        if (session.participants.empty()) {
            session.clear();
        }
    }
}

void FileExplorerPanel::open_rename_review_modal() {
    auto& session = rename_session_state();
    std::lock_guard<std::mutex> lock(session.mu);
    if (!session.active || session.participants.empty()) {
        return;
    }
    session.review_modal_open = true;
}

void FileExplorerPanel::show_rename_review_modal() {
    if (const auto* active_explorer = dynamic_cast<const FileExplorerPanel*>(active_panel())) {
        if (active_explorer != this) {
            return;
        }
    }

    auto& session = rename_session_state();
    {
        std::lock_guard<std::mutex> lock(session.mu);
        if (!session.review_modal_open) {
            return;
        }
    }

    if (ImGui::IsPopupOpen("##rename_review_modal")) {
        ImGui::GetIO().WantCaptureMouse = true;
        ImGui::GetIO().WantCaptureKeyboard = true;
    }

    ImGui::OpenPopup("##rename_review_modal");
    ImGui::SetNextWindowSize(ImVec2(720.0f, 0.0f), ImGuiCond_Appearing);
    if (ImGuiViewport* main_viewport = ImGui::GetMainViewport()) {
        ImGui::SetNextWindowViewport(main_viewport->ID);
    }
    ImGui::SetNextWindowFocus();
    bool modal_open = true;
    if (ImGui::BeginPopupModal("##rename_review_modal",
                               &modal_open,
                               ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoMove)) {
        std::vector<std::string> ordered_keys;
        RenameSessionSummary summary;
        {
            std::lock_guard<std::mutex> lock(session.mu);
            ordered_keys = ordered_session_keys(session);
            summary = summarize_rename_session(session);
        }

        ImGui::TextUnformatted("Review Renames");
        ImGui::Dummy(ImVec2(0.0f, 6.0f));
        ImGui::TextDisabled("%zu ready, %zu unchanged, %zu need fixes",
                            summary.ready,
                            summary.unchanged,
                            summary.invalid);
        ImGui::Dummy(ImVec2(0.0f, 10.0f));

        const ImGuiTableFlags table_flags =
            ImGuiTableFlags_RowBg |
            ImGuiTableFlags_BordersInnerH |
            ImGuiTableFlags_BordersOuter |
            ImGuiTableFlags_ScrollY |
            ImGuiTableFlags_SizingStretchProp;
        if (ImGui::BeginTable("##rename_review_table", 2, table_flags, ImVec2(680.0f, 320.0f))) {
            ImGui::TableSetupColumn("Before", ImGuiTableColumnFlags_WidthStretch, 0.45f);
            ImGui::TableSetupColumn("After", ImGuiTableColumnFlags_WidthStretch, 0.55f);
            ImGui::TableHeadersRow();

            for (const auto& key : ordered_keys) {
                RenameParticipant participant;
                {
                    std::lock_guard<std::mutex> lock(session.mu);
                    const auto it = session.participants.find(key);
                    if (it == session.participants.end()) {
                        continue;
                    }
                    participant = it->second;
                }

                ImGui::TableNextRow();
                ImGui::TableSetColumnIndex(0);
                if (participant.validation.is_invalid()) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.86f, 0.33f, 0.33f, 1.0f));
                }
                ImGui::TextUnformatted(participant.original_name.c_str());
                if (participant.validation.is_invalid()) {
                    ImGui::PopStyleColor();
                }

                ImGui::TableSetColumnIndex(1);
                std::string editable_name = participant.editable_name;
                const float extension_width = participant.locked_extension.empty()
                    ? 0.0f
                    : ImGui::CalcTextSize(participant.locked_extension.c_str()).x + 8.0f;
                if (participant.validation.is_invalid()) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.92f, 0.42f, 0.42f, 1.0f));
                }
                const bool changed = input_text_string(
                    ("##rename_review_after_" + key).c_str(),
                    editable_name,
                    ImGuiInputTextFlags_None,
                    nullptr,
                    std::max(60.0f, ImGui::GetContentRegionAvail().x - extension_width));
                if (participant.validation.is_invalid()) {
                    ImGui::PopStyleColor();
                }
                if (!participant.locked_extension.empty()) {
                    ImGui::SameLine(0.0f, 6.0f);
                    ImGui::TextDisabled("%s", participant.locked_extension.c_str());
                }
                if (changed || editable_name != participant.editable_name) {
                    update_rename_participant_draft(key, editable_name, false);
                }
                if (participant.validation.is_invalid()) {
                    ImGui::TextDisabled("%s", participant.validation.message.c_str());
                }
            }
            ImGui::EndTable();
        }

        ImGui::Dummy(ImVec2(0.0f, 10.0f));
        if (ImGui::Button("Cancel", ImVec2(100.0f, 0.0f))) {
            std::lock_guard<std::mutex> lock(session.mu);
            session.review_modal_open = false;
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        if (ImGui::Button("Confirm", ImVec2(100.0f, 0.0f))) {
            confirm_rename_review();
            ImGui::CloseCurrentPopup();
        }

        ImGui::EndPopup();
    }

    if (!modal_open) {
        std::lock_guard<std::mutex> lock(session.mu);
        session.review_modal_open = false;
    }
}

void FileExplorerPanel::confirm_rename_review() {
    auto& session = rename_session_state();
    std::vector<RenameExecutionItem> queue_items;
    {
        std::lock_guard<std::mutex> lock(session.mu);
        if (!session.active) {
            return;
        }
        update_rename_session_validation(session);
        for (const auto& [key, participant] : session.participants) {
            if (!participant.validation.is_ready()) {
                continue;
            }
            queue_items.push_back(RenameExecutionItem{
                .owner_key = participant.owner_key,
                .directory_path = participant.directory_path,
                .item = participant.item,
                .new_name = rename_effective_name(participant),
            });
        }
    }

    std::sort(queue_items.begin(), queue_items.end(), [](const RenameExecutionItem& lhs, const RenameExecutionItem& rhs) {
        if (lhs.owner_key != rhs.owner_key) {
            return lhs.owner_key < rhs.owner_key;
        }
        if (lhs.directory_path != rhs.directory_path) {
            return lhs.directory_path < rhs.directory_path;
        }
        return lhs.item.path < rhs.item.path;
    });

    std::vector<RenameExecutionRequest> requests;
    {
        std::lock_guard<std::mutex> lock(session.mu);
        session.clear();
        if (!queue_items.empty()) {
            session.job_banner_active = true;
            session.job_banner_item_count = queue_items.size();
            session.job_banner_job_id = 0;
            session.job_banner_text = "Rename job: starting " +
                std::to_string(queue_items.size()) +
                (queue_items.size() == 1 ? " item" : " items");
        }
    }

    if (queue_items.empty()) {
        return;
    }
    requests.reserve(queue_items.size());
    for (const auto& item : queue_items) {
        requests.push_back(RenameExecutionRequest{
            .owner_state_key = item.owner_key,
            .directory_path = item.directory_path,
            .item = item.item,
            .new_name = item.new_name,
        });
    }

    const uint64_t batch_id = enqueue_rename_operation_batch(
        registry_,
        worker_pool_,
        requests,
        [this](const core::FileMasterResult& result) {
            if (!result.success) {
                return;
            }
            auto& session = rename_session_state();
            std::lock_guard<std::mutex> lock(session.mu);
            if (session.job_banner_active) {
                session.job_banner_active = false;
                session.job_banner_item_count = 0;
                session.job_banner_job_id = 0;
                session.job_banner_text.clear();
            }
        });
    {
        auto& session = rename_session_state();
        std::lock_guard<std::mutex> lock(session.mu);
        session.job_banner_job_id = batch_id;
    }
}

void FileExplorerPanel::render_rename_status_banner(float available_width) {
    auto& session = rename_session_state();
    RenameSessionSummary summary;
    bool show_job_banner = false;
    std::string text;
    {
        std::lock_guard<std::mutex> lock(session.mu);
        if (session.active) {
            summary = summarize_rename_session(session);
        } else if (session.job_banner_active) {
            show_job_banner = true;
            text = session.job_banner_text;
        } else {
            return;
        }
    }

    if (!show_job_banner) {
        text = summary.invalid == 0
            ? "Rename mode: Press Enter to review " + std::to_string(summary.ready) + " items"
            : "Rename mode: " + std::to_string(summary.ready) + " ready, " +
                std::to_string(summary.unchanged) + " unchanged, " +
                std::to_string(summary.invalid) + " need fixes";
    }

    const ImVec2 text_size = ImGui::CalcTextSize(text.c_str());
    const float banner_width = std::min(std::max(available_width, 220.0f), text_size.x + 24.0f);
    const ImVec2 pos = ImGui::GetCursorScreenPos();
    const ImVec2 size(banner_width, 30.0f);
    ImGui::InvisibleButton("##rename_status_banner", size);
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    const ImU32 bg = show_job_banner
        ? IM_COL32(38, 79, 118, 220)
        : (summary.invalid == 0
            ? IM_COL32(42, 97, 77, 220)
            : IM_COL32(112, 66, 32, 220));
    ImGui::GetWindowDrawList()->AddRectFilled(min, max, bg, 8.0f);
    ImGui::GetWindowDrawList()->AddText(
        ImVec2(min.x + 12.0f, min.y + (size.y - ImGui::GetTextLineHeight()) * 0.5f),
        IM_COL32(244, 241, 235, 255),
        text.c_str());
    (void)pos;
}

}  // namespace misty::panel

#include "panels/file_explorer/state/rename_session_state.h"

#include <algorithm>
#include <filesystem>
#include <unordered_map>

namespace fs = std::filesystem;

namespace misty::panel {
namespace {

bool has_invalid_separator(const std::string& name) {
    return name.find('/') != std::string::npos || name.find('\\') != std::string::npos;
}

std::pair<std::string, std::string> split_rename_parts(const FileItem& item) {
    if (item.is_dir) {
        return {item.name, {}};
    }

    const std::size_t dot = item.name.rfind('.');
    if (dot == std::string::npos || dot == 0) {
        return {item.name, {}};
    }
    return {item.name.substr(0, dot), item.name.substr(dot)};
}

}  // namespace

void RenameSessionState::clear() {
    active = false;
    review_modal_open = false;
    focus_requested = false;
    job_banner_active = false;
    shared_cursor_pos = 0;
    shared_cursor_anim = 0.0f;
    job_banner_item_count = 0;
    job_banner_job_id = 0;
    focus_key.clear();
    job_banner_text.clear();
    participants.clear();
    participant_order.clear();
}

std::string rename_participant_key(const std::string& owner_key, const std::string& path) {
    return owner_key + "||" + path;
}

std::string rename_effective_name(const RenameParticipant& participant) {
    return participant.editable_name + participant.locked_extension;
}

std::string renamed_path_for_item(const RenameParticipant& participant, const std::string& new_name) {
    if (participant.original_path.empty()) {
        return {};
    }
    return (fs::path(participant.original_path).parent_path() / new_name).generic_string();
}

RenameParticipant make_rename_participant(const std::string& owner_key,
                                          const std::string& directory_path,
                                          const FileItem& item,
                                          const std::unordered_set<std::string>& sibling_names,
                                          std::uint64_t added_order) {
    RenameParticipant participant;
    participant.key = rename_participant_key(owner_key, item.path);
    participant.owner_key = owner_key;
    participant.directory_path = directory_path;
    participant.item_id = item.id;
    participant.item = item;
    participant.original_name = item.name;
    participant.original_path = item.path;
    auto [editable_name, locked_extension] = split_rename_parts(item);
    participant.editable_name = std::move(editable_name);
    participant.locked_extension = std::move(locked_extension);
    participant.sibling_names = sibling_names;
    participant.added_order = added_order;
    return participant;
}

void apply_rename_participant_draft(RenameSessionState& session,
                                    const std::string& participant_key,
                                    const std::string& draft_name,
                                    bool propagate_to_all) {
    auto it = session.participants.find(participant_key);
    if (it == session.participants.end()) {
        return;
    }

    if (propagate_to_all) {
        for (auto& [_, participant] : session.participants) {
            participant.editable_name = draft_name;
            participant.execution_error.clear();
        }
    } else {
        it->second.editable_name = draft_name;
        it->second.execution_error.clear();
    }

    session.shared_cursor_pos = std::clamp(session.shared_cursor_pos,
                                           0,
                                           static_cast<int>(draft_name.size()));

    update_rename_session_validation(session);
}

void update_rename_session_validation(RenameSessionState& session) {
    std::unordered_map<std::string, std::vector<std::string>> target_to_keys;
    target_to_keys.reserve(session.participants.size());

    for (const auto& [key, participant] : session.participants) {
        const std::string draft = rename_effective_name(participant);
        if (draft.empty() || has_invalid_separator(draft)) {
            continue;
        }
        if (draft == participant.original_name) {
            continue;
        }
        const std::string target_path = renamed_path_for_item(participant, draft);
        if (!target_path.empty()) {
            target_to_keys[target_path].push_back(key);
        }
    }

    for (auto& [key, participant] : session.participants) {
        participant.validation = {};

        if (!participant.execution_error.empty()) {
            participant.validation.code = RenameValidationCode::BackendFailure;
            participant.validation.message = participant.execution_error;
            continue;
        }

        if (participant.editable_name.empty()) {
            participant.validation.code = RenameValidationCode::EmptyName;
            participant.validation.message = "Name cannot be empty.";
            continue;
        }

        if (has_invalid_separator(participant.editable_name)) {
            participant.validation.code = RenameValidationCode::InvalidCharacter;
            participant.validation.message = "Name cannot contain path separators.";
            continue;
        }

        const std::string effective_name = rename_effective_name(participant);
        if (effective_name == participant.original_name) {
            participant.validation.code = RenameValidationCode::Unchanged;
            participant.validation.message = "Unchanged.";
            continue;
        }

        const std::string target_path = renamed_path_for_item(participant, effective_name);
        if (target_path.empty()) {
            participant.validation.code = RenameValidationCode::Unsupported;
            participant.validation.message = "Rename target is unavailable.";
            continue;
        }

        const auto target_it = target_to_keys.find(target_path);
        if (target_it != target_to_keys.end() && target_it->second.size() > 1) {
            participant.validation.code = RenameValidationCode::DuplicateSelectionTarget;
            participant.validation.message = "Conflicts with another selected item.";
            continue;
        }

        if (participant.sibling_names.count(effective_name) > 0) {
            participant.validation.code = RenameValidationCode::ExistingSiblingCollision;
            participant.validation.message = "Name already exists in this folder.";
            continue;
        }

        if (participant.item.path.empty()) {
            participant.validation.code = RenameValidationCode::Unsupported;
            participant.validation.message = "Rename is not supported for this item.";
            continue;
        }

        participant.validation.code = RenameValidationCode::Ready;
        participant.validation.message = "Ready.";
    }
}

RenameSessionSummary summarize_rename_session(const RenameSessionState& session) {
    RenameSessionSummary summary;
    summary.total = session.participants.size();
    for (const auto& [_, participant] : session.participants) {
        if (participant.validation.is_ready()) {
            ++summary.ready;
        } else if (participant.validation.is_unchanged()) {
            ++summary.unchanged;
        } else {
            ++summary.invalid;
        }
    }
    return summary;
}

}  // namespace misty::panel

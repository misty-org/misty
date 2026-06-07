#pragma once

#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "core/ui/state_registry.h"
#include "panels/file_explorer/state/file_listings_state.h"

namespace misty::panel {

inline constexpr const char* kRenameSessionStateKey = "Files_RenameSession";

enum class RenameValidationCode {
    Ready,
    Unchanged,
    EmptyName,
    InvalidCharacter,
    DuplicateSelectionTarget,
    ExistingSiblingCollision,
    Unsupported,
    BackendFailure,
};

struct RenameValidationResult {
    RenameValidationCode code = RenameValidationCode::Unchanged;
    std::string message;

    bool is_ready() const { return code == RenameValidationCode::Ready; }
    bool is_unchanged() const { return code == RenameValidationCode::Unchanged; }
    bool is_invalid() const { return !is_ready() && !is_unchanged(); }
};

struct RenameParticipant {
    std::string key;
    std::string owner_key;
    std::string directory_path;
    std::string item_id;
    FileItem item;
    std::string original_name;
    std::string original_path;
    std::string editable_name;
    std::string locked_extension;
    std::unordered_set<std::string> sibling_names;
    RenameValidationResult validation;
    std::string execution_error;
    std::uint64_t added_order = 0;
};

struct RenameSessionSummary {
    std::size_t total = 0;
    std::size_t ready = 0;
    std::size_t unchanged = 0;
    std::size_t invalid = 0;
};

struct RenameSessionState : public core::StateEntry {
    bool active = false;
    bool review_modal_open = false;
    bool focus_requested = false;
    int shared_cursor_pos = 0;
    float shared_cursor_anim = 0.0f;
    std::string focus_key;
    std::unordered_map<std::string, RenameParticipant> participants;
    std::vector<std::string> participant_order;
    std::uint64_t next_added_order = 1;
    mutable std::mutex mu;

    void clear();
};

std::string rename_participant_key(const std::string& owner_key, const std::string& path);
std::string rename_effective_name(const RenameParticipant& participant);
std::string renamed_path_for_item(const RenameParticipant& participant, const std::string& new_name);
RenameParticipant make_rename_participant(const std::string& owner_key,
                                          const std::string& directory_path,
                                          const FileItem& item,
                                          const std::unordered_set<std::string>& sibling_names,
                                          std::uint64_t added_order);
void apply_rename_participant_draft(RenameSessionState& session,
                                    const std::string& participant_key,
                                    const std::string& draft_name,
                                    bool propagate_to_all);
void update_rename_session_validation(RenameSessionState& session);
RenameSessionSummary summarize_rename_session(const RenameSessionState& session);

}  // namespace misty::panel

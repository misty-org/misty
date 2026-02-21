#pragma once

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "core/ui/ui_registry.h"

namespace misty::panel {

enum class FileOperationKind {
    CopyLocal,
    MoveLocal,
    RenameLocal,
    TrashLocal,
    PermanentDeleteLocal,
    RemoteDelete,
    UploadToRemote,
    DownloadFromRemote,
    Custom,
};

inline const char* file_operation_kind_label(FileOperationKind kind) {
    switch (kind) {
        case FileOperationKind::CopyLocal: return "copy";
        case FileOperationKind::MoveLocal: return "move";
        case FileOperationKind::RenameLocal: return "rename";
        case FileOperationKind::TrashLocal: return "move to trash";
        case FileOperationKind::PermanentDeleteLocal: return "permanent delete";
        case FileOperationKind::RemoteDelete: return "remote delete";
        case FileOperationKind::UploadToRemote: return "upload";
        case FileOperationKind::DownloadFromRemote: return "download";
        case FileOperationKind::Custom: return "custom operation";
    }
    return "operation";
}

struct FileOperationItem {
    std::string source_path;
    std::string destination_path;
    std::string display_name;
    bool is_dir = false;
};

struct FileOperationRecord {
    FileOperationKind kind = FileOperationKind::Custom;
    std::vector<FileOperationItem> items;
    std::string origin_dir;
    std::string destination_dir;
    std::string description;
};

struct FileOperationJournalState : public core::UIState {
    std::vector<FileOperationRecord> undo_stack;
    std::vector<FileOperationRecord> redo_stack;
    std::size_t max_entries = 100;

    bool can_undo() const {
        return !undo_stack.empty();
    }

    bool can_redo() const {
        return !redo_stack.empty();
    }

    const FileOperationRecord* peek_undo() const {
        return undo_stack.empty() ? nullptr : &undo_stack.back();
    }

    const FileOperationRecord* peek_redo() const {
        return redo_stack.empty() ? nullptr : &redo_stack.back();
    }

    void push(FileOperationRecord record) {
        if (record.items.empty()) {
            return;
        }
        if (record.description.empty()) {
            record.description = file_operation_kind_label(record.kind);
        }
        undo_stack.push_back(std::move(record));
        redo_stack.clear();
        trim_to_limit(undo_stack);
    }

    bool take_undo(FileOperationRecord& out) {
        if (undo_stack.empty()) {
            return false;
        }
        out = std::move(undo_stack.back());
        undo_stack.pop_back();
        return true;
    }

    bool take_redo(FileOperationRecord& out) {
        if (redo_stack.empty()) {
            return false;
        }
        out = std::move(redo_stack.back());
        redo_stack.pop_back();
        return true;
    }

    void complete_undo(FileOperationRecord record) {
        redo_stack.push_back(std::move(record));
        trim_to_limit(redo_stack);
    }

    void complete_redo(FileOperationRecord record) {
        undo_stack.push_back(std::move(record));
        trim_to_limit(undo_stack);
    }

private:
    void trim_to_limit(std::vector<FileOperationRecord>& stack) const {
        if (max_entries == 0) {
            stack.clear();
            return;
        }
        if (stack.size() > max_entries) {
            stack.erase(stack.begin(), stack.begin() + static_cast<std::ptrdiff_t>(stack.size() - max_entries));
        }
    }
};

} // namespace misty::panel

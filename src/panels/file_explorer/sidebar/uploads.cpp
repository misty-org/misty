#include "file_sidebar_panel.h"

#include "panels/providers/remote/remote_state.h"

namespace misty::panel {

    void FileSidebarPanel::show_uploader_modal(FileSidebarState& state) {
        if (!state.show_uploader_modal) return;

        auto& remote_state = registry_.get_state<RemoteState>("Remote");
        state.show_uploader_modal = false;

        if (!remote_state.has_upload_context()) {
            state.status_message = "Navigate to a cloud folder first.";
            return;
        }

        state.status_message = "Remote uploads are handled outside the file sidebar.";
    }

}

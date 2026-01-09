

#include "layer.h"

#include "registry.h"
#include "worker_pool.h"
#include "minidfs_client.h"
#include "imgui.h"
#include "tool_menu_state.h"
#include "file_explorer_state.h"

namespace minidfs {

    class ToolMenuPanel : public Layer {
    public:
        ToolMenuPanel(UIRegistry& registry, WorkerPool& worker_pool, std::shared_ptr<MiniDFSClient> client);
        void render();

    private:
        void show_main_navigation(ToolMenuState& state, float width, float padding);
        void show_quick_access(float width, float padding);
        void show_modals(ToolMenuState& state);
        void show_storage_info(float width, float padding);

        UIRegistry& registry_;
        WorkerPool& worker_pool_;
        std::shared_ptr<MiniDFSClient> client_;
    };

}


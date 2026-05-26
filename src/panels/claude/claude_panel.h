#pragma once

#include <string>

#include "core/threading/worker_pool.h"
#include "core/ui/state_registry.h"
#include "panels/panel/panel.h"

namespace misty::panel {

class ClaudePanel : public Panel {
public:
    ClaudePanel(core::StateRegistry& registry, core::WorkerPool& worker_pool);
    ~ClaudePanel() override = default;

    void render() override;
    void toggle();
    bool is_open() const;
    void set_working_dir(const std::string& working_dir);

private:
    core::StateRegistry& registry_;
    core::WorkerPool& worker_pool_;
    bool is_open_ = false;
    std::string working_dir_;
};

}  // namespace misty::panel

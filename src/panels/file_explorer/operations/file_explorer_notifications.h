#pragma once

#include <string>

#include "core/ui/state_registry.h"

namespace misty::panel {

void notify_download_started(core::StateRegistry& registry,
                             const std::string& file_name);

void notify_download_finished(core::StateRegistry& registry,
                              const std::string& file_name);

void notify_download_failed(core::StateRegistry& registry,
                            const std::string& file_name,
                            const std::string& error_message);

void notify_file_operation_started(core::StateRegistry& registry,
                                   const std::string& operation_name,
                                   const std::string& file_name);

void notify_clipboard_operation_invoked(core::StateRegistry& registry,
                                        const std::string& operation_name,
                                        std::size_t item_count);

void notify_file_operation_finished(core::StateRegistry& registry,
                                    const std::string& operation_name,
                                    const std::string& file_name);

void notify_file_operation_failed(core::StateRegistry& registry,
                                  const std::string& operation_name,
                                  const std::string& file_name,
                                  const std::string& error_message);

void notify_sync_object_needs_folder(core::StateRegistry& registry);

void notify_sync_object_already_running(core::StateRegistry& registry);

void notify_sync_object_failed(core::StateRegistry& registry);

void notify_sync_object_created(core::StateRegistry& registry,
                                const std::string& root);

}  // namespace misty::panel

#pragma once

#include <cstdlib>
#include <string>
#include <vector>

#include "core/ui/state_registry.h"

namespace misty::panel {

/**
 * @brief Represents a remote mount dir, mapping a provider type to its virtual mount dir.
 *
 */
struct RemoteMountParent {
    std::string remote_type;
    std::string remote_name;
    std::string remote_path;
};


/**
 * @brief Mapping from a provider account to its virtual mount dir.
 */
struct RemoteMountChild {
    RemoteMountParent parent;
    std::string child_path;
    std::string child_name;
};

    /**
     * @brief Returns the root directory used for virtual remote mounts.
     */
    std::string get_mount_root();

    /**
     * @brief Ensures the provider-level mount directory exists.
     */
    void ensure_parent_directory(const RemoteMountParent& parent);

    /**
     * @brief Ensures the account-level mount directory exists.
     */
    void ensure_child_directory(const RemoteMountChild& child);


    /**
    * @brief UI state tracking remote mount mappings visible to the explorer.
    */
    struct RemoteMountState : public core::StateEntry {
        std::vector<RemoteMountParent> parents;

        /**
        * @brief Ensures the mount root exists on disk.
        */
        void ensure_mount_root() const;
    };


} //namespace misty::panel

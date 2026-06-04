#include "core/file_master/file_master.h"

namespace misty::core {

bool FileMasterLocalContext::empty() const {
    return path.empty();
}

bool FileMasterRemoteContext::empty() const {
    return remote_name.empty() && provider_type.empty() && remote_path.empty();
}

}  // namespace misty::core

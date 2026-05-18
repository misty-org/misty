#pragma once

#include "core/net/http_client.h"
#include "file_master.h"

namespace misty::core {

HttpResponse list_remote_call(const FileMasterProps& props);

} // namespace misty::core

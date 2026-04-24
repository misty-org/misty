#if !defined(__APPLE__) && !defined(__linux__)

#include "core/sync/fs_watcher.h"

namespace misty::core::sync {

struct FsWatcher::Impl {};

FsWatcher::FsWatcher() : impl_(std::make_unique<Impl>()) {}
FsWatcher::~FsWatcher() = default;

bool FsWatcher::start(const std::string&, FsEventCallback, int) { return false; }
void FsWatcher::stop() {}
bool FsWatcher::is_running() const { return false; }
void FsWatcher::suppress(const std::string&) {}
void FsWatcher::unsuppress(const std::string&) {}

} // namespace misty::core::sync

#endif

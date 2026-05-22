#pragma once

#include <memory>
#include <mutex>

#include "core/file_sync/file_sync_store.h"

namespace misty::core {

class IFileSyncPolicy {
public:
    virtual ~IFileSyncPolicy() = default;
    virtual FileSyncResult result(const FileSyncContext& context) const = 0;
};

class RemoteFirstPolicy final : public IFileSyncPolicy {
public:
    FileSyncResult result(const FileSyncContext& context) const override;
};

class LocalFirstPolicy final : public IFileSyncPolicy {
public:
    FileSyncResult result(const FileSyncContext& context) const override;
};

class BiDirectionalPolicy final : public IFileSyncPolicy {
public:
    FileSyncResult result(const FileSyncContext& context) const override;
};

class FileSyncGate final {
public:
    explicit FileSyncGate(FileSyncPolicy mode = FileSyncPolicy::BiDirectional);
    ~FileSyncGate();

    FileSyncResult result(const FileSyncFinalEvent& event);
    void record(const FileSyncFinalEvent& event);
    void reset();

    FileSyncPolicy mode() const { return mode_; }
    FileSyncEntryStore& entries() { return entries_; }
    const FileSyncEntryStore& entries() const { return entries_; }

private:
    FileSyncContext context(const FileSyncFinalEvent& event);
    static std::unique_ptr<IFileSyncPolicy> policy(FileSyncPolicy mode);

    FileSyncPolicy mode_;
    std::unique_ptr<IFileSyncPolicy> policy_;
    FileSyncEntryStore entries_;
    mutable std::mutex mu_;
};

} // namespace misty::core

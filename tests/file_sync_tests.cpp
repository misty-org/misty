#include <gtest/gtest.h>

#include <string>

#include "core/file_sync/file_sync_gate.h"

namespace {

misty::core::FileSyncFinalEvent upload_event(const std::string& path, const std::string& checksum) {
    misty::core::FileSyncFinalEvent event;
    event.change = misty::core::FileSyncChange::LocalFile;
    event.pending_event.new_path = path;
    event.data.content_hash = checksum;
    return event;
}

void synced_baseline(misty::core::FileSyncGate& gate,
                     misty::core::FileSyncEntryId id,
                     const std::string& path,
                     const std::string& checksum) {
    misty::core::FileSyncLocalEntry local;
    local.entry_id = id;
    local.local_path = path;
    local.exists = true;
    local.checksum = checksum;
    gate.entries().local(local);

    misty::core::FileSyncRemoteEntry remote;
    remote.entry_id = id;
    remote.remote_name = "remote";
    remote.remote_path = path;
    remote.exists = true;
    remote.checksum = checksum;
    gate.entries().remote(remote);

    misty::core::FileSyncEntry sync;
    sync.entry_id = id;
    sync.state = misty::core::FileSyncEntryState::SYNC;
    sync.last_local_path = path;
    sync.last_local_checksum = checksum;
    sync.last_remote_path = path;
    sync.last_remote_checksum = checksum;
    gate.entries().sync(sync);
}

TEST(FileSyncGateTest, BiDirectionalLocalOnlyUploadsLocal) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::BiDirectional);

    const auto out = gate.result(upload_event("/tmp/local-only.txt", "local-1"));

    EXPECT_EQ(out.action, misty::core::FileSyncAction::UploadLocal);
    EXPECT_EQ(out.conflict, misty::core::FileSyncConflict::None);
}

TEST(FileSyncGateTest, BiDirectionalBothSidesChangedConflictsWithoutTimestampJudgement) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::BiDirectional);
    const misty::core::FileSyncEntryId id = "11111111-1111-4111-8111-111111111111";
    synced_baseline(gate, id, "/tmp/both-changed.txt", "base");

    misty::core::FileSyncRemoteEntry remote;
    remote.entry_id = id;
    remote.remote_name = "remote";
    remote.remote_path = "/tmp/both-changed.txt";
    remote.exists = true;
    remote.checksum = "remote-new";
    remote.last_modified = "2999-01-01T00:00:00Z";
    gate.entries().remote(remote);

    const auto out = gate.result(upload_event("/tmp/both-changed.txt", "local-new"));

    EXPECT_EQ(out.action, misty::core::FileSyncAction::Conflict);
    EXPECT_EQ(out.conflict, misty::core::FileSyncConflict::None);
}

TEST(FileSyncGateTest, LocalFirstKeepsLocalAndRequestsRemotePreview) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::LocalFirst);
    const misty::core::FileSyncEntryId id = "22222222-2222-4222-8222-222222222222";
    synced_baseline(gate, id, "/tmp/local-first.txt", "base");

    misty::core::FileSyncRemoteEntry remote;
    remote.entry_id = id;
    remote.remote_name = "remote";
    remote.remote_path = "/tmp/local-first.txt";
    remote.exists = true;
    remote.checksum = "remote-new";
    gate.entries().remote(remote);

    const auto out = gate.result(upload_event("/tmp/local-first.txt", "local-new"));

    EXPECT_EQ(out.action, misty::core::FileSyncAction::UploadLocal);
    EXPECT_EQ(out.conflict, misty::core::FileSyncConflict::RemoteTmp);
}

TEST(FileSyncGateTest, RemoteFirstKeepsRemoteAndRequestsLocalPreview) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::RemoteFirst);
    const misty::core::FileSyncEntryId id = "33333333-3333-4333-8333-333333333333";
    synced_baseline(gate, id, "/tmp/remote-first.txt", "base");

    misty::core::FileSyncRemoteEntry remote;
    remote.entry_id = id;
    remote.remote_name = "remote";
    remote.remote_path = "/tmp/remote-first.txt";
    remote.exists = true;
    remote.checksum = "remote-new";
    gate.entries().remote(remote);

    const auto out = gate.result(upload_event("/tmp/remote-first.txt", "local-new"));

    EXPECT_EQ(out.action, misty::core::FileSyncAction::DownloadRemote);
    EXPECT_EQ(out.conflict, misty::core::FileSyncConflict::LocalTmp);
}

TEST(FileSyncGateTest, RenameKeepsStableEntryId) {
    misty::core::FileSyncGate gate(misty::core::FileSyncPolicy::BiDirectional);
    const misty::core::FileSyncEntryId id = "77777777-7777-4777-8777-777777777777";
    synced_baseline(gate, id, "/tmp/before.txt", "base");

    misty::core::FileSyncFinalEvent event = upload_event("/tmp/after.txt", "after");
    event.change = misty::core::FileSyncChange::LocalRename;
    event.pending_event.old_path = "/tmp/before.txt";

    const auto out = gate.result(event);

    EXPECT_EQ(out.action, misty::core::FileSyncAction::RenameRemote);
    ASSERT_TRUE(gate.entries().local_id("/tmp/after.txt").has_value());
    EXPECT_EQ(*gate.entries().local_id("/tmp/after.txt"), id);
}

} // namespace

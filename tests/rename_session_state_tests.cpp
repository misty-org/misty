#include <gtest/gtest.h>

#include <unordered_set>

#include "panels/file_explorer/state/rename_session_state.h"

namespace {

misty::panel::FileItem make_item(const std::string& path, const std::string& name) {
    misty::panel::FileItem item;
    item.path = path;
    item.id = path;
    item.name = name;
    item.type = misty::panel::FileType::LOCAL;
    return item;
}

}  // namespace

TEST(RenameSessionStateTest, DetectsDuplicateTargetsWithinSelection) {
    misty::panel::RenameSessionState session;
    session.active = true;

    const auto first = misty::panel::make_rename_participant(
        "Files",
        "/tmp",
        make_item("/tmp/one.txt", "one.txt"),
        {},
        session.next_added_order++);
    auto second = misty::panel::make_rename_participant(
        "Files",
        "/tmp",
        make_item("/tmp/two.txt", "two.txt"),
        {},
        session.next_added_order++);
    second.editable_name = "one-renamed";

    auto renamed_first = first;
    renamed_first.editable_name = "one-renamed";

    session.participant_order = {renamed_first.key, second.key};
    session.participants.emplace(renamed_first.key, std::move(renamed_first));
    session.participants.emplace(second.key, std::move(second));

    misty::panel::update_rename_session_validation(session);

    EXPECT_EQ(session.participants.at(first.key).validation.code,
              misty::panel::RenameValidationCode::DuplicateSelectionTarget);
    EXPECT_EQ(session.participants.at(first.key).validation.message,
              "Conflicts with another selected item.");
    EXPECT_EQ(session.participants.at(session.participant_order[1]).validation.code,
              misty::panel::RenameValidationCode::DuplicateSelectionTarget);
}

TEST(RenameSessionStateTest, DetectsExistingSiblingCollision) {
    misty::panel::RenameSessionState session;
    session.active = true;

    auto participant = misty::panel::make_rename_participant(
        "Files",
        "/tmp",
        make_item("/tmp/report.txt", "report.txt"),
        std::unordered_set<std::string>{"archive.txt"},
        session.next_added_order++);
    participant.editable_name = "archive";

    session.participant_order = {participant.key};
    session.participants.emplace(participant.key, std::move(participant));

    misty::panel::update_rename_session_validation(session);

    EXPECT_EQ(session.participants.begin()->second.validation.code,
              misty::panel::RenameValidationCode::ExistingSiblingCollision);
}

TEST(RenameSessionStateTest, CountsReadyUnchangedAndInvalidItems) {
    misty::panel::RenameSessionState session;
    session.active = true;

    auto ready = misty::panel::make_rename_participant(
        "Files",
        "/tmp",
        make_item("/tmp/alpha.txt", "alpha.txt"),
        {},
        session.next_added_order++);
    ready.editable_name = "alpha-2";

    auto unchanged = misty::panel::make_rename_participant(
        "Files",
        "/tmp",
        make_item("/tmp/beta.txt", "beta.txt"),
        {},
        session.next_added_order++);

    auto invalid = misty::panel::make_rename_participant(
        "Files",
        "/tmp",
        make_item("/tmp/gamma.txt", "gamma.txt"),
        {},
        session.next_added_order++);
    invalid.editable_name = "";

    session.participant_order = {ready.key, unchanged.key, invalid.key};
    session.participants.emplace(ready.key, std::move(ready));
    session.participants.emplace(unchanged.key, std::move(unchanged));
    session.participants.emplace(invalid.key, std::move(invalid));

    misty::panel::update_rename_session_validation(session);
    const auto summary = misty::panel::summarize_rename_session(session);

    EXPECT_EQ(summary.total, 3u);
    EXPECT_EQ(summary.ready, 1u);
    EXPECT_EQ(summary.unchanged, 1u);
    EXPECT_EQ(summary.invalid, 1u);
}

TEST(RenameSessionStateTest, LocksFileExtensionDuringRename) {
    misty::panel::RenameSessionState session;
    session.active = true;

    auto participant = misty::panel::make_rename_participant(
        "Files",
        "/tmp",
        make_item("/tmp/report.txt", "report.txt"),
        {},
        session.next_added_order++);
    participant.editable_name = "summary";

    session.participant_order = {participant.key};
    session.participants.emplace(participant.key, std::move(participant));

    misty::panel::update_rename_session_validation(session);

    const auto& stored = session.participants.begin()->second;
    EXPECT_EQ(stored.locked_extension, ".txt");
    EXPECT_EQ(misty::panel::rename_effective_name(stored), "summary.txt");
    EXPECT_TRUE(stored.validation.is_ready());
}

TEST(RenameSessionStateTest, PropagatesInlineDraftAcrossParticipants) {
    misty::panel::RenameSessionState session;
    session.active = true;

    auto first = misty::panel::make_rename_participant(
        "FilesLeft",
        "/tmp/left",
        make_item("/tmp/left/alpha.txt", "alpha.txt"),
        {},
        session.next_added_order++);
    auto second = misty::panel::make_rename_participant(
        "FilesRight",
        "/tmp/right",
        make_item("/tmp/right/beta.txt", "beta.txt"),
        {},
        session.next_added_order++);

    session.participant_order = {first.key, second.key};
    session.participants.emplace(first.key, std::move(first));
    session.participants.emplace(second.key, std::move(second));

    misty::panel::apply_rename_participant_draft(session, session.participant_order.front(), "shared-name", true);

    EXPECT_EQ(session.participants.at(session.participant_order.front()).editable_name, "shared-name");
    EXPECT_EQ(session.participants.at(session.participant_order.back()).editable_name, "shared-name");
    EXPECT_TRUE(session.participants.at(session.participant_order.front()).validation.is_ready());
    EXPECT_TRUE(session.participants.at(session.participant_order.back()).validation.is_ready());
}

TEST(RenameSessionStateTest, KeepsReviewModalEditsScopedToOneParticipant) {
    misty::panel::RenameSessionState session;
    session.active = true;

    auto first = misty::panel::make_rename_participant(
        "FilesLeft",
        "/tmp/left",
        make_item("/tmp/left/alpha.txt", "alpha.txt"),
        {},
        session.next_added_order++);
    auto second = misty::panel::make_rename_participant(
        "FilesRight",
        "/tmp/right",
        make_item("/tmp/right/beta.txt", "beta.txt"),
        {},
        session.next_added_order++);

    session.participant_order = {first.key, second.key};
    session.participants.emplace(first.key, std::move(first));
    session.participants.emplace(second.key, std::move(second));

    misty::panel::apply_rename_participant_draft(session, session.participant_order.front(), "only-first", false);

    EXPECT_EQ(session.participants.at(session.participant_order.front()).editable_name, "only-first");
    EXPECT_EQ(session.participants.at(session.participant_order.back()).editable_name, "beta");
    EXPECT_TRUE(session.participants.at(session.participant_order.front()).validation.is_ready());
    EXPECT_TRUE(session.participants.at(session.participant_order.back()).validation.is_unchanged());
}

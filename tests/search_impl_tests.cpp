#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "panels/search/search_impl.h"

namespace {

using json = nlohmann::json;

TEST(SearchImplTest, BuildsCloudSearchRequestWithCacheAndRefreshHints) {
    misty::panel::SearchQuery query;
    query.query = "report";
    query.path = "/Users/test/.misty/mnt/drive";
    query.source = misty::panel::SearchSource::REMOTE;
    query.depth = misty::panel::SearchScope::workspace();
    query.allow_cached = true;
    query.refresh_in_background = true;
    query.request_id = "req-1";

    const json body = json::parse(misty::panel::SearchImpl::build_request_body(query));
    EXPECT_EQ(body.value("query", std::string{}), "report");
    EXPECT_EQ(body.value("path", std::string{}), "/Users/test/.misty/mnt/drive");
    EXPECT_EQ(body.value("source", std::string{}), "REMOTE");
    EXPECT_TRUE(body.value("allow_cached", false));
    EXPECT_TRUE(body.value("refresh_in_background", false));
    EXPECT_EQ(body.value("request_id", std::string{}), "req-1");
    ASSERT_TRUE(body.contains("depth"));
    EXPECT_EQ(body["depth"].value("scope", std::string{}), "WORKSPACE");
}

TEST(SearchImplTest, ParsesLegacySearchResponse) {
    const std::string body = json{
        {"items", json::array({
            {
                {"id", "file-1"},
                {"name", "report.pdf"},
                {"path", "/Users/test/report.pdf"},
                {"source", "LOCAL"},
                {"is_dir", false},
                {"score", 12}
            }
        })}
    }.dump();

    misty::panel::SearchResponse response = misty::panel::SearchImpl::parse_response_body(body);
    ASSERT_EQ(response.results.size(), 1u);
    EXPECT_EQ(response.results[0].name, "report.pdf");
    EXPECT_FALSE(response.is_cached);
    EXPECT_FALSE(response.refresh_in_progress);
    EXPECT_TRUE(response.remote_statuses.empty());
}

TEST(SearchImplTest, ParsesCachedCloudSearchResponseMetadata) {
    const std::string body = json{
        {"items", json::array({
            {
                {"id", "remote-1"},
                {"name", "cached.txt"},
                {"path", "/Users/test/.misty/mnt/drive/cached.txt"},
                {"remote_path", "/cached.txt"},
                {"remote_id", "drive-work"},
                {"account_id", "drive-work"},
                {"provider_id", "google-drive"},
                {"source", "REMOTE"},
                {"is_dir", false},
                {"score", 8}
            }
        })},
        {"is_cached", true},
        {"refresh_in_progress", true},
        {"updated", false},
        {"updated_at", "2026-06-07T22:00:00Z"},
        {"request_id", "req-1"},
        {"remote_statuses", json::array({
            {
                {"remote_id", "drive-work"},
                {"account_id", "drive-work"},
                {"provider_id", "google-drive"},
                {"status", "refreshing"},
                {"refreshing", true},
                {"stale", true}
            }
        })}
    }.dump();

    misty::panel::SearchResponse response = misty::panel::SearchImpl::parse_response_body(body);
    ASSERT_EQ(response.results.size(), 1u);
    EXPECT_EQ(response.results[0].name, "cached.txt");
    EXPECT_EQ(response.results[0].provider_id, "google-drive");
    EXPECT_EQ(response.results[0].remote_id, "drive-work");
    EXPECT_TRUE(response.is_cached);
    EXPECT_TRUE(response.refresh_in_progress);
    EXPECT_EQ(response.request_id, "req-1");
    ASSERT_EQ(response.remote_statuses.size(), 1u);
    EXPECT_EQ(response.remote_statuses[0].status, "refreshing");
    EXPECT_TRUE(response.remote_statuses[0].refreshing);
    EXPECT_TRUE(response.remote_statuses[0].stale);
}

} // namespace

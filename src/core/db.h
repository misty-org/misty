#pragma once

#include <cstdint>
#include <memory>
#include <mutex>
#include <string>

struct sqlite3;
struct sqlite3_stmt;

namespace misty::core {

class DB {
public:
    class Statement {
    public:
        Statement() = default;
        explicit Statement(sqlite3_stmt* stmt);
        ~Statement();

        Statement(const Statement&) = delete;
        Statement& operator=(const Statement&) = delete;
        Statement(Statement&& other) noexcept;
        Statement& operator=(Statement&& other) noexcept;

        bool valid() const;
        bool bind_int64(int index, int64_t value);
        bool bind_text(int index, const std::string& value);
        bool bind_bool(int index, bool value);
        int step();
        int64_t column_int64(int index) const;
        std::string column_text(int index) const;
        bool column_bool(int index) const;

    private:
        sqlite3_stmt* stmt_ = nullptr;
    };

    class Guard {
    public:
        explicit Guard(DB& db);

        Guard(const Guard&) = delete;
        Guard& operator=(const Guard&) = delete;
        Guard(Guard&&) = delete;
        Guard& operator=(Guard&&) = delete;

        bool ready() const;
        bool exec(const std::string& sql, std::string* error = nullptr);
        Statement prepare(const std::string& sql, std::string* error = nullptr);
        bool begin(std::string* error = nullptr);
        bool commit(std::string* error = nullptr);
        bool rollback(std::string* error = nullptr);

    private:
        DB& db_;
        std::unique_lock<std::mutex> lock_;
    };

    static DB& get();

    bool open(std::string* error = nullptr);
    bool initialize_schema(std::string* error = nullptr);
    bool run_migrations(std::string* error = nullptr);
    Guard acquire();
    void close();

    void set_path_override_for_testing(const std::string& path);
    void reset_for_testing();

private:
    DB() = default;
    ~DB() = default;
    DB(const DB&) = delete;
    DB& operator=(const DB&) = delete;

    std::string resolve_path() const;
    bool open_unlocked(std::string* error);
    bool initialize_schema_unlocked(std::string* error);
    bool run_migrations_unlocked(std::string* error);
    bool exec_unlocked(const std::string& sql, std::string* error);
    Statement prepare_unlocked(const std::string& sql, std::string* error);

    mutable std::mutex mu_;
    sqlite3* db_ = nullptr;
    std::string path_override_;
};

}  // namespace misty::core

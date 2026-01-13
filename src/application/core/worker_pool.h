#pragma once
#include <thread>
#include <vector>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <functional>




namespace minidfs::core {
    struct Worker {
        std::function<void()> on_task;
        std::function<void()> on_finish;
        std::function<void(const std::string& err_msg)> on_error;
    };
    class WorkerPool {
    public:
        explicit WorkerPool(size_t thread_count = std::thread::hardware_concurrency());
        ~WorkerPool();

        void add(
            std::function<void()> on_task, 
            std::function<void()> on_finish, 
            std::function<void(const std::string&)> on_error
        );
    private:
        void worker_thread();

        std::vector<std::thread> workers_;
        std::queue<Worker> task_queue;
        std::mutex mu_;
        std::condition_variable cv_;
        bool stop_ = false;
    };    
};
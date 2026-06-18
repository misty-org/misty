#include "core/threading/worker_pool.h"
#include <algorithm>
#include <iostream>
#include <queue>

namespace misty::core {
    WorkerPool::WorkerPool(size_t thread_count) {
        if (thread_count == 0) {
            thread_count = 1;
        }
        thread_count = std::min<std::size_t>(thread_count, 4);
        std::cout << "[DEBUG] Initializing WorkerPool with " << thread_count << " threads." << std::endl;
        for (size_t i = 0; i < thread_count; ++i) {
            workers_.emplace_back(&WorkerPool::worker_thread, this);
        }
    }

    WorkerPool::~WorkerPool() {
        shutdown();
    }

    void WorkerPool::shutdown() {
        std::size_t dropped_tasks = 0;
        {
            std::unique_lock<std::mutex> lock(mu_);
            if (stop_) {
                return;
            }
            stop_ = true;
            dropped_tasks = task_queue.size();
            std::queue<Worker> empty;
            task_queue.swap(empty);
        }
        if (dropped_tasks > 0) {
            std::cout << "[DEBUG] WorkerPool shutdown dropped " << dropped_tasks << " queued tasks." << std::endl;
        }
        cv_.notify_all();
        for (std::thread& worker : workers_) {
            if (worker.joinable()) {
                worker.join();
            }
        }
    }

    void WorkerPool::add(std::function<void()> on_task, std::function<void()> on_finish, std::function<void(const std::string&)> on_error) {
        {
            std::unique_lock<std::mutex> lock(mu_);
            if (stop_) {
                return;
            }
            task_queue.push(Worker{on_task, on_finish, on_error});
        }
        cv_.notify_one();
    }

    void WorkerPool::worker_thread() {
        while (true) {
            Worker worker;
            {
                std::unique_lock<std::mutex> lock(mu_);
                cv_.wait(lock, [this]() { return stop_ || !task_queue.empty(); });
                if (stop_ && task_queue.empty()) {
                    return;
                }
                worker = std::move(task_queue.front());
                task_queue.pop();
            }
            try {
                if (worker.on_task) {
                    worker.on_task();
                }
                if (worker.on_finish) {
                    worker.on_finish();
                }
            }
            catch (const std::runtime_error& e) {
                if (worker.on_error) {
                    worker.on_error(std::string("Application Error: ") + e.what());
                }
                // These are errors YOU likely threw intentionally

            }
            catch (const std::exception& e) {
                // These are standard library errors (like bad_alloc or filesystem)
                if (worker.on_error) {
                    worker.on_error(std::string("Application Error: ") + e.what());
                }
            }
        }
    }
}

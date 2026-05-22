if(BUILD_TESTING AND (CMAKE_BUILD_TYPE STREQUAL "Debug" OR CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo"))
    file(GLOB_RECURSE MISTY_TEST_SOURCES CONFIGURE_DEPENDS
        "${CMAKE_SOURCE_DIR}/tests/*.cpp"
        "${CMAKE_SOURCE_DIR}/tests/*.h"
    )

    if(MISTY_TEST_SOURCES)
        set(MISTY_TEST_SUPPORT_SOURCES
            "${CMAKE_SOURCE_DIR}/src/core/file_master/file_master_api.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_master/file_master_local.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_master/file_master_remote.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_master/file_master_util.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_transfer/file_transfer.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/manager/env_manager.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/manager/proxy_manager.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/manager/session_manager.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/net/http_client.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/system/util.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_gate.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_master.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_poller.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_runner.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_store.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_watcher.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_watcher.h"
            "${CMAKE_SOURCE_DIR}/src/core/threading/worker_pool.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/state/file_explorer_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/search/search_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/activity/activity_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/activity/upload_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/activity/download_state.cpp"
        )

        add_executable(misty_tests
            ${MISTY_TEST_SOURCES}
            ${MISTY_TEST_SUPPORT_SOURCES}
        )
        target_include_directories(misty_tests PRIVATE
            "${CMAKE_SOURCE_DIR}/src"
            "${CMAKE_SOURCE_DIR}/src/proto_src"
            "${CMAKE_SOURCE_DIR}/vendor/glad/include"
            "${CMAKE_SOURCE_DIR}/vendor/imgui"
            "${CMAKE_SOURCE_DIR}/vendor/imgui/backends"
            "${CMAKE_SOURCE_DIR}/vendor/json/single_include"
            "${CMAKE_SOURCE_DIR}/vendor/watcher/include"
            "${CMAKE_SOURCE_DIR}/vendor/xxhash"
        )
        target_link_libraries(misty_tests PRIVATE
            gtest_main
            misty_proto
            CURL::libcurl
        )

        if(APPLE)
            target_link_libraries(misty_tests PRIVATE
                "-framework CoreGraphics"
                "-framework CoreServices"
                "-framework Cocoa"
                "-framework Security"
            )
        endif()

        include(GoogleTest)
        gtest_discover_tests(misty_tests)
    else()
        message(STATUS "No client tests found under tests/; skipping misty_tests target.")
    endif()
endif()

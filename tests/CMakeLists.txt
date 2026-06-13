if(BUILD_TESTING)
    file(GLOB_RECURSE MISTY_TEST_SOURCES CONFIGURE_DEPENDS
        "${CMAKE_SOURCE_DIR}/tests/*.cpp"
        "${CMAKE_SOURCE_DIR}/tests/*.h"
    )

    if(MISTY_TEST_SOURCES)
        set(MISTY_TEST_SUPPORT_SOURCES
            "${CMAKE_SOURCE_DIR}/src/core/file_master/file_master.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_master/file_master_api.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_master/file_master_local.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_master/file_master_remote.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_master/file_master_util.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/db.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_transfer/file_transfer.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_transfer/file_transfer_store.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/manager/env_manager.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/manager/proxy_manager.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/manager/proxy_token_store.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/net/http_client.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/system/util.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_gate.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_compare.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_master.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_pair_store.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_poller.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_runner.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_store.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_watcher.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/file_sync/file_sync_watcher.h"
            "${CMAKE_SOURCE_DIR}/src/core/clipboard/clipboard_service.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/clipboard/clipboard_types.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/clipboard/proxy_clipboard_client.cpp"
            "${CMAKE_SOURCE_DIR}/src/core/threading/worker_pool.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/clipboard/clipboard_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/state/file_explorer_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/state/file_listings_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/state/library_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/state/loading_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/state/remote_mount_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/state/rename_session_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/content/file_explorer_content_util.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/operations/file_operation_jobs.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/operations/file_master_operations.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/file_explorer/operations/operation_queue_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/search/search_impl.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/search/search_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/activity/activity_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/activity/upload_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/activity/download_state.cpp"
            "${CMAKE_SOURCE_DIR}/src/panels/notification/notification_state.cpp"
            "${CMAKE_SOURCE_DIR}/vendor/imgui/imgui.cpp"
            "${CMAKE_SOURCE_DIR}/vendor/imgui/imgui_draw.cpp"
            "${CMAKE_SOURCE_DIR}/vendor/imgui/imgui_tables.cpp"
            "${CMAKE_SOURCE_DIR}/vendor/imgui/imgui_widgets.cpp"
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
            SQLite::SQLite3
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

if(BUILD_TESTING AND (CMAKE_BUILD_TYPE STREQUAL "Debug" OR CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo"))
    file(GLOB_RECURSE MISTY_TEST_SOURCES CONFIGURE_DEPENDS
        "${CMAKE_SOURCE_DIR}/src/tests/*.cpp"
        "${CMAKE_SOURCE_DIR}/src/tests/*.h"
    )

    if(MISTY_TEST_SOURCES)
        set(MISTY_TEST_SUPPORT_SOURCES
            "${CMAKE_SOURCE_DIR}/src/core/sync/fs_watcher.h"
        )

        if(APPLE)
            list(APPEND MISTY_TEST_SUPPORT_SOURCES "${CMAKE_SOURCE_DIR}/src/core/sync/fs_watcher_mac.mm")
        elseif(UNIX AND NOT APPLE)
            list(APPEND MISTY_TEST_SUPPORT_SOURCES "${CMAKE_SOURCE_DIR}/src/core/sync/fs_watcher_linux.cpp")
        else()
            list(APPEND MISTY_TEST_SUPPORT_SOURCES "${CMAKE_SOURCE_DIR}/src/core/sync/fs_watcher_stub.cpp")
        endif()

        add_executable(misty_tests
            ${MISTY_TEST_SOURCES}
            ${MISTY_TEST_SUPPORT_SOURCES}
        )
        target_include_directories(misty_tests PRIVATE "${CMAKE_SOURCE_DIR}/src")
        target_link_libraries(misty_tests PRIVATE gtest_main)

        if(APPLE)
            target_link_libraries(misty_tests PRIVATE
                "-framework CoreServices"
            )
        endif()

        include(GoogleTest)
        gtest_discover_tests(misty_tests)
    else()
        message(STATUS "No client tests found under src/tests/; skipping misty_tests target.")
    endif()
endif()

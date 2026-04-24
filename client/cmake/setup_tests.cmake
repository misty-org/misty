# cmake/setup_tests.cmake

if(CMAKE_BUILD_TYPE STREQUAL "Debug" OR CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
    file(GLOB_RECURSE TEST_SRCS
        "tests/*.cpp"
        "tests/*.h"
    )
    if(TEST_SRCS)
        add_executable(misty_tests ${TEST_SRCS})
        target_link_libraries(misty_tests PRIVATE
            misty_core
            gtest_main
        )
    else()
        message(STATUS "No client tests found under tests/; skipping misty_tests target.")
    endif()
endif()

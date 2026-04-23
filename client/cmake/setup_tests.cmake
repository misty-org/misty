# cmake/setup_tests.cmake

if(CMAKE_BUILD_TYPE STREQUAL "Debug" OR CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
    file(GLOB_RECURSE TEST_SRCS
        "src/tests/*.cpp"
        "src/tests/*.h"
    )
    add_executable(misty_tests ${TEST_SRCS})
    target_link_libraries(misty_tests PRIVATE
        misty_core
        gtest_main
    )
endif()
# cmake/setup_tests.cmake

file(GLOB_RECURSE TEST_SRCS
    "src/tests/*.cpp"
    "src/tests/*.h"
)
# tests
add_executable(misty_tests ${TEST_SRCS})
target_link_libraries(misty_tests PRIVATE
    misty_core
    gtest_main
)
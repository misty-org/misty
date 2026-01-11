# cmake/setup_tests.cmake
find_package(GTest CONFIG REQUIRED)

file(GLOB_RECURSE TEST_SRCS
    "src/tests/*.cpp"
    "src/tests/*.h"
)
  
# tests
add_executable(minidfs_tests ${TEST_SRCS})
target_link_libraries(minidfs_tests PRIVATE
    minidfs
    GTest::gtest
    GTest::gtest_main
)
# cmake/setup_tests.cmake
find_package(GTest CONFIG REQUIRED)

set(TEST_SRCS
    "tests/file_manager_tests.cpp"
    "tests/minidfs_single_client_tests.cpp"
)
  
# tests
add_executable(minidfs_tests ${TEST_SRCS})
target_link_libraries(minidfs_tests PRIVATE
    minidfs
    GTest::gtest
    GTest::gtest_main
)
# cmake/setup_tests.cmake

set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
set(BUILD_GMOCK OFF CACHE BOOL "" FORCE)

add_subdirectory(${CMAKE_SOURCE_DIR}/vendor/googletest)

file(GLOB_RECURSE TEST_SRCS
    "src/tests/*.cpp"
    "src/tests/*.h"
)
  
# tests
add_executable(minidfs_tests ${TEST_SRCS})
target_link_libraries(minidfs_tests PRIVATE
    minidfs
    gtest
    gtest_main
)
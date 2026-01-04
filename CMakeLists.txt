cmake_minimum_required(VERSION 3.10)
project(minidfs LANGUAGES CXX C VERSION 1.0)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
list(APPEND CMAKE_MODULE_PATH ${CMAKE_SOURCE_DIR}/cmake)

# miniDFS static library
set(MINIDFS_SRCS
    "dfs/file_manager.cpp" 
    "dfs/minidfs_impl.cpp"
    "dfs/minidfs_client.cpp"
    "dfs/pubsub_manager.cpp"
)

add_library(minidfs STATIC ${MINIDFS_SRCS})
target_link_libraries(minidfs PUBLIC minidfs_proto)
target_include_directories(minidfs PUBLIC
    ${CMAKE_SOURCE_DIR}
    ${IMGUI_INCLUDE_DIRS}
    ${EXTERNAL_INCLUDE_DIRS}
)


# minidfs server cli/backend
add_executable(minidfs_server "server.cpp")
target_link_libraries(minidfs_server PRIVATE minidfs)

include(setup_proto)
include(setup_application)
include(setup_tests)

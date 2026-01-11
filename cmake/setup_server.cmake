# cmake/setup_server.cmake

# minidfs server cli/backend
add_executable(minidfs_server "src/dfs/server.cpp")
target_link_libraries(minidfs_server PRIVATE minidfs)


# cmake/setup_server.cmake

# misty server cli/backend
add_executable(misty_server "src/dfs/server/server.cpp")
target_link_libraries(misty_server PRIVATE misty_core)


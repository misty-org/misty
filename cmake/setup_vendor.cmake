include(FetchContent)

FetchContent_Declare(
  lunasvg
  GIT_REPOSITORY https://github.com/sammycage/lunasvg.git
  GIT_TAG        v3.5.0
)

FetchContent_MakeAvailable(lunasvg)

target_link_libraries(minidfs_client PRIVATE lunasvg)
add_custom_command(TARGET minidfs_client POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
  "${CMAKE_CURRENT_SOURCE_DIR}/vendor/octicons/icons"
  "$<TARGET_FILE_DIR:minidfs_client>/assets/icons"
)
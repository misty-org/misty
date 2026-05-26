set(MISTY_IMGUI_DIR "${CMAKE_SOURCE_DIR}/vendor/imgui")
set(MISTY_IMGUI_SOURCES
    "${MISTY_IMGUI_DIR}/imgui.cpp"
    "${MISTY_IMGUI_DIR}/imgui_draw.cpp"
    "${MISTY_IMGUI_DIR}/imgui_tables.cpp"
    "${MISTY_IMGUI_DIR}/imgui_widgets.cpp"
    "${MISTY_IMGUI_DIR}/backends/imgui_impl_glfw.cpp"
    "${MISTY_IMGUI_DIR}/backends/imgui_impl_opengl3.cpp"
)

file(GLOB_RECURSE MISTY_CORE_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/core/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/core/*.mm"
    "${CMAKE_CURRENT_SOURCE_DIR}/core/*.h"
)
list(REMOVE_ITEM MISTY_CORE_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/core/ui/stb_image_impl.cpp"
)
file(GLOB_RECURSE MISTY_PANEL_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/panels/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/panels/*.mm"
    "${CMAKE_CURRENT_SOURCE_DIR}/panels/*.h"
)
file(GLOB_RECURSE MISTY_VIEW_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/views/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/views/*.mm"
    "${CMAKE_CURRENT_SOURCE_DIR}/views/*.h"
)

set(MISTY_SERVER_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/dfs/server/server.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/dfs/server/misty_impl.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/dfs/server/misty_impl.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/dfs/server/pubsub_manager.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/dfs/server/pubsub_manager.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/dfs/file_manager.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/dfs/file_manager.h"
)

set(MISTY_APP_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/application.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/application.h"
    "${CMAKE_CURRENT_SOURCE_DIR}/main.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/core/plugins/plugin_signing.cpp"
    "${CMAKE_SOURCE_DIR}/vendor/glad/src/glad.cpp"
    ${MISTY_IMGUI_SOURCES}
    ${MISTY_CORE_SOURCES}
    ${MISTY_PANEL_SOURCES}
    ${MISTY_VIEW_SOURCES}
)

if(WIN32)
    file(GLOB MISTY_PLATFORM_SOURCES CONFIGURE_DEPENDS
        "${CMAKE_CURRENT_SOURCE_DIR}/platform/windows/*.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/platform/windows/*.h"
    )
elseif(APPLE)
    file(GLOB MISTY_PLATFORM_SOURCES CONFIGURE_DEPENDS
        "${CMAKE_CURRENT_SOURCE_DIR}/platform/mac/*.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/platform/mac/*.h"
        "${CMAKE_CURRENT_SOURCE_DIR}/platform/mac/*.mm"
    )
elseif(UNIX AND NOT APPLE)
    file(GLOB MISTY_PLATFORM_SOURCES CONFIGURE_DEPENDS
        "${CMAKE_CURRENT_SOURCE_DIR}/platform/linux/*.cpp"
        "${CMAKE_CURRENT_SOURCE_DIR}/platform/linux/*.h"
    )
endif()

list(APPEND MISTY_APP_SOURCES ${MISTY_PLATFORM_SOURCES})

set(MISTY_COMMON_INCLUDE_DIRS
    "${CMAKE_SOURCE_DIR}/src"
    "${CMAKE_SOURCE_DIR}/src/core/plugins"
    "${MISTY_EXTERNAL_PLUGIN_DIR}/include"
    "${MISTY_EXTERNAL_PLUGIN_DIR}/host"
    "${CMAKE_SOURCE_DIR}/vendor/glad/include"
    "${CMAKE_SOURCE_DIR}/vendor/lunasvg/include"
    "${CMAKE_SOURCE_DIR}/vendor/stb_image"
    "${CMAKE_SOURCE_DIR}/vendor/stb"
    "${CMAKE_SOURCE_DIR}/vendor/watcher/include"
    "${CMAKE_SOURCE_DIR}/vendor/xxhash"
    "${CMAKE_SOURCE_DIR}/vendor/json/single_include"
    "${MISTY_IMGUI_DIR}"
    "${MISTY_IMGUI_DIR}/backends"
)

add_executable(misty ${MISTY_APP_SOURCES})
target_include_directories(misty PRIVATE ${MISTY_COMMON_INCLUDE_DIRS})
target_compile_definitions(misty PRIVATE
    $<$<CONFIG:Debug>:MISTY_DEBUG_BUILD=1>
    MISTY_SOURCE_ASSETS_DIR="${CMAKE_SOURCE_DIR}/assets"
)
misty_configure_plugin_host(misty)
target_link_libraries(misty
    PRIVATE
        glfw
        lunasvg
        OpenGL::GL
        CURL::libcurl
        OpenSSL::Crypto
)

if(WIN32)
    set_target_properties(misty PROPERTIES
        WIN32_EXECUTABLE $<IF:$<CONFIG:Release>,TRUE,FALSE>
    )
    target_compile_definitions(misty PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
    target_link_libraries(misty PRIVATE ws2_32 dwmapi)
    if(MSVC)
        target_compile_options(misty PRIVATE /MP)
        target_compile_options(misty PRIVATE $<$<CONFIG:Debug>:/ZI>)
        target_link_options(misty PRIVATE $<$<CONFIG:Debug>:/EDITANDCONTINUE>)
        set_property(TARGET misty PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
        set_property(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" PROPERTY VS_STARTUP_PROJECT misty)
        set_target_properties(misty PROPERTIES VS_DEBUGGER_WORKING_DIRECTORY "$<TARGET_FILE_DIR:misty>")
    endif()
elseif(APPLE)
    target_link_libraries(misty PRIVATE
        "-framework CoreGraphics"
        "-framework CoreServices"
        "-framework Cocoa"
        "-framework Security"
    )
elseif(UNIX AND NOT APPLE)
    target_compile_definitions(misty PRIVATE _GNU_SOURCE)
endif()

add_executable(misty_server ${MISTY_SERVER_SOURCES})
target_include_directories(misty_server PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(misty_server PRIVATE misty_proto OpenSSL::Crypto)

set(MISTY_ASSET_COMMANDS
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:misty>"
)

if(EXISTS "${CMAKE_SOURCE_DIR}/misty.conf")
    list(APPEND MISTY_ASSET_COMMANDS
        COMMAND ${CMAKE_COMMAND} -E copy
            "${CMAKE_SOURCE_DIR}/misty.conf"
            "$<TARGET_FILE_DIR:misty>/misty.conf"
    )
endif()

if(EXISTS "${CMAKE_SOURCE_DIR}/commands.msy")
    list(APPEND MISTY_ASSET_COMMANDS
        COMMAND ${CMAKE_COMMAND} -E copy
            "${CMAKE_SOURCE_DIR}/commands.msy"
            "$<TARGET_FILE_DIR:misty>/commands.msy"
    )
endif()

if(EXISTS "${CMAKE_SOURCE_DIR}/plugins")
    list(APPEND MISTY_ASSET_COMMANDS
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CMAKE_SOURCE_DIR}/plugins"
            "$<TARGET_FILE_DIR:misty>/plugins"
    )
endif()

add_custom_command(TARGET misty POST_BUILD ${MISTY_ASSET_COMMANDS})
add_custom_target(misty_assets ALL ${MISTY_ASSET_COMMANDS})
add_dependencies(misty_assets misty)

# cmake/setup_gui.cmake
set(IMGUI_DIR ${CMAKE_SOURCE_DIR}/vendor/imgui)
set(MISTY_PLUGIN_SDK_VERSION "${PROJECT_VERSION}")
set(MISTY_PLUGIN_BUILD_ID_DEFAULT "${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR}-${CMAKE_CXX_COMPILER_ID}-${CMAKE_CXX_COMPILER_VERSION}-sdk${MISTY_PLUGIN_SDK_VERSION}")
set(MISTY_PLUGIN_BUILD_ID "${MISTY_PLUGIN_BUILD_ID_DEFAULT}" CACHE STRING "Plugin build id accepted by this Misty build")
set(MISTY_PLUGIN_TRUST_PUBKEY "" CACHE FILEPATH "Optional PEM public key for trusted plugin signatures")
set(MISTY_REQUIRE_SIGNED_PLUGINS OFF CACHE BOOL "Reject unsigned plugins before load")
set(MISTY_PLUGIN_TRUST_DIR "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/plugin_keys")
set(MISTY_PLUGIN_USER_TRUST_DIR "")
set(MISTY_PLUGIN_TRUST_PUBKEY_PEM "")
set(MISTY_REQUIRE_SIGNED_PLUGINS_VALUE 0)
if(MISTY_REQUIRE_SIGNED_PLUGINS)
    set(MISTY_REQUIRE_SIGNED_PLUGINS_VALUE 1)
endif()
if(MISTY_PLUGIN_TRUST_PUBKEY AND EXISTS "${MISTY_PLUGIN_TRUST_PUBKEY}")
    file(READ "${MISTY_PLUGIN_TRUST_PUBKEY}" MISTY_PLUGIN_TRUST_PUBKEY_PEM)
endif()
file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/generated")
configure_file(
    "${CMAKE_SOURCE_DIR}/cmake/plugin_build_config.h.in"
    "${CMAKE_BINARY_DIR}/generated/plugin_build_config.h"
    @ONLY
)
set(IMGUI_SRCS
    ${IMGUI_DIR}/imgui.cpp
    ${IMGUI_DIR}/imgui_draw.cpp
    ${IMGUI_DIR}/imgui_tables.cpp
    ${IMGUI_DIR}/imgui_widgets.cpp
    ${IMGUI_DIR}/backends/imgui_impl_glfw.cpp
    ${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp
)


set(APP_SRCS
    "src/application.cpp"
    "src/application.h"
    "src/main.cpp"
    "vendor/glad/src/glad.cpp"
    ${IMGUI_SRCS}
)

file(GLOB_RECURSE APP_COMMON_SRCS CONFIGURE_DEPENDS
    "src/core/*.cpp"
    "src/core/*.mm"
    "src/core/*.h"
    "src/panels/*.cpp"
    "src/panels/*.mm"
    "src/panels/*.h"
    "src/views/*.cpp"
    "src/views/*.mm"
    "src/views/*.h"
)

list(APPEND APP_SRCS ${APP_COMMON_SRCS})

add_executable(misty)
if(WIN32)
    file(GLOB WIN32_SRCS "src/platform/windows/*.cpp" "src/platform/windows/*.h")
    list(APPEND APP_SRCS ${WIN32_SRCS})
    target_sources(misty PRIVATE ${APP_SRCS})
    if(CMAKE_BUILD_TYPE STREQUAL "Release")
        set_target_properties(misty PROPERTIES WIN32_EXECUTABLE TRUE)
    else()
        set_target_properties(misty PROPERTIES WIN32_EXECUTABLE FALSE)
    endif()
    add_definitions(-DWIN32_LEAN_AND_MEAN)
    add_definitions(-DNOMINMAX)
    target_link_libraries(misty PRIVATE ws2_32 dwmapi)
    if(MSVC)
        # Use /MP for ALL configurations to speed up every build
        target_compile_options(misty PRIVATE /MP)

        # Edit and Continue flags (Use 'Debug' casing)
        target_compile_options(misty PRIVATE $<$<CONFIG:Debug>:/ZI>)
        target_link_options(misty PRIVATE $<$<CONFIG:Debug>:/EDITANDCONTINUE>)

        # CRITICAL: Fix the 'MDd' vs 'MT' mismatch error
        set_property(TARGET misty PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")

        # Set Startup Project
        set_property(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR} PROPERTY VS_STARTUP_PROJECT misty)
        
        # Set Debugging Working Directory so it finds your config/assets
        set_target_properties(misty PROPERTIES VS_DEBUGGER_WORKING_DIRECTORY "$<TARGET_FILE_DIR:misty>")
    endif()
elseif(APPLE)
    file(GLOB MAC_SRCS "src/platform/mac/*.cpp" "src/platform/mac/*.h" "src/platform/mac/*.mm")
    list(APPEND APP_SRCS ${MAC_SRCS})
    target_sources(misty PRIVATE ${APP_SRCS})
    target_link_libraries(misty PRIVATE
        "-framework CoreGraphics"
        "-framework CoreServices"
        "-framework Cocoa"
        "-framework Security"
    )
elseif(UNIX AND NOT APPLE)
    file(GLOB LINUX_SRCS
        "src/platform/linux/*.cpp"
        "src/platform/linux/*.h"
    )
    list(APPEND APP_SRCS ${LINUX_SRCS})
    target_sources(misty PRIVATE ${APP_SRCS})
    target_compile_definitions(misty PRIVATE
        _GNU_SOURCE
    )
endif()

# vendor includes
target_include_directories(misty PRIVATE
    ${CMAKE_SOURCE_DIR}/vendor/glad/include
    ${CMAKE_SOURCE_DIR}/vendor/lunasvg/include
    ${CMAKE_SOURCE_DIR}/vendor/stb_image
    ${CMAKE_SOURCE_DIR}/vendor/imgui/backends
    ${CMAKE_SOURCE_DIR}/vendor/imgui
    ${CMAKE_SOURCE_DIR}/vendor/stb
    ${CMAKE_SOURCE_DIR}/vendor/json/single_include
)

# project includes
target_include_directories(misty PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${IMGUI_DIR}
    ${IMGUI_DIR}/backends
    ${CMAKE_BINARY_DIR}/generated
    ${CMAKE_SOURCE_DIR}/src/proto_src
    ${CMAKE_SOURCE_DIR}/src/dfs
    ${CMAKE_SOURCE_DIR}/src
)

target_link_libraries(misty PRIVATE 
    misty_core
    protobuf::libprotobuf
    gRPC::grpc++
    glfw
    lunasvg
    OpenGL::GL
    CURL::libcurl
    OpenSSL::Crypto
)

set(MISTY_SANDBOX_SRCS
    "src/tools/plugin_sandbox_main.cpp"
    "src/core/extensions/plugin_host.cpp"
    "src/core/extensions/plugin_signing.cpp"
    "src/core/commands/command_manager.cpp"
    "src/core/system/util.cpp"
    "src/views/app_view.cpp"
    "vendor/glad/src/glad.cpp"
    ${IMGUI_SRCS}
)

add_executable(misty_plugin_sandbox ${MISTY_SANDBOX_SRCS})
set_target_properties(misty_plugin_sandbox PROPERTIES OUTPUT_NAME "misty-plugin-sandbox")
target_include_directories(misty_plugin_sandbox PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_BINARY_DIR}/generated
    ${CMAKE_SOURCE_DIR}/vendor/glad/include
    ${CMAKE_SOURCE_DIR}/vendor/imgui/backends
    ${CMAKE_SOURCE_DIR}/vendor/imgui
    ${CMAKE_SOURCE_DIR}/vendor/json/single_include
)
target_link_libraries(misty_plugin_sandbox PRIVATE
    glfw
    OpenGL::GL
    OpenSSL::Crypto
    ${CMAKE_DL_LIBS}
)
if(APPLE)
    target_link_libraries(misty_plugin_sandbox PRIVATE
        "-framework CoreGraphics"
        "-framework CoreServices"
        "-framework Cocoa"
        "-framework Security"
    )
elseif(WIN32)
    target_link_libraries(misty_plugin_sandbox PRIVATE ws2_32 dwmapi)
endif()

# ---- Host platform detection for variant layout ----
if(WIN32)
    set(MISTY_HOST_OS "windows")
elseif(APPLE)
    set(MISTY_HOST_OS "macos")
else()
    set(MISTY_HOST_OS "linux")
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "(aarch64|arm64|ARM64)")
    set(MISTY_HOST_ARCH "arm64")
else()
    set(MISTY_HOST_ARCH "x86_64")
endif()

if(MSVC)
    set(MISTY_HOST_RUNTIME "msvc")
elseif(APPLE)
    set(MISTY_HOST_RUNTIME "libc++")
else()
    set(MISTY_HOST_RUNTIME "libstdc++")
endif()

set(MISTY_PLUGIN_VARIANT_DIR "variants/${MISTY_HOST_OS}-${MISTY_HOST_ARCH}")
set(MISTY_PLUGIN_OUTPUT_DIR "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/plugins/preview_manager")
set(MISTY_PLUGIN_VARIANT_OUTPUT_DIR "${MISTY_PLUGIN_OUTPUT_DIR}/${MISTY_PLUGIN_VARIANT_DIR}")
set(MISTY_PREVIEW_MANAGER_LIBRARY_NAME "preview_manager${CMAKE_SHARED_LIBRARY_SUFFIX}")
set(MISTY_PREVIEW_MANAGER_VARIANT_LIBRARY "${MISTY_PLUGIN_VARIANT_DIR}/${MISTY_PREVIEW_MANAGER_LIBRARY_NAME}")
configure_file(
    "${CMAKE_SOURCE_DIR}/plugins/preview_manager/manifest.json.in"
    "${CMAKE_CURRENT_BINARY_DIR}/plugins/preview_manager/manifest.json"
    @ONLY
)

add_library(preview_manager MODULE
    "plugins/preview_manager/plugin.cpp"
    "plugins/preview_manager/stb_impl.cpp"
)
set_target_properties(preview_manager PROPERTIES
    PREFIX ""
    OUTPUT_NAME "preview_manager"
    SUFFIX "${CMAKE_SHARED_LIBRARY_SUFFIX}"
    LIBRARY_OUTPUT_DIRECTORY "${MISTY_PLUGIN_VARIANT_OUTPUT_DIR}"
    RUNTIME_OUTPUT_DIRECTORY "${MISTY_PLUGIN_VARIANT_OUTPUT_DIR}"
)
target_include_directories(preview_manager PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/vendor/stb
)
target_compile_definitions(preview_manager PRIVATE MISTY_PLUGIN_BUILD=1)

add_custom_target(preview_manager_manifest ALL
    COMMAND ${CMAKE_COMMAND} -E make_directory "${MISTY_PLUGIN_OUTPUT_DIR}"
    COMMAND ${CMAKE_COMMAND} -E copy
        "${CMAKE_CURRENT_BINARY_DIR}/plugins/preview_manager/manifest.json"
        "${MISTY_PLUGIN_OUTPUT_DIR}/manifest.json"
    DEPENDS preview_manager
)

set(MISTY_ASSET_COMMANDS
    COMMAND ${CMAKE_COMMAND} -E make_directory
        "$<TARGET_FILE_DIR:misty>/assets"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CMAKE_CURRENT_SOURCE_DIR}/assets"
        "$<TARGET_FILE_DIR:misty>/assets"
    COMMAND ${CMAKE_COMMAND} -E make_directory
        "$<TARGET_FILE_DIR:misty>/assets/icons"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CMAKE_CURRENT_SOURCE_DIR}/vendor/octicons/icons"
        "$<TARGET_FILE_DIR:misty>/assets/icons"
    COMMAND ${CMAKE_COMMAND} -E copy
        "${CMAKE_CURRENT_SOURCE_DIR}/misty.conf"
        "$<TARGET_FILE_DIR:misty>/misty.conf"
)

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/commands.msy")
    list(APPEND MISTY_ASSET_COMMANDS
        COMMAND ${CMAKE_COMMAND} -E copy
            "${CMAKE_CURRENT_SOURCE_DIR}/commands.msy"
            "$<TARGET_FILE_DIR:misty>/commands.msy"
    )
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/extensions")
    list(APPEND MISTY_ASSET_COMMANDS
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CMAKE_CURRENT_SOURCE_DIR}/extensions"
            "$<TARGET_FILE_DIR:misty>/extensions"
    )
endif()

add_custom_target(misty_assets ALL ${MISTY_ASSET_COMMANDS})
add_dependencies(misty_assets misty misty_plugin_sandbox preview_manager_manifest)

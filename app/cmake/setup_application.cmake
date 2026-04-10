# cmake/setup_gui.cmake
set(IMGUI_DIR ${CMAKE_SOURCE_DIR}/vendor/imgui)
set(IMGUI_SRCS
    ${IMGUI_DIR}/imgui.cpp
    ${IMGUI_DIR}/imgui_demo.cpp
    ${IMGUI_DIR}/imgui_draw.cpp
    ${IMGUI_DIR}/imgui_tables.cpp
    ${IMGUI_DIR}/imgui_widgets.cpp
    ${IMGUI_DIR}/backends/imgui_impl_glfw.cpp
    ${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp
)


file(GLOB_RECURSE APP_SRCS
    "src/application/*.cpp"
    "src/application/*.mm"
    "src/application/*.h"
    "vendor/glad/src/glad.cpp"
    ${IMGUI_SRCS}
)

add_executable(misty)
if(WIN32)
    file(GLOB WIN32_SRCS "src/application/platform/windows/*.cpp" "src/application/platform/windows/*.h")
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
    file(GLOB MAC_SRCS "application/platform/mac/*.cpp" "application/platform/mac/*.h")
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
        "src/application/platform/linux/*.cpp"
        "src/application/platform/linux/*.h"
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
    ${CMAKE_SOURCE_DIR}/src/proto_src
    ${CMAKE_SOURCE_DIR}/src/dfs
    ${CMAKE_SOURCE_DIR}/src/application
)

target_link_libraries(misty PRIVATE 
    misty_core
    protobuf::libprotobuf
    gRPC::grpc++
    glfw
    lunasvg
    OpenGL::GL
    CURL::libcurl
)


add_custom_target(misty_assets ALL
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
    COMMAND ${CMAKE_COMMAND} -E copy
        "${CMAKE_CURRENT_SOURCE_DIR}/commands.msy"
        "$<TARGET_FILE_DIR:misty>/commands.msy"
)

add_dependencies(misty_assets misty)



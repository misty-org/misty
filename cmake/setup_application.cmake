# cmake/setup_gui.cmake
set(IMGUI_DIR ${CMAKE_SOURCE_DIR}/vendor/imgui)

set(IMGUI_SRCS
    ${IMGUI_DIR}/imgui.cpp
    ${IMGUI_DIR}/imgui_demo.cpp
    ${IMGUI_DIR}/imgui_draw.cpp
    ${IMGUI_DIR}/imgui_tables.cpp
    ${IMGUI_DIR}/imgui_widgets.cpp
    ${IMGUI_DIR}/backends/imgui_impl_glfw.cpp
)

if(APPLE)
    list(APPEND IMGUI_SRCS ${IMGUI_DIR}/backends/imgui_impl_metal.mm)
else()
    list(APPEND IMGUI_SRCS ${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp)
endif()

find_package(glfw3 REQUIRED)
add_library(imgui STATIC ${IMGUI_SRCS})
target_include_directories(imgui PUBLIC
    ${IMGUI_DIR}
    ${IMGUI_DIR}/backends
)

if(APPLE)
    target_link_libraries(imgui PRIVATE
        glfw
        "-framework Cocoa"
        "-framework CoreFoundation"
        "-framework Metal"
        "-framework MetalKit"
        "-framework QuartzCore"
        "-framework IOKit"
        "-framework CoreGraphics"
    )
else()
    find_package(OpenGL REQUIRED)
    target_link_libraries(imgui PUBLIC
        glfw
        OpenGL::GL
    )
endif()

file(GLOB_RECURSE APP_SRCS
    "application/*.cpp"
    "application/*.h"
)
add_executable(minidfs_client)
if(WIN32)
    list(APPEND APP_SRCS "vendor/glad/src/glad.cpp")
    file(GLOB WIN32_SRCS "application/platform/windows/*.cpp" "application/platform/windows/*.h")
    list(APPEND APP_SRCS ${WIN32_SRCS})
    target_sources(minidfs_client PRIVATE ${APP_SRCS})
    if(CMAKE_BUILD_TYPE STREQUAL "Release")
        set_target_properties(minidfs_client PROPERTIES WIN32_EXECUTABLE TRUE)
    else()
        set_target_properties(minidfs_client PROPERTIES WIN32_EXECUTABLE FALSE)
    endif()
    add_definitions(-DWIN32_LEAN_AND_MEAN)
    add_definitions(-DNOMINMAX)
    target_link_libraries(minidfs_client PRIVATE ws2_32)
    if(MSVC)
        target_link_options(minidfs_client PRIVATE "/ENTRY:mainCRTStartup")
        set_property(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR} PROPERTY VS_STARTUP_PROJECT minidfs_client)
        set_target_properties(minidfs_client PROPERTIES VS_DEBUGGER_WORKING_DIRECTORY "$<TARGET_FILE_DIR:minidfs_client>")
        
        # Enable multi-processor compilation
        add_compile_options(/MP)
        
        # Enable Hot Reload (Edit and Continue) for Debug builds
        target_compile_options(minidfs_client PRIVATE $<$<CONFIG:Debug>:/ZI>)
        target_link_options(minidfs_client PRIVATE $<$<CONFIG:Debug>:/INCREMENTAL>)
        
        # Also need /Od (disable optimizations) for Hot Reload to work properly
        target_compile_options(minidfs_client PRIVATE $<$<CONFIG:Debug>:/Od>)
    endif()
elseif(APPLE)
    file(GLOB MAC_SRCS "application/platform/mac/*.mm" "application/platform/mac/*.h")
    list(APPEND APP_SRCS ${MAC_SRCS})
    target_sources(minidfs_client PRIVATE ${APP_SRCS})
    set_target_properties(minidfs_client PROPERTIES
        MACOSX_BUNDLE TRUE
    )
endif()
target_include_directories(minidfs_client PRIVATE
    ${CMAKE_SOURCE_DIR}
    ${IMGUI_DIR}
    ${IMGUI_DIR}/backend
    ${CMAKE_SOURCE_DIR}/dfs
    ${CMAKE_SOURCE_DIR}/application
    ${CMAKE_SOURCE_DIR}/application/panels
    ${CMAKE_SOURCE_DIR}/application/panels/FileExplorer
    ${CMAKE_SOURCE_DIR}/application/panels/Auth
    ${CMAKE_SOURCE_DIR}/application/panels/Navbar
    ${CMAKE_SOURCE_DIR}/application/panels/FileSidebar
    ${CMAKE_SOURCE_DIR}/application/views
    ${CMAKE_SOURCE_DIR}/application/core
    ${CMAKE_SOURCE_DIR}/application/platform/mac
    ${CMAKE_SOURCE_DIR}/application/platform/windows
    ${CMAKE_SOURCE_DIR}/vendor/glad/include
    ${CMAKE_SOURCE_DIR}/vendor/lunasvg/include
    ${CMAKE_SOURCE_DIR}/vendor/stb
    ${CMAKE_SOURCE_DIR}/proto_src
    ${IMGUI_INCLUDE_DIRS}
)
target_link_libraries(minidfs_client PRIVATE 
    minidfs
    imgui
    glfw
)
if(WIN32)
    target_link_libraries(minidfs_client PRIVATE dwmapi)
endif()
target_precompile_headers(minidfs_client PRIVATE 
    "application/minidfs.h"
)

add_custom_command(TARGET minidfs_client POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
  "${CMAKE_CURRENT_SOURCE_DIR}/assets"
  "$<TARGET_FILE_DIR:minidfs_client>/assets"
)






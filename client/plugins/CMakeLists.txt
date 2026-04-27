set(MISTY_PLUGIN_VARIANT_DIR "variants/${MISTY_HOST_OS}-${MISTY_HOST_ARCH}")
set(MISTY_PLUGIN_OUTPUT_DIR "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/plugins/preview_manager")
set(MISTY_PLUGIN_VARIANT_OUTPUT_DIR "${MISTY_PLUGIN_OUTPUT_DIR}/${MISTY_PLUGIN_VARIANT_DIR}")
set(MISTY_PREVIEW_MANAGER_LIBRARY_NAME "preview_manager${CMAKE_SHARED_LIBRARY_SUFFIX}")
set(MISTY_PREVIEW_MANAGER_VARIANT_LIBRARY "${MISTY_PLUGIN_VARIANT_DIR}/${MISTY_PREVIEW_MANAGER_LIBRARY_NAME}")

add_library(preview_manager MODULE
    "${CMAKE_CURRENT_SOURCE_DIR}/preview_manager/plugin.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/preview_manager/stb_impl.cpp"
)
set_target_properties(preview_manager PROPERTIES
    PREFIX ""
    OUTPUT_NAME "preview_manager"
    SUFFIX "${CMAKE_SHARED_LIBRARY_SUFFIX}"
    LIBRARY_OUTPUT_DIRECTORY "${MISTY_PLUGIN_VARIANT_OUTPUT_DIR}"
    RUNTIME_OUTPUT_DIRECTORY "${MISTY_PLUGIN_VARIANT_OUTPUT_DIR}"
)
target_include_directories(preview_manager
    PRIVATE
        "${CMAKE_SOURCE_DIR}/src"
        "${CMAKE_SOURCE_DIR}/vendor/stb"
)
target_compile_definitions(preview_manager PRIVATE MISTY_PLUGIN_BUILD=1)

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/preview_manager/manifest.json")
    add_custom_target(preview_manager_manifest ALL
        COMMAND ${CMAKE_COMMAND} -E make_directory "${MISTY_PLUGIN_OUTPUT_DIR}"
        COMMAND ${CMAKE_COMMAND} -E copy
            "${CMAKE_CURRENT_SOURCE_DIR}/preview_manager/manifest.json"
            "${MISTY_PLUGIN_OUTPUT_DIR}/manifest.json"
        DEPENDS preview_manager
    )
endif()

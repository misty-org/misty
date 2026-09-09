# App SDK dependency audit

Conservative symbol reachability from ten official app entries and six catalog extensions, including lazy imports. Referenced stores/objects include all of their methods. Dynamic calls are retained for manual classification; this is an inventory, not proof of runtime coverage.

Regenerate with `node scripts/audit-app-sdk.mjs`.

| App | Catalog desktop runtime | Reachable source files | Native commands | Event call sites | Server/network call sites |
| --- | --- | ---: | ---: | ---: | ---: |
| chat | embedded | 388 | 147 | 5 | 109 |
| journal | downloaded | 63 | 0 | 0 | 0 |
| planner | downloaded | 84 | 0 | 0 | 0 |
| library | embedded | 428 | 146 | 5 | 110 |
| inbox | downloaded | 44 | 0 | 0 | 0 |
| agents | embedded | 151 | 19 | 0 | 155 |
| files | embedded | 342 | 145 | 5 | 109 |
| browser | downloaded | 18 | 0 | 0 | 0 |
| code | embedded | 387 | 160 | 8 | 125 |
| terminal | downloaded | 16 | 0 | 0 | 0 |
| quick_convert | native extension | 3 | 0 | 0 | 0 |
| themes | native extension | 2 | 0 | 0 | 3 |
| storage_report | native extension | 3 | 0 | 0 | 0 |
| image_optimizer | native extension | 3 | 0 | 0 | 0 |
| backups | native extension | 2 | 0 | 0 | 0 |
| ytdlp | native extension | 2 | 0 | 0 | 0 |

App entry sources can be candidates ahead of the normal catalog. A zero native-import count does not establish that the catalog has migrated or that shared host integration bridges have been verified.

The audit found **165 distinct native commands (including finite string unions)**. The existing SDK has **202 named RPC methods**, plus generated storage/domain methods. Native command names and SDK method names are different contracts; matching counts do not demonstrate coverage.

## Native command inventory

| Native command | Apps reaching it |
| --- | --- |
| `agents_device_identity_load` | agents |
| `agents_device_identity_store` | agents |
| `agents_device_snapshot` | agents |
| `android_all_files_access_status` | chat, library, files, code |
| `android_grant_local_folder` | chat, library, files, code |
| `android_open_all_files_access_settings` | chat, library, files, code |
| `app_snapshot` | chat, library, agents, files, code |
| `archive_create` | chat, library, files, code |
| `archive_extract` | chat, library, files, code |
| `archive_list` | chat, library, files, code |
| `browser_shortcuts_update` | chat, library, agents, files, code |
| `check_system` | chat, library, files, code |
| `clipboard_apply_shared` | chat, library, files, code |
| `clipboard_publish_image_bytes` | chat, library, files, code |
| `clipboard_publish_shared` | chat, library, files, code |
| `clipboard_set_local` | chat, library, files, code |
| `clipboard_shared_image_bytes` | chat, library, files, code |
| `clipboard_snapshot` | chat, library, files, code |
| `clipboard_write_file_bytes` | chat, library |
| `clipboard_write_file_refs` | chat, library, files, code |
| `code_create_file` | code |
| `code_create_folder` | code |
| `code_delete_path` | code |
| `code_find_in_files` | code |
| `code_lsp_send` | code |
| `code_lsp_start` | code |
| `code_lsp_stop` | code |
| `code_read_text_file` | code |
| `code_rename_path` | code |
| `code_stop_watch` | code |
| `code_walk_files` | code |
| `code_watch_dir` | code |
| `code_write_text_file` | code |
| `coding_ai_read_api_key` | code |
| `coding_ai_write_api_key` | code |
| `compare_apply_text_merge` | chat, library, files, code |
| `compare_files` | chat, library, files, code |
| `compare_folders` | chat, library, files, code |
| `connected_devices_media_url` | chat, library, files, code |
| `connected_devices_prepare_clipboard_files` | chat, library, files, code |
| `connected_devices_roots` | chat, library, files, code |
| `connected_devices_subscribe_directory` | chat, library, files, code |
| `devices_snapshot` | chat, library, files, code |
| `devices_unmount` | chat, library, files, code |
| `duplicates_cancel` | chat, library, files, code |
| `duplicates_hash_remote_candidates` | chat, library, files, code |
| `duplicates_scan` | chat, library, files, code |
| `ensure_local_access_token` | chat, library, files, code |
| `explorer_calculate_directory_sizes` | chat, library, files, code |
| `explorer_cancel_drag_preparation` | chat, library, files, code |
| `explorer_directory_size_snapshot` | chat, library, files, code |
| `explorer_generate_image_thumbnail` | chat, library, files, code |
| `explorer_library_record_last_opened` | chat, library, files, code |
| `explorer_library_record_recent` | chat, library, files, code |
| `explorer_library_snapshot` | chat, library, files, code |
| `explorer_list_directory` | chat, library, files, code |
| `explorer_open_path` | chat, library, files, code |
| `explorer_open_with` | chat, library, files, code |
| `explorer_path_is_directory` | chat, library, files, code |
| `explorer_prepare_drag_items` | chat, library, files, code |
| `explorer_prepare_open_item` | chat, library, files, code |
| `explorer_preview_item` | chat, library, files, code |
| `explorer_queue_create_item` | chat, library, files, code |
| `explorer_queue_delete_items` | chat, library, files, code |
| `explorer_queue_paste_items` | chat, library, files, code |
| `explorer_queue_rename_item` | chat, library, files, code |
| `explorer_queue_rename_items` | chat, library, files, code |
| `explorer_save_preview_item` | chat, library, files, code |
| `extension_command_run` | chat, library, files, code |
| `fetch_misty_releases` | chat, library, files, code |
| `file_metadata_snapshot` | chat, library, files, code |
| `file_tools_checksum` | chat, library, files, code |
| `file_tools_create_symlink` | chat, library, files, code |
| `file_tools_read_symlink` | chat, library, files, code |
| `install_misty_template` | chat, library, files, code |
| `launch_misty` | chat, library, files, code |
| `media_search_complete_legacy_adoption` | chat, library, files, code |
| `media_search_resolve_assets` | chat, library, files, code |
| `media_search_snapshot` | chat, library, files, code |
| `mini_app_close` | chat, library, files, code |
| `mini_app_context` | chat, library, files, code |
| `mini_app_device_call` | chat, library, files, code |
| `mini_app_layout` | chat, library, files, code |
| `mini_app_open` | chat, library, files, code |
| `mini_app_permission_decide` | chat, library, files, code |
| `mini_app_permission_list` | chat, library, files, code |
| `mini_app_permission_status` | chat, library, files, code |
| `mini_app_post` | chat, library, files, code |
| `mini_app_reply` | chat, library, files, code |
| `mini_widget_open` | chat, library, files, code |
| `misty_template_status` | chat, library, files, code |
| `mobile_cache_read` | chat, library, agents, files, code |
| `mobile_cache_remove` | chat |
| `mobile_cache_write` | chat, library, agents, files, code |
| `open_terminal_at_path` | chat, library, files, code |
| `operation_queue_cancel` | chat, library, files, code |
| `operation_queue_cancel_batch` | chat, library, files, code |
| `operation_queue_clear_terminal` | chat, library, files, code |
| `operation_queue_pause` | chat, library, files, code |
| `operation_queue_pause_all` | chat, library, files, code |
| `operation_queue_pause_batch` | chat, library, files, code |
| `operation_queue_redo` | chat, library, files, code |
| `operation_queue_resolve_conflict` | chat, library, files, code |
| `operation_queue_resume` | chat, library, files, code |
| `operation_queue_resume_all` | chat, library, files, code |
| `operation_queue_resume_batch` | chat, library, files, code |
| `operation_queue_retry` | chat, library, files, code |
| `operation_queue_retry_transfer` | chat, library, files, code |
| `operation_queue_set_bandwidth_limit` | chat, library, files, code |
| `operation_queue_set_transfer_profile` | chat, library, files, code |
| `operation_queue_snapshot` | chat, library, files, code |
| `operation_queue_undo` | chat, library, files, code |
| `plugin_command_run` | chat, library, files, code |
| `plugin_commands_snapshot` | chat, library, files, code |
| `plugin_panel_render` | chat, library, files, code |
| `probe_paths` | chat, library, files, code |
| `providers_config_paths` | chat, library, files, code |
| `providers_disconnect_remote` | chat, library, files, code |
| `providers_import_cloud_connection` | chat, library, files, code |
| `providers_job_status` | chat, library, files, code |
| `providers_refresh` | chat, library, files, code |
| `providers_save_remote` | chat, library, files, code |
| `providers_select_remote` | chat, library, files, code |
| `providers_snapshot` | chat, library, files, code |
| `providers_test_remote` | chat, library, files, code |
| `providers_verify_result` | chat, library, files, code |
| `providers_verify_start` | chat, library, files, code |
| `restart_misty` | chat, library, files, code |
| `restart_misty_app` | chat, library, files, code |
| `save_authenticated_user` | chat, library, files, code |
| `save_verified_license` | chat, library, files, code |
| `saved_searches_delete` | chat, library, files, code |
| `saved_searches_save` | chat, library, files, code |
| `saved_searches_snapshot` | chat, library, files, code |
| `search_cancel_scan` | chat, library, files, code |
| `search_get_status` | chat, library, files, code |
| `search_init` | chat, library, files, code |
| `search_query` | chat, library, files, code |
| `search_start_scan` | chat, library, files, code |
| `self_host_entitlement_load` | chat, library, agents, files, code |
| `settings_apply_launch_on_login` | chat, library, agents, files, code |
| `settings_launch_on_login_snapshot` | chat, library, agents, files, code |
| `settings_open_with_associations` | chat, library, agents, files, code |
| `settings_remove_open_with_association` | chat, library, agents, files, code |
| `settings_save` | chat, library, agents, files, code |
| `settings_snapshot` | chat, library, agents, files, code |
| `shortcuts_reassign` | chat, library, agents, files, code |
| `shortcuts_reset` | chat, library, agents, files, code |
| `shortcuts_snapshot` | chat, library, agents, files, code |
| `shortcuts_update` | chat, library, agents, files, code |
| `sign_out_misty` | chat, library, files, code |
| `smart_library_apply_results` | chat, library, files, code |
| `smart_library_assets_page` | chat, library, files, code |
| `smart_library_delete` | chat, library, files, code |
| `smart_library_import_files` | chat, library, files, code |
| `smart_library_preflight_import` | chat, library, files, code |
| `smart_library_prepare_previews` | chat, library, files, code |
| `smart_library_resolve_assets` | chat, library, files, code |
| `smart_library_scan` | chat, library, files, code |
| `smart_library_set_server_folder_id` | chat, library, files, code |
| `smart_library_snapshot` | chat, library, files, code |
| `telemetry_set_error_reporting_enabled` | chat, library, agents, files, code |
| `transfers_delete_all` | chat, library, files, code |
| `transfers_delete_selected` | chat, library, files, code |
| `transfers_snapshot` | chat, library, files, code |

Exact source locations, argument expressions, dynamic requests, and reachable files are recorded in [sdk-audit.json](./sdk-audit.json).

import json
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'docs/architecture/app-platform';audit=json.loads((p/'sdk-audit.json').read_text())
rows=[]
for method in audit['nativeMethods']:
 c=method['command']
 if c in {'terminal_create','terminal_write','terminal_resize','terminal_kill','terminal_ssh_environments','terminal_ssh_preflight','terminal_ssh_trust_host'}:
  status='adapter-available';domain='terminal';action='Typed, scoped Terminal SDK adapter is implemented and has passed macOS PTY verification. Replace any remaining direct caller with that adapter; its availability does not imply this caller has migrated.'
 elif c in {'agents_device_identity_load','agents_device_identity_store','connected_devices_initialize','sign_out_misty','providers_config_paths','providers_save_remote','providers_import_cloud_connection','browser_agent_grant_register','browser_agent_grant_revoke','telemetry_set_error_reporting_enabled'}:
  status='host-only';domain='identity/host configuration';action='Keep credentials, account lifecycle, device identity and agent grant authority in the host; expose reviewed capability operations or host-owned configuration UI only.'
 elif any(x in c for x in ('access_token','api_key','authenticated_user','verified_license','self_host_entitlement')):
  status='host-only'; domain='identity'; action='Replace with a credential-free service; never export secrets.'
 elif c.startswith(('mini_app_','mini_widget_','plugin_','extension_','install_','restart_','launch_misty','fetch_misty_releases','misty_template_','check_system')):
  status='host-only';domain='workspace';action='Use SDK app/panel launch or host UI; do not delegate runtime administration.'
 elif c.startswith(('providers_','connected_devices_')):
  status='adapter-needed';domain='connections';action='Use owned connection handles and credential-free snapshots; host owns device/service authentication.'
 elif c.startswith(('settings_','shortcuts_','browser_shortcuts_','theme_','app_snapshot','mobile_cache_')):
  status='adapter-needed';domain='context/settings';action='Provide scoped settings/context/cache snapshots and SDK updates; preserve host ownership.'
 else:
  status='contract-needed';domain=c.split('_')[0];action='Define typed method, capability, validation, ownership and teardown; verify native implementation.'
 rows.append(dict(method,status=status,domain=domain,action=action))
(p/'native-coverage.json').write_text(json.dumps({'schemaVersion':1,'note':'Classification is a migration plan, not implementation/verification status. No native command is auto-exposed based on this file.','methods':rows},indent=2)+'\n')
md=['# Native SDK migration coverage','','This inventory is deliberately conservative. Shared pickers and imported stores make some app columns broader than their runtime needs. Method implementation and macOS verification remain separate gates.','','| Existing native command | Decision | Replacement domain |','| --- | --- | --- |']
for r in rows:md.append(f"| `{r['command']}` | {r['status']} | {r['domain']} |")
(p/'native-coverage.md').write_text('\n'.join(md)+'\n')

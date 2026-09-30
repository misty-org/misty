import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@/styles/styles.css';
import '@/styles/App.css';
import { OfficialAppAuthProvider } from '@/features/auth';
import { SettingsWorkspace } from '@/features/settings/SettingsPage';
import { BrowserSyncBadge } from '@/features/browser-workspace/BrowserSyncBadge';
import { useSettingsProfiles } from '@/features/settings/profiles/store';
import { useSettingsStore } from '@/features/settings/store/useSettingsStore';
import { useWorkspaceRecoveryState } from '@/features/workspace/nativeWorkspaceRecovery';
import { useBrowserSyncStore } from '@/features/browser-workspace/store';
import { syncSession } from '@/features/browser-workspace/syncTestFixtures';
let native = syncSession();
window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
  if(command==='browser_sync_state') return structuredClone(native);
  if(command==='browser_sync_availability')return {local:true,remote:true};
  if(command==='browser_sync_rename_device'){native.devices.find(d=>d.device_id===args.deviceId).display_name=args.name;return;}
  if(command==='browser_sync_control_device'){native.devices.find(d=>d.device_id===args.deviceId).full_sync=args.fullSync;return 'request';}
  if(command==='browser_sync_lock'){native=null;return;}
  if(command==='browser_sync_connect'){native=syncSession();return structuredClone(native);}
  if(command==='browser_sync_generate_secret')return 'A'.repeat(43)+'=';
  if(command==='browser_sync_claim'){native.sync.driving_workspace=args.treeId;return;}
  return null;
}};
useSettingsStore.setState({activeSection:'sync',settings:{document:{},revision:1},working:false,updateSetting:(section,key,value)=>useSettingsStore.setState(s=>({settings:{...s.settings,document:{...s.settings.document,[section]:{...s.settings.document[section],[key]:value}}}}))});
useSettingsProfiles.setState({accountId:'a',ready:true,syncing:false,error:null,state:{version:2,profile:{id:'account',name:'Settings',values:{},revision:1,schemaVersion:1},seed:{},outbox:[]},refresh:async()=>{},edit:async()=>{}});
useWorkspaceRecoveryState.setState({accountId:'a',ready:true,usable:true,issue:null});
useBrowserSyncStore.setState({session:native,issue:null,connecting:false});
function Review(){const [state,setState]=useState('ready');return <MemoryRouter><OfficialAppAuthProvider user={{id:'a',name:'Preview user',email:'preview@example.test'}}>
  <header style={{height:56,display:'flex',alignItems:'center',gap:24,padding:'0 24px',color:'#e0e0e0',background:'#131313',borderBottom:'1px solid #333',fontSize:13}}><strong>Sync implementation review</strong><span style={{color:'#999'}}>Actual components · sample data</span><button onClick={()=>{const next=state==='ready'?'offline':'ready';setState(next);native=syncSession();native.status.phase=next;useBrowserSyncStore.setState({session:structuredClone(native)})}}>Preview {state==='ready'?'offline':'healthy'}</button><button onClick={()=>{native=syncSession();useBrowserSyncStore.setState({session:native,issue:"sync_device_forbidden",locked:null})}}>Preview reconnect</button><BrowserSyncBadge accountId="a" onOpenSettings={()=>useSettingsStore.getState().setActiveSection('sync')}/></header>
  <div style={{height:'calc(100vh - 56px)'}}><SettingsWorkspace presentation="overlay" onClose={()=>{}} /></div>
</OfficialAppAuthProvider></MemoryRouter>}
createRoot(document.getElementById('root')!).render(<Review/>);

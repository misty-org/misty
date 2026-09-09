// Actual Discover component with illustrative catalog state; no account writes.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DiscoverBrowser } from "/src/features/marketplace/components/DiscoverBrowser";
import "/src/styles/styles.css";
const catalog = await fetch("/official-apps/catalog.json").then(r => r.json()).then(x => x.apps);
function Preview() {
  const [selected, select] = useState("");
  const installations = catalog.filter(a => !["chat", "journal", "code"].includes(a.id)).map(a => ({app_id:a.id,state:"installed",installed_version:a.version,permission_version:a.id === "planner"?0:a.permission_version,granted_scopes:a.scopes,pinned:false,pin_rank:0,installed_at:"2026-09-05",updated_at:"2026-09-05"}));
  installations.push({app_id:"journal",state:"recoverable",granted_scopes:[],permission_version:0});
  return <DiscoverBrowser catalog={catalog} installations={installations} loading={false} ready={true} error="" actionAppId="" mobile={false} selectedAppId={selected} onSelect={select} onRefresh={()=>{}} onInstall={()=>select("")} onOpen={()=>{}} onRemove={()=>{}}/>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);

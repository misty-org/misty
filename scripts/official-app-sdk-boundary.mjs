/** Reject legacy host dependencies instead of shipping a fake SDK migration. */
export function officialAppSDKBoundary() {
  return {
    name: 'misty-official-app-sdk-boundary',
    generateBundle(_options, bundle) {
      const modules = new Set(Object.values(bundle).flatMap(item => item.type === 'chunk'
        ? Object.entries(item.modules).filter(([,detail]) => detail.renderedLength > 0).map(([id])=>id)
        : []));
      const forbidden = [...modules].filter(id =>
        /\/node_modules\/@tauri-apps\//.test(id) ||
        /\/src\/native\/(?!contracts\/)/.test(id) ||
        /\/src\/features\/auth\/(?:AuthContext|authSession|store\/useAuthTokenStore)\./.test(id) ||
        id.includes('misty-desktop-service:'));
      if (forbidden.length) this.error(`SDK migration incomplete: downloaded apps still include host-only services:\n${forbidden.slice(0,30).join('\n')}`);
    },
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { rollup } from "rollup";
import { componentFrameworkGlobals, officialAppComponentFactory } from "./official-app-component-factory.mjs";

async function buildComponent(entry, extra = {}, output = {}, framework = false, runtime = false) {
  const sources = { entry, ...extra };
  const build = await rollup({
    input: "entry",
    external: framework ? Object.keys(componentFrameworkGlobals) : [],
    plugins: [{
      name: "fixture",
      resolveId: (id) => id in sources ? id : null,
      load: (id) => sources[id],
    }, officialAppComponentFactory("terminal", {framework, runtime})],
  });
  try {
    return await build.generate({
      globals: componentFrameworkGlobals,
      format: "iife", name: "MistyComponentBundle", inlineDynamicImports: true,
      ...output,
    });
  } finally { await build.close(); }
}

test("one cached import keeps eager and lazy application state separate per mount", async () => {
  const { output } = await buildComponent(`
    let currentSDK;
    let currentRoot;
    let updates = 0;
    export default { appId: "terminal", protocol: 2, async mount({root, misty, context}) {
      currentSDK = misty;
      currentRoot = root;
      const state = await import("state");
      root.initial = ++state.store.mounts;
      const update = (context) => {
        currentRoot.value = ++updates;
        currentSDK.request(context.route);
      };
      update(context);
      return { update, unmount() { currentSDK.request("closed"); currentRoot.closed = true; } };
    }};
  `, { state: "export const store = { mounts: 0 };" });
  const url = `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`;
  const { default: definition } = await import(url);
  assert.equal((await import(url)).default, definition);
  assert.ok(Object.isFrozen(definition));
  const first = {}, second = {};
  const firstCalls = [], secondCalls = [];
  const a = await definition.mount({root: first, misty: { request: (v) => firstCalls.push(v) }, context: {route:"first"}});
  const b = await definition.mount({root: second, misty: { request: (v) => secondCalls.push(v) }, context: {route:"second"}});
  a.update({route:"first-update"});
  a.unmount();
  b.update({route:"second-update"});
  assert.deepEqual(first, {initial:1,value:2,closed:true});
  assert.deepEqual(second, {initial:1,value:2});
  assert.deepEqual(firstCalls, ["first", "first-update", "closed"]);
  assert.deepEqual(secondCalls, ["second", "second-update"]);
  b.unmount();
});

test("importing the package does not execute application initialization", async () => {
  const { output } = await buildComponent(`
    throw new Error("App initialization runs only at mount");
    export default {appId:"terminal", protocol:2, mount(){}};
  `);
  const { default: definition } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
  assert.throws(() => definition.mount({}), /only at mount/);
});

test("rejects legacy exports and output that would share module state", async () => {
  const { output } = await buildComponent('export default {appId:"terminal", apiVersion:1, Component(){}}');
  const { default: definition } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
  assert.throws(() => definition.mount({}), /incompatible component export/);
  await assert.rejects(buildComponent('export default {};', {}, {format:"es"}), /self-contained/);
});


test("shares only injected rendering libraries while retaining independent app stores", async () => {
  const {output} = await buildComponent(`
    import * as React from "react";
    let local = 0;
    export default {appId:"terminal", protocol:2, mount({root}) {
      root.local = ++local; root.framework = React.version;
      return { update(){}, unmount(){} };
    }};
  `, {}, {}, true);
  const {default: definition} = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
  const libraries = {react:{version:"19.2.8"}, reactDomClient:{createRoot(){}}};
  const a = {}, b = {};
  definition.mount({root:a, libraries}); definition.mount({root:b, libraries});
  assert.deepEqual(a, {local:1, framework:"19.2.8"});
  assert.deepEqual(b, a);
  assert.throws(() => definition.mount({root:{}}), /React 19/);
  assert.throws(() => definition.mount({root:{}, libraries:{...libraries, react:{version:"18.3.1"}}}), /React 19/);
});

test("native library adapters retain their own SDK and abort after unmount or failed mounting", async () => {
  const { output } = await buildComponent(`
    export default {
      appId: "terminal", protocol: 2,
      mount(input) {
        input.root.read = () => {
          if (MistyComponentRuntime.signal.aborted) throw new Error("closed");
          return MistyComponentRuntime.sdk.clipboard.readText();
        };
        if (input.fail) throw new Error("mount failed");
        return { update() {}, unmount() {} };
      }
    };
  `, {}, {}, false, true);
  const definition = (await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`)).default;
  const a = {}, b = {}, failed = {};
  const sdk = (value) => ({ clipboard: { readText: () => value } });
  const first = await definition.mount({ root: a, misty: sdk("A") });
  const second = await definition.mount({ root: b, misty: sdk("B") });
  assert.equal(a.read(), "A"); assert.equal(b.read(), "B");
  await first.unmount();
  assert.throws(() => a.read(), /closed/);
  assert.equal(b.read(), "B");
  assert.throws(() => definition.mount({ root: failed, misty: sdk("F"), fail: true }), /mount failed/);
  assert.throws(() => failed.read(), /closed/);
  await second.unmount();
});

test("collaborative mounts share Yjs constructors while owning separate documents", async () => {
  const Y = await import("yjs");
  const {output} = await buildComponent(`
    import {Doc} from "yjs";
    const document = new Doc();
    export default {appId:"terminal", protocol:2, mount({root}) {
      root.document = document;
      return {update(){}, unmount(){document.destroy();}};
    }};
  `, {}, {}, true);
  const definition = (await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`)).default;
  const libraries = {react:{version:"19.2.8"}, reactDomClient:{createRoot(){}}, yjs:Y};
  const a = {}, b = {};
  const first = definition.mount({root:a, libraries});
  const second = definition.mount({root:b, libraries});
  assert.ok(a.document instanceof Y.Doc);
  assert.ok(b.document instanceof Y.Doc);
  assert.notEqual(a.document, b.document);
  a.document.getMap("private").set("account", "A");
  assert.equal(b.document.getMap("private").size, 0);
  first.unmount(); second.unmount();
  assert.throws(() => definition.mount({root:{}, libraries:{...libraries, yjs:undefined}}), /Yjs 13/);
});

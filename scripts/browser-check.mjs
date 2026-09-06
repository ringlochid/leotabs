// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const chromeMode = process.argv.includes('--chrome');
let extensionPath = path.resolve(
  process.argv.find((arg) => arg.startsWith('--extension='))?.slice(12) || 'extension',
);
const root = path.resolve('.'),
  out = path.join(root, 'output', (chromeMode ? 'chrome-' : 'edge-') + Date.now());
await fs.mkdir(out, { recursive: true });
if (
  process.argv.includes('--native-bookmarks') ||
  process.argv.includes('--connections') ||
  process.argv.includes('--history-access')
) {
  const fixture = path.join(out, 'granted-access-fixture');
  await fs.cp(extensionPath, fixture, { recursive: true });
  extensionPath = fixture;
  const manifest = JSON.parse(await fs.readFile(path.join(fixture, 'manifest.json'), 'utf8'));
  if (process.argv.includes('--native-bookmarks')) {
    manifest.permissions.push('bookmarks');
    manifest.optional_permissions = manifest.optional_permissions.filter((p) => p !== 'bookmarks');
  }
  if (process.argv.includes('--history-access')) {
    manifest.permissions.push('history');
    manifest.optional_permissions = manifest.optional_permissions.filter((p) => p !== 'history');
  }
  if (process.argv.includes('--connections'))
    manifest.host_permissions = ['http://127.0.0.1/*', 'https://api.notion.com/*'];
  await fs.writeFile(path.join(fixture, 'manifest.json'), JSON.stringify(manifest, null, 2));
}
const port = 22000 + Math.floor(Math.random() * 1000),
  hits = [],
  notionCalls = [];
const server = http.createServer(async (req, res) => {
  hits.push(req.url);
  if (req.url === '/identity-icon.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public,max-age=3600' });
    return res.end(await fs.readFile(path.join(root, 'tests/fixtures/site-icon.png')));
  }
  if (req.url.startsWith('/v1/')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    notionCalls.push({ path: req.url, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify(
        req.url === '/v1/pages'
          ? { id: 'c'.repeat(32), url: 'https://app.notion.com/p/' + 'c'.repeat(32) }
          : { results: body.children },
      ),
    );
  }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  res.end(
    `<!doctype html>${process.argv.includes('--parked-identity') ? '<link rel="icon" href="/identity-icon.png">' : ''}<title>${req.url.includes('research') ? 'Research paper' : 'Project brief'}</title><style>body{font:24px system-ui;padding:50px;background:#f3f5ef}h1{color:#426b61}</style><h1>${req.url}</h1><p>Local integration-test page.</p>`,
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--connections')) {
  // Only this isolated copy changes transport origin. No request can escape to
  // a hosted Notion account, even if the browser restarts its worker.
  const file = path.join(extensionPath, 'lib', 'notion.js'),
    source = await fs.readFile(file, 'utf8');
  assert.equal(source.split('https://api.notion.com').length - 1, 2);
  await fs.writeFile(file, source.replaceAll('https://api.notion.com', origin));
}
if (process.argv.includes('--group-cleanup') && process.argv.includes('--native-icons')) {
  await fs.mkdir(path.join(out, 'profile', 'Default'), { recursive: true });
  await fs.writeFile(
    path.join(out, 'profile', 'Default', 'Preferences'),
    JSON.stringify({ bookmark_bar: { show_on_all_tabs: true } }),
  );
}
const proc = spawn(
  chromeMode
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  [
    '--enable-unsafe-extension-debugging',
    ...(process.argv.includes('--native-icons')
      ? ['--window-position=0,0', '--window-size=1200,850']
      : ['--headless=new']),
    '--no-first-run',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(out, 'profile')}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    'about:blank',
  ].filter(
    (arg) =>
      !chromeMode ||
      (!arg.startsWith('--disable-extensions-except=') && !arg.startsWith('--load-extension=')),
  ),
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
);
let stderr = '';
proc.stderr.on('data', (b) => (stderr += b.toString()));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = [];
async function targets() {
  return (await fetch(`http://localhost:${port}/json/list`)).json();
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data),
      p = pending.get(m.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') events.push(m.params);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id,
        timer = setTimeout(() => {
          pending.delete(n);
          reject(new Error('Timed out: ' + method));
        }, 45000);
      pending.set(n, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }).catch((error) => {
      throw new Error(error.message + ' in ' + expression.slice(0, 220));
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const client = { ws, send, evaluate, events };
  clients.push(client);
  return client;
}
const results = [];
let browserClient, extensionClient;
try {
  let available, loadedId;
  if (chromeMode) {
    let version;
    for (let n = 0; n < 80; n++) {
      try {
        version = await (await fetch('http://localhost:' + port + '/json/version')).json();
        break;
      } catch {}
      await delay(100);
    }
    if (!version) throw new Error('Chrome did not start');
    browserClient = await connect(version.webSocketDebuggerUrl);
    loadedId = (
      await browserClient.send('Extensions.loadUnpacked', {
        path: extensionPath,
        enableInIncognito: false,
      })
    ).id;
    console.log(await browserClient.send('Extensions.getExtensions'));
  }
  for (let n = 0; n < 80; n++) {
    try {
      available = await targets();
      if (
        chromeMode ||
        available.some((t) => t.type === 'service_worker' && t.url.includes('background.js'))
      )
        break;
    } catch {}
    await delay(100);
  }
  const worker = available?.find(
    (t) => t.type === 'service_worker' && t.url.includes('background.js'),
  );
  if (!worker && !loadedId)
    throw new Error('Extension worker not loaded. Targets: ' + JSON.stringify(available));
  await fs.writeFile(path.join(out, 'initial-targets.json'), JSON.stringify(available, null, 2));
  const extensionOrigin = loadedId
    ? 'chrome-extension://' + loadedId
    : worker.url.slice(0, worker.url.lastIndexOf('/'));
  const app = await connect(available.find((t) => t.type === 'page').webSocketDebuggerUrl);
  browserClient = app;
  await app.send('Runtime.enable');
  await app.send('Page.navigate', { url: extensionOrigin + '/app.html' });
  await delay(500);
  const rpc = (action, data = {}) =>
    app.evaluate(
      `chrome.runtime.sendMessage(${JSON.stringify({ action, data })}).then(r=>{if(!r.ok)throw Error(r.error);return r.value})`,
    );
  for (
    let i = 0;
    i < 80 && !(await app.evaluate('!!document.querySelector("#spaces .active")'));
    i++
  )
    await delay(100);
  assert.equal(
    await app.evaluate(`document.querySelector('#spaces .active').textContent`),
    'My space',
  );
  assert(!(await app.evaluate(`document.querySelector('#toast')?.textContent?.includes('Error')`)));
  results.push('Real extension page and worker load');
  const tabA = await app.evaluate(
    `chrome.tabs.create({url:${JSON.stringify(origin + '/brief')},active:false})`,
  );
  const tabB = await app.evaluate(
    `chrome.tabs.create({url:${JSON.stringify(origin + '/research')},active:false})`,
  );
  const pin = await app.evaluate(
    `chrome.tabs.create({url:${JSON.stringify(origin + '/pinned')},pinned:true,active:false})`,
  );
  for (let i = 0; i < 100; i++) {
    if (
      await app.evaluate(
        `chrome.tabs.query({}).then(t=>[${tabA.id},${tabB.id},${pin.id}].every(id=>t.some(x=>x.id===id&&x.status==='complete'&&!x.pendingUrl)))`,
      )
    )
      break;
    await delay(100);
  }
  await app.evaluate(
    `chrome.tabs.group({tabIds:[${tabA.id},${tabB.id}]}).then(id=>chrome.tabGroups.update(id,{title:'Research',color:'green'}))`,
  );
  const saved = await rpc('save', {
    tabIds: [tabA.id, tabB.id, pin.id],
    name: 'Research',
    close: true,
  });
  assert.equal(saved.closed.length, 2);
  assert.equal((await rpc('load')).state.collections[0].groups[0].name, 'Research');
  assert((await app.evaluate('chrome.tabs.query({})')).some((t) => t.id === pin.id));
  results.push('Durable stash closes two captured pages, preserves native group and pinned page');
  const at = hits.length;
  const c = (await rpc('load')).state.collections[0];
  const resumed = await rpc('resume', {
    collectionId: c.id,
    windowId: tabA.windowId,
    deferred: true,
  });
  assert.equal(resumed.created.length, 2);
  await delay(600);
  assert(
    !hits.slice(at).some((url) => url === '/brief' || url === '/research'),
    'Deferred resume must not request either destination page',
  );
  await fs.writeFile(
    path.join(out, 'resume-diagnostic.json'),
    JSON.stringify({ resumed, tabs: await app.evaluate('chrome.tabs.query({})') }, null, 2),
  );
  const parked = await app.evaluate(`chrome.tabs.get(${resumed.created[0]})`);
  assert(parked.url.startsWith(extensionOrigin + '/parked.html'));
  results.push('Deferred resume makes zero destination website requests');
  if (process.argv.includes('--parked-identity')) {
    const identities = await Promise.all(
      resumed.created.map((id) => app.evaluate(`chrome.tabs.get(${id})`)),
    );
    assert.deepEqual(
      identities.map((t) => t.title),
      c.links.map((l) => l.title),
    );
    for (const t of identities) {
      assert(!t.discarded, 'Local placeholder stays alive so the native tab icon can settle');
      assert(t.favIconUrl.startsWith('data:image/png;base64,'));
    }
    assert(
      !hits.slice(at).includes('/identity-icon.png'),
      'Icons come from the local browser cache',
    );
    const cachedIcon = await app.evaluate(
      `(async()=>{const url=new URL(chrome.runtime.getURL('_favicon/'));url.searchParams.set('pageUrl',${JSON.stringify(c.links[0].url)});url.searchParams.set('size','32');const bitmap=await createImageBitmap(await (await fetch(url)).blob());const canvas=document.createElement('canvas');canvas.width=canvas.height=32;canvas.getContext('2d').drawImage(bitmap,0,0,32,32);bitmap.close();return canvas.toDataURL('image/png');})()`,
    );
    assert.equal(
      identities[0].favIconUrl,
      cachedIcon,
      'Suspended tab preserves the cached site icon',
    );
    if (process.argv.includes('--native-icons')) {
      await app.send('Page.bringToFront');
      console.log('NATIVE ICON INSPECTION', out);
      await fs.writeFile(
        path.join(out, 'native-inspection.json'),
        JSON.stringify({ port, extensionOrigin, identities }, null, 2),
      );
      // The external inspection creates this file once its native screenshot is saved.
      const inspectionDeadline = Date.now() + 180000;
      while (Date.now() < inspectionDeadline) {
        try {
          await fs.access(path.join(out, 'inspection-done'));
          break;
        } catch {}
        await delay(500);
      }
    }
    // Simulate a discarded legacy page, then run the same upgrade repair function.
    const legacy = identities[1];
    await app.evaluate(`chrome.tabs.reload(${legacy.id})`);
    let legacyTarget;
    for (let i = 0; i < 30; i++) {
      legacyTarget = (await targets()).find((t) => t.url === legacy.url);
      if (legacyTarget) break;
      await delay(100);
    }
    assert(legacyTarget, 'Reloaded local placeholder has a browser target');
    const page = await connect(legacyTarget.webSocketDebuggerUrl);
    await delay(400);
    await page.evaluate(
      `document.title='Parked page · Neo';document.querySelectorAll('link[rel=icon]').forEach(n=>n.remove());`,
    );
    await delay(150);
    await app.evaluate(`chrome.tabs.discard(${legacy.id})`);
    await app.evaluate(
      `Promise.all([import(chrome.runtime.getURL('lib/parked.js')),import(chrome.runtime.getURL('lib/db.js'))]).then(([m,db])=>m.repairParkedTabs(chrome,db))`,
    );
    const repaired = await app.evaluate(
      `chrome.tabs.query({}).then(tabs=>tabs.find(t=>t.url===${JSON.stringify(legacy.url)}))`,
    );
    assert.equal(repaired.title, c.links[1].title);
    assert(repaired.favIconUrl.startsWith('data:image/png;base64,'));
    assert(!repaired.discarded);
    assert(
      !hits
        .slice(at)
        .some((url) => url === '/brief' || url === '/research' || url === '/identity-icon.png'),
    );
    results.push(
      'Deferred tabs retain original titles and distinct cached site icons without immediate discard; legacy discarded tabs repair without destination or favicon network requests',
    );
  }

  await rpc('activate', { tabId: resumed.created[0] });
  for (let i = 0; i < 100 && !hits.slice(at).includes('/brief'); i++) await delay(100);
  assert(hits.slice(at).includes('/brief'));
  results.push('Selecting parked tab loads its destination');
  await app.send('Page.reload');
  await delay(350);
  assert.equal((await rpc('load')).state.collections[0].name, 'Research');
  results.push('Library and recovery persist across page reload');
  const sample = [
    ['Capstone', 'mint'],
    ['Product design', 'blue'],
    ['University', 'peach'],
    ['Reading', 'lavender'],
    ['Weekend plans', 'rose'],
    ['Development', 'teal'],
  ].map(([name, color], i) => ({
    id: 'sample' + i,
    name,
    color,
    note: i < 2 ? 'Next: compare the two approaches.' : '',
    groups: [
      {
        id: 'g' + i,
        name: i % 2 ? 'References' : 'Papers to compare',
        color: 'blue',
        collapsed: true,
      },
    ],
    links: [
      {
        id: 'l' + i + 'a',
        title: i % 2 ? 'Interaction references' : 'Project brief',
        url: origin + '/brief?' + i,
        note: '',
        groupId: null,
      },
      {
        id: 'l' + i + 'b',
        title: i % 2 ? 'Design notes' : 'Experiment tracker',
        url: origin + '/research?' + i,
        note: '',
        groupId: null,
      },
      {
        id: 'l' + i + 'c',
        title: 'Evaluation notes',
        url: origin + '/notes?' + i,
        note: 'Read the summary',
        groupId: 'g' + i,
      },
    ],
  }));
  await rpc('import', { collections: sample });
  for (
    let i = 0;
    i < 100 && !(await app.evaluate('document.querySelectorAll(".collection").length===7'));
    i++
  )
    await delay(100);
  const current = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: current.id });
  for (const [theme, width, height] of [
    ['light', 1440, 1000],
    ['dark', 1440, 1000],
    ['light', 390, 950],
  ]) {
    await rpc('settings', { settings: { theme } });
    for (
      let i = 0;
      i < 100 &&
      !(await app.evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`));
      i++
    )
      await delay(100);
    await app.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(300);
    assert.equal(await app.evaluate('document.documentElement.scrollWidth>innerWidth'), false);
    const shot = await app.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(out, `${theme}-${width}.png`), Buffer.from(shot.data, 'base64'));
  }
  results.push('Both themes and narrow reflow render without horizontal overflow');
  await app.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await app.evaluate(`document.querySelector('#stash-button').click()`);
  await delay(100);
  assert(await app.evaluate(`document.querySelector('#action-popover').matches(':popover-open')`));
  const shot = await app.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(out, 'stash.png'), Buffer.from(shot.data, 'base64'));
  results.push('Anchored stash popover works in extension CSP');
  if (
    chromeMode &&
    !(process.argv.includes('--native-icons') && process.argv.includes('--group-cleanup'))
  ) {
    const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
    extensionClient = await connect(version.webSocketDebuggerUrl);
    await app.evaluate(`document.querySelector('#action-popover').hidePopover()`);
    const checks = await app.evaluate(
      `(()=>{const rows=[...document.querySelectorAll('.tab-row')];rows[0].querySelector('.tab-select').click();rows[2].querySelector('.tab-open').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));return document.querySelectorAll('.tab-row.selected').length;})()`,
    );
    assert.equal(checks, 3);
    results.push('Real sidebar Shift selection spans three displayed rows');
    await rpc('activate', { tabId: pin.id });
    const target = (
      await extensionClient.send('Target.getTargets', {
        filter: [{ type: 'tab' }, { exclude: true }],
      })
    ).targetInfos.find((t) => t.url === origin + '/pinned');
    await extensionClient.send('Extensions.triggerAction', {
      id: loadedId,
      targetId: target.targetId,
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      const active = await app.evaluate('chrome.tabs.query({active:true,lastFocusedWindow:true})');
      if (active[0]?.url === extensionOrigin + '/app.html') break;
      await delay(100);
    }
    assert.equal(
      (await app.evaluate('chrome.tabs.query({active:true,lastFocusedWindow:true})'))[0].url,
      extensionOrigin + '/app.html',
    );
    results.push('Toolbar icon opens the existing library');
    const triggerSwitcher = async (tab, mode = 'switcher') => {
      // CDP exposes toolbar activation but not extension-command dispatch. Use
      // its real activeTab grant, then invoke the same overlay entry module.
      const targetInfo = (
        await extensionClient.send('Target.getTargets', {
          filter: [{ type: 'tab' }, { exclude: true }],
        })
      ).targetInfos.find((t) => t.url === tab.url);
      if (targetInfo)
        await extensionClient.send('Extensions.triggerAction', {
          id: loadedId,
          targetId: targetInfo.targetId,
        });
      await rpc('activate', { tabId: tab.id });
      // The toolbar grant above temporarily visits the library. Allow that
      // activation/capture cycle to settle before invoking the command module.
      await delay(1200);
      return app.evaluate(
        `import(chrome.runtime.getURL('lib/overlay.js')).then(m=>m.openSwitcher(${JSON.stringify(tab)},${JSON.stringify({ mode })}))`,
      );
    };
    await triggerSwitcher(pin);
    const overlayCheck = process.argv.includes('--overlay-scopes')
      ? (await import('./check-overlay-scopes.mjs')).checkOverlayScopes
      : process.argv.includes('--copy-swap')
        ? (await import('./check-copy-swap.mjs')).checkSwapOverlay
        : process.argv.includes('--workspace-removal') ||
            process.argv.includes('--workona-ux') ||
            process.argv.includes('--selection-clarity') ||
            process.argv.includes('--settings-ux') ||
            process.argv.includes('--notes-ux') ||
            process.argv.includes('--workspace-providers')
          ? (await import('./check-selection-clarity.mjs')).checkSelectionOverlay
          : process.argv.includes('--switch-picker')
            ? (await import('./check-switch-picker.mjs')).checkSwitchOverlay
            : (await import('./check-overlay.mjs')).checkOverlay;
    await overlayCheck({
      app,
      rpc,
      targets,
      connect,
      extensionClient,
      loadedId,
      target,
      pin,
      triggerSwitcher,
      out,
      results,
      delay,
    });
  }
  if (process.argv.includes('--library-search'))
    await (
      await import('./check-library-search.mjs')
    ).checkLibrarySearch({ app, rpc, out, results, delay, origin });
  if (process.argv.includes('--unified-ux'))
    await (
      await import('./check-unified-ux.mjs')
    ).checkUnifiedUX({ app, rpc, out, results, delay, origin, targets, connect, extensionOrigin });
  if (process.argv.includes('--organizer-ux'))
    await (
      await import('./check-organizer-ux.mjs')
    ).checkOrganizerUX({ app, rpc, out, results, delay, origin });
  if (process.argv.includes('--redesign'))
    await (
      await import('./check-redesign.mjs')
    ).checkRedesign({ app, rpc, out, results, delay, origin, windowId: tabA.windowId });
  if (process.argv.includes('--polish'))
    await (await import('./check-polish-ui.mjs')).checkPolish({ app, rpc, out, results, delay });
  if (process.argv.includes('--search'))
    await (
      await import('./check-search-ui.mjs')
    ).checkSearchUI({
      app,
      rpc,
      connect,
      targets,
      extensionOrigin,
      windowId: tabA.windowId,
      out,
      results,
      delay,
    });
  if (process.argv.includes('--integrations'))
    await (
      await import('./check-integrations.mjs')
    ).checkIntegrations({ app, rpc, connect, targets, extensionOrigin, results, out });
  if (process.argv.includes('--recovery'))
    await (
      await import('./check-recovery-ui.mjs')
    ).checkRecovery({
      app,
      rpc,
      connect,
      targets,
      extensionOrigin,
      windowId: tabA.windowId,
      origin,
      results,
      delay,
    });
  if (process.argv.includes('--scale'))
    await (await import('./check-scale.mjs')).checkScale({ app, rpc, out, results, delay });
  if (process.argv.includes('--bulk'))
    await (
      await import('./check-bulk.mjs')
    ).checkBulk({ app, rpc, windowId: tabA.windowId, out, results, delay });
  if (process.argv.includes('--native-bookmarks'))
    await (
      await import('./check-native-bookmarks.mjs')
    ).checkBookmarks({ app, rpc, results, delay });
  if (process.argv.includes('--direct-ux'))
    await (await import('./check-direct-ux.mjs')).checkDirectUX({ app, rpc, out, results, delay });
  if (process.argv.includes('--copy-swap'))
    await (await import('./check-copy-swap.mjs')).checkCopySwap({ app, rpc, out, results, delay });
  if (process.argv.includes('--workspace-removal'))
    await (
      await import('./check-workspace-removal.mjs')
    ).checkWorkspaceRemoval({ app, rpc, out, results, delay });
  if (process.argv.includes('--workona-ux'))
    await (
      await import('./check-workona-ux.mjs')
    ).checkWorkonaUX({ app, rpc, out, results, delay, origin, targets, connect });
  if (process.argv.includes('--workspace-providers'))
    await (
      await import('./check-workspace-providers.mjs')
    ).checkWorkspaceProviders({ app, rpc, out, results, delay });
  if (process.argv.includes('--collections'))
    await (
      await import('./check-collections.mjs')
    ).checkCollections({ app, rpc, out, results, delay, origin });
  if (process.argv.includes('--sidebar-groups'))
    await (
      await import('./check-sidebar-groups.mjs')
    ).checkSidebarGroups({ app, rpc, out, results, delay, origin });
  if (process.argv.includes('--notes-ux'))
    await (await import('./check-notes-ux.mjs')).checkNotesUX({ app, rpc, out, results, delay });
  if (process.argv.includes('--settings-ux'))
    await (
      await import('./check-settings-ux.mjs')
    ).checkSettingsUX({ app, rpc, out, results, delay });
  if (process.argv.includes('--selection-clarity'))
    await (
      await import('./check-selection-clarity.mjs')
    ).checkSelectionClarity({ app, rpc, results, out, delay, origin });
  if (process.argv.includes('--switch-picker'))
    await (
      await import('./check-switch-picker.mjs')
    ).checkSwitchPicker({ app, rpc, out, results, delay, origin });
  if (process.argv.includes('--previews'))
    await (await import('./check-previews.mjs')).checkPreviews({ app, results });
  if (process.argv.includes('--connections'))
    await (
      await import('./check-connections.mjs')
    ).checkConnections({ app, rpc, results, delay, notionCalls });
  if (process.argv.includes('--interactions'))
    await (
      await import('./check-interactions.mjs')
    ).checkInteractions({ app, rpc, out, results, delay });
  if (process.argv.includes('--collection-lists'))
    await (
      await import('./check-collection-lists.mjs')
    ).checkCollectionLists({ app, rpc, out, results, delay, origin, extensionOrigin });
  if (process.argv.includes('--auto-collections'))
    await (
      await import('./check-auto-collections.mjs')
    ).checkAutoCollections({ app, rpc, out, results, delay, origin, extensionOrigin });
  if (process.argv.includes('--close-collection'))
    await (
      await import('./check-close-collection.mjs')
    ).checkCloseCollection({
      app,
      rpc,
      out,
      results,
      delay,
      origin,
      extensionOrigin,
    });
  if (process.argv.includes('--group-cleanup'))
    await (
      await import('./check-group-cleanup.mjs')
    ).checkGroupCleanup({
      app,
      rpc,
      out,
      results,
      delay,
      origin,
      chromeMode,
      processId: proc.pid,
    });
  await fs.writeFile(
    path.join(out, 'results.json'),
    JSON.stringify({ results, exceptions: app.events, hits }, null, 2),
  );
  console.log(JSON.stringify({ out, results, exceptions: app.events }, null, 2));
  assert.equal(app.events.length, 0);
} finally {
  await fs.writeFile(path.join(out, 'progress.json'), JSON.stringify(results, null, 2));
  await fs.writeFile(path.join(out, 'browser-stderr.log'), stderr);
  if (browserClient)
    try {
      await browserClient.send('Browser.close');
    } catch {}
  for (const c of clients) c.ws.close();
  server.close();
  proc.unref();
}

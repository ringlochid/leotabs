// SPDX-License-Identifier: MPL-2.0
import { mirrorCollection, collectionContentKey, tabSetKey } from './collection-workflow.js';
import { snapshotTabs, uid } from './model.js';

// Live tab IDs belong to this browser session only. Durable snapshots contain URLs,
// never reusable browser IDs. Active collections mirror their eligible open pages.
export function sessionManager({ browser, db, ops }) {
  const marker = browser.runtime.getURL('holding.html');
  const state = async () =>
    (await browser.storage.session.get('neoSessions')).neoSessions || { active: {}, parked: {} };
  const persist = (s) => browser.storage.session.set({ neoSessions: s });
  async function holding(record) {
    if (!record?.windowId) return false;
    const tab = await browser.tabs.get(record.markerId).catch(() => null);
    return tab?.windowId === record.windowId && tab.url === marker + '?id=' + record.id;
  }
  async function hiddenWindows() {
    const s = await state();
    const ids = [];
    for (const r of Object.values(s.parked)) if (await holding(r)) ids.push(r.windowId);
    return ids;
  }
  async function capture(windowId, { reason = 'Tab session', force = false, sync = true } = {}) {
    if ((await hiddenWindows()).includes(windowId)) return;
    const tabs = (await ops.live()).filter((t) => t.windowId === windowId && !t.pinned);
    const s = await state(),
      current = s.active[windowId];
    if (!tabs.length && !current) return;
    const groups = await browser.tabGroups.query({ windowId });
    const snapshot = snapshotTabs(tabs, groups);
    // Multiple windows must not overwrite each other's version of a collection.
    const owners = Object.values(s.active).filter((x) => x.collectionId === current?.collectionId && x.tracking !== false);
    if (sync && current && current.tracking !== false && owners.length === 1) {
      await db.mutate('Automatic collection update', (library) => {
        const c = library.collections.find((x) => x.id === current.collectionId);
        if (!c || c.autoUpdate === false) return { unchanged: true };
        const next = mirrorCollection(c, snapshot);
        if (collectionContentKey(c) === collectionContentKey(next)) return { unchanged: true };
        const beforeCollection = structuredClone(c);
        Object.assign(c, next, { updatedAt: Date.now() });
        return { beforeCollection, versionWindowId: windowId };
      });
    }
    const fingerprint = JSON.stringify([
      tabs.map((t) => [t.resourceUrl || t.pendingUrl || t.url, t.groupId, t.title]),
      groups.map((g) => [g.id, g.title, g.color, g.collapsed]),
    ]);
    const rows = (await db.all('timeline')).sort((a, b) => b.at - a.at);
    const previous = rows.find(
      (r) => r.windowId === windowId && r.collectionId === (current?.collectionId || null),
    );
    if (!force && previous?.fingerprint === fingerprint) return previous;
    const row = {
      id: uid(),
      at: Date.now(),
      windowId,
      collectionId: current?.collectionId || null,
      name: current?.name || 'Browsing session',
      reason,
      fingerprint,
      snapshot,
    };
    await db.write('timeline', row);
    for (const old of [row, ...rows].slice(200)) await db.remove('timeline', old.id);
    for (const old of rows.filter((r) => r.at < Date.now() - 30 * 86400000))
      await db.remove('timeline', old.id);
    return row;
  }
  async function move(tabs, windowId) {
    const movedGroups = new Set();
    for (const tab of tabs.sort((a, b) => a.index - b.index)) {
      if (movedGroups.has(tab.groupId)) continue;
      const now = await browser.tabs.get(tab.id).catch(() => null);
      if (!now || now.windowId !== tab.windowId || now.pinned)
        throw Error('Tabs changed during switching. Your session is available in Previously open.');
      if (now.groupId >= 0) {
        if (movedGroups.has(now.groupId)) continue;
        const members = await browser.tabs.query({ groupId: now.groupId });
        if (members.every((t) => tabs.some((x) => x.id === t.id))) {
          await browser.tabGroups.move(now.groupId, { windowId, index: -1 });
          movedGroups.add(now.groupId);
          continue;
        }
      }
      await browser.tabs.move(tab.id, { windowId, index: -1 });
    }
  }
  async function switchTo({
    destinationId,
    windowId,
    saveCurrent = true,
    signal,
    focusPage = false,
    force = false,
    tracking,
    preserveCurrent = false,
  }) {
    if ((await hiddenWindows()).includes(windowId))
      throw Error(
        'Switch collections from your original browser window. This window holds an inactive session.',
      );
    const s = await state();
    const key = windowId + ':' + destinationId;
    if (!force && !preserveCurrent && s.active[windowId]?.collectionId === destinationId) {
      await capture(windowId);
      return { status: 'complete' };
    }
    const other = !preserveCurrent && Object.entries(s.active).find(
      ([id, x]) => Number(id) !== windowId && x.collectionId === destinationId && x.tracking !== false,
    );
    if (other) {
      try {
        await browser.windows.update(Number(other[0]), { focused: true });
        return { status: 'complete', label: 'Collection is open in another window' };
      } catch {
        delete s.active[other[0]];
        await persist(s);
      }
    }
    const saved = await capture(windowId, { reason: 'Before switch', force: true, sync: !force && !preserveCurrent });
    const library = await db.getState();
    const destination = library.collections.find((c) => c.id === destinationId);
    const retained = force ? null : s.parked[key];
    if (!destination && !retained) throw Error('Collection no longer exists.');
    const latest = (await db.all('timeline'))
      .filter((r) => r.collectionId === destinationId)
      .sort((a, b) => b.at - a.at)[0];
    const fallback = destination || retained?.snapshot || latest?.snapshot;
    if (!fallback) throw Error('This collection is no longer available.');
    const source = (await ops.live()).filter((t) => t.windowId === windowId && !t.pinned);
    if (signal?.aborted) return { cancelled: true };
    const sourceId = (force ? null : s.active[windowId]?.collectionId) || 'session-' + uid();
    const sourceName =
      (force ? 'Before version restore · ' : '') +
      (s.active[windowId]?.name || 'Previous browsing session');
    let parked, guard;
    let destinationTabs = [];
    let openedIds = [];
    try {
      // Keep the original window alive when the switcher is running inside a page.
      guard = await browser.tabs.create({ windowId, url: 'about:blank', active: false });
      if (await holding(retained)) {
        destinationTabs = (await ops.live()).filter(
          (t) => t.windowId === retained.windowId && retained.tabIds.includes(t.id),
        );
        // An empty holding window means the user closed its pages: fall back to URLs.
      }
      if (destination && destinationTabs.length) {
        const liveSnapshot = snapshotTabs(
          destinationTabs,
          await browser.tabGroups.query({ windowId: retained.windowId }),
        );
        if (tabSetKey(liveSnapshot) !== tabSetKey(destination)) destinationTabs = [];
      }
      if (destinationTabs.length) await move(destinationTabs, windowId);
      else {
        const opened = await ops.openLinks({
          collection: fallback,
          windowId,
          deferred: true,
          reuse: false,
          signal,
        });
        openedIds = opened.created || [];
        if (opened.failed.length || opened.groupFailures.length || opened.cancelled)
          throw Error(
            'Some destination tabs could not open. Current tabs were kept; review Previously open.',
          );
      }
      if (signal?.aborted) throw Error('Switch cancelled. Current tabs were kept.');
      if (saveCurrent && source.length) {
        // Retain a resumable snapshot, not a hidden browser window.
        parked = {
          id: uid(),
          collectionId: sourceId,
          name: sourceName,
          snapshot: saved?.snapshot,
          tabIds: [],
        };
        s.parked[windowId + ':' + sourceId] = parked;
        await persist(s);
      }
      if (source.length) {
        const closed = await ops.close(source.map((t) => t.id));
        if (closed?.skipped?.length || closed?.cancelled)
          throw Error(
            'Some source tabs changed and stayed open. Their saved snapshot is in Timeline.',
          );
      }
      s.active[windowId] = {
        collectionId: destinationId,
        name: destination?.name || retained.name,
        tracking: tracking ?? (destination?.autoUpdate !== false),
      };
      if (retained && !destinationTabs.length && (await holding(retained))) {
        // Preserve unmatched live work under its own recovery entry, never strand it.
        const recoveryId = 'session-' + uid();
        s.parked[windowId + ':' + recoveryId] = {
          ...retained,
          collectionId: recoveryId,
          name: 'Previous tabs · ' + retained.name,
        };
      }
      delete s.parked[key];
      await persist(s);
      if (
        (await holding(retained)) &&
        !Object.values(s.parked).some((r) => r.windowId === retained.windowId)
      )
        await browser.tabs.remove(retained.markerId).catch(() => {});
      await capture(windowId, { reason: 'Switched to collection', force: true }).catch(() => {});
      // Keep Neo visible when invoked from the library. Otherwise activate a destination page.
      const visible = await browser.tabs.query({ windowId });
      const libraryTab =
        !focusPage && visible.find((t) => t.url?.startsWith(browser.runtime.getURL('app.html')));
      const first = visible.find(
        (t) => destinationTabs.some((x) => x.id === t.id) || openedIds.includes(t.id),
      );
      if (libraryTab || first)
        await browser.tabs.update((libraryTab || first).id, { active: true }).catch(() => {});
      await browser.windows.update(windowId, { focused: true }).catch(() => {});
      return { status: 'complete', label: 'Switched to ' + s.active[windowId].name };
    } catch (error) {
      // Pause tracking after a partial switch rather than overwriting the recovery copy.
      await db
        .mutate('Pause automatic updates after incomplete switch', (library) => {
          const c = library.collections.find((c) => c.id === s.active[windowId]?.collectionId);
          if (!c) return { unchanged: true };
          c.autoUpdate = false;
          c.autoUpdatePausedReason = 'Switch incomplete';
        })
        .catch(() => {});
      if (destinationTabs.length && (await holding(retained))) {
        const back = (await ops.live()).filter(
          (t) => destinationTabs.some((x) => x.id === t.id) && t.windowId === windowId,
        );
        await move(back, retained.windowId).catch(() => {});
      }
      throw error;
    } finally {
      if (guard) {
        const remaining = await browser.tabs.query({ windowId }).catch(() => []);
        if (remaining.some((t) => t.id !== guard.id))
          await browser.tabs.remove(guard.id).catch(() => {});
        else if (remaining.some((t) => t.id === guard.id))
          await browser.tabs
            .update(guard.id, { url: browser.runtime.getURL('app.html'), active: true })
            .catch(() => {});
      }
    }
  }
  async function list(windowId) {
    const s = await state();
    return {
      active: s.active,
      retained: Object.entries(s.parked)
        .filter(([key]) => !windowId || key.startsWith(windowId + ':'))
        .map(([key, r]) => ({ key, id: r.collectionId, name: r.name, links: r.snapshot.links })),
    };
  }
  async function closeCurrent({ collectionId, windowId }) {
    const s = await state();
    const current = s.active[windowId];
    if (!current || current.collectionId !== collectionId)
      throw Error('This collection is no longer active in this window.');
    await capture(windowId, { reason: 'Closed collection', force: true });
    const tabs = (await ops.live()).filter((t) => t.windowId === windowId && !t.pinned);
    const visible = await browser.tabs.query({ windowId });
    if (tabs.length && visible.every((t) => tabs.some((x) => x.id === t.id)))
      await browser.tabs.create({
        windowId,
        url: browser.runtime.getURL('app.html'),
        active: false,
      });
    // End tracking before closure events can snapshot an empty window over the
    // saved collection. Closing a collection is not deleting its saved contents.
    delete s.active[windowId];
    await persist(s);
    try {
      const closed = tabs.length ? await ops.close(tabs.map((t) => t.id)) : null;
      if (closed?.skipped?.length || closed?.cancelled)
        throw Error('Some tabs stayed open. The collection is saved; try closing it again.');
      return { ...closed, status: 'complete', label: 'Closed ' + current.name };
    } catch (error) {
      // Keep a retryable current collection, but preserve the pre-close snapshot
      // if only some tabs closed. Checkpoints run on the same background queue.
      await db.mutate('Pause automatic updates after incomplete close', (library) => {
        const c = library.collections.find((c) => c.id === collectionId);
        if (!c) return { unchanged: true };
        c.autoUpdate = false;
        c.autoUpdatePausedReason = 'Close incomplete';
      });
      s.active[windowId] = current;
      await persist(s);
      throw error;
    }
  }
  async function replaceTab(removedId, addedId) {
    const s = await state();
    let changed = false;
    for (const record of Object.values(s.parked)) {
      if (record.markerId === removedId) {
        record.markerId = addedId;
        changed = true;
      }
      record.tabIds = record.tabIds.map((id) => {
        if (id === removedId) {
          changed = true;
          return addedId;
        }
        return id;
      });
    }
    if (changed) await persist(s);
  }
  async function forgetWindow(windowId) {
    const s = await state();
    delete s.active[windowId];
    await persist(s);
  }
  async function closeAll(windowId) {
    await capture(windowId, {reason:'Closed window tabs', force:true, sync:false});
    const tabs = (await ops.live()).filter(t => t.windowId === windowId && !t.pinned);
    const visible = await browser.tabs.query({windowId});
    if (tabs.length && visible.every(t => tabs.some(x => x.id === t.id)))
      await browser.tabs.create({windowId, url:browser.runtime.getURL('app.html'), active:false});
    await forgetWindow(windowId);
    return tabs.length ? ops.close(tabs.map(t => t.id)) : {status:'complete'};
  }
  async function setAutoUpdate({ collectionId, windowId, enabled }) {
    if (typeof enabled !== 'boolean') throw Error('Choose whether to enable auto-update.');
    const s = await state();
    const active = s.active[windowId];
    if (!active || active.collectionId !== collectionId)
      throw Error('This collection is no longer active in this window.');
    if (enabled && Object.entries(s.active).some(([id, x]) => Number(id) !== windowId && x.collectionId === collectionId && x.tracking !== false))
      throw Error('Auto-update is already running for this collection in another window.');
    // Keep the pre-resume version recoverable before current tabs are mirrored.
    await db.mutate(enabled ? 'Resume auto-update' : 'Pause auto-update', library => {
      const c = library.collections.find(c => c.id === collectionId);
      if (!c) throw Error('This collection no longer exists.');
      const beforeCollection = structuredClone(c);
      c.autoUpdate = enabled;
      delete c.autoUpdatePausedReason;
      return { beforeCollection, versionWindowId: windowId };
    });
    active.tracking = enabled;
    await persist(s);
    if (enabled) await capture(windowId);
    return { label: enabled ? 'Auto-update on' : 'Auto-update paused' };
  }
  async function applyAutoUpdateToOpen(enabled) {
    const s = await state();
    const owners = new Set();
    // A collection opened in multiple windows still needs one writer.
    const entries = Object.entries(s.active).sort((a,b) => Number(b[1].tracking !== false)-Number(a[1].tracking !== false));
    for (const [, active] of entries) {
      active.tracking = enabled && !owners.has(active.collectionId);
      if (active.tracking) owners.add(active.collectionId);
    }
    await persist(s);
    if (enabled) for (const [id, active] of entries)
      if (active.tracking) await capture(Number(id));
  }
  async function pauseForStash(tabs) {
    const s=await state();
    for (const windowId of new Set(tabs.map(t=>t.windowId))) {
      const current=s.active[windowId];
      if(current && current.tracking !== false)
        await setAutoUpdate({collectionId:current.collectionId,windowId,enabled:false});
    }
  }
  return { capture, switchTo, closeCurrent, closeAll, setAutoUpdate, applyAutoUpdateToOpen, pauseForStash, hiddenWindows, list, replaceTab, forgetWindow };
}

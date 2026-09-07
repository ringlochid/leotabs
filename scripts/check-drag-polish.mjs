// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkDragPolish({ app, rpc, results, delay, out, tabs, collections }) {
  const wait = async (fn, message) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await delay(60);
    }
    throw Error(message);
  };
  const shot = async (name) =>
    fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await app.send('Page.captureScreenshot')).data, 'base64'),
    );
  const rect = (selector) =>
    app.evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})()`,
    );
  const marker = () =>
    app.evaluate(
      `(()=>{const ns=[...document.querySelectorAll('.drop-insertion,.collection-insertion')];const r=ns[0]?.getBoundingClientRect();return {count:ns.length,left:r?.left,top:r?.top,width:r?.width,height:r?.height}})()`,
    );
  await app.send('Input.setInterceptDrags', { enabled: true });
  async function start(selector) {
    await wait(
      () => app.evaluate(`!document.getAnimations().some(a=>a.playState==='running')`),
      'Animation not settled',
    );
    await app.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`,
    );
    const r = await rect(selector),
      p = { x: r.left + r.width * 0.6, y: r.top + r.height / 2 };
    app.dragEvents.length = 0;
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
    await app.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...p,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    for (let i = 1; i <= 4; i++)
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: p.x + i * 10,
        y: p.y + i,
        button: 'left',
        buttons: 1,
      });
    await wait(() => app.dragEvents.length, 'Native drag did not start');
    return app.dragEvents.at(-1).data;
  }
  async function over(data, p) {
    for (const type of ['dragEnter', 'dragOver'])
      await app.send('Input.dispatchDragEvent', { type, ...p, data });
    await delay(70);
  }
  async function end(data, p, cancel = false) {
    await app.send('Input.dispatchDragEvent', { type: cancel ? 'dragCancel' : 'drop', ...p, data });
    await app.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await wait(
      () =>
        app.evaluate(
          `!document.body.classList.contains('dragging-open-tabs')&&!document.querySelector('.drop-insertion,.collection-insertion')`,
        ),
      'Drag feedback not cleared',
    );
    await delay(150);
  }
  const card = (id) => `[data-collection-id="${id}"]`;
  const left = collections[0],
    right = collections[1],
    source = collections[2];
  let data = await start(card(source.id) + ' .collection-name');
  await app.evaluate(`document.querySelector('#main').scrollTop=0`);
  const a = await rect(card(left.id)),
    b = await rect(card(right.id));
  const p = { x: a.right - 4, y: a.top + 25 },
    q = { x: b.left + 4, y: b.top + 25 };
  await over(data, p);
  const fromLeft = await marker();
  await over(data, q);
  const fromRight = await marker();
  await shot('collection-boundary');
  const failures = [];
  if (JSON.stringify(fromLeft) !== JSON.stringify(fromRight))
    failures.push('Same gap has different marker positions');
  if (fromRight.height < Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top) - 2)
    failures.push('Marker height does not match neighbouring collections');
  const gap = { x: (a.right + b.left) / 2, y: a.top + 30 };
  await over(data, gap);
  if (!process.argv.includes('--expect-drag-defects')) {
    assert.deepEqual(
      fromLeft,
      fromRight,
      'The same collection boundary must have identical geometry from both sides',
    );
    assert(
      fromRight.height > 100,
      'Expanded cards need a dynamic bar taller than the previous cap',
    );
    assert.equal(fromRight.count, 1);
    assert.equal(fromRight.width, 2);
    assert(Math.abs(fromRight.left + 1 - gap.x) < 1, 'Bar is not centred in gap');
  }
  await end(data, gap, process.argv.includes('--expect-drag-defects'));
  if (!process.argv.includes('--expect-drag-defects'))
    await wait(async () => {
      const cs = (await rpc('load')).state.collections;
      return cs.findIndex((c) => c.id === source.id) + 1 === cs.findIndex((c) => c.id === right.id);
    }, 'Drop in gap did not match insertion');
  for (const theme of ['dark', 'light']) {
    await rpc('settings', { settings: { theme } });
    await delay(100);
    await app.evaluate(
      `document.querySelector('#main').scrollTop=0;document.querySelector('${card(left.id)} .collection-head button:last-child').click()`,
    );
    const palette = await app.evaluate(
      `[...document.querySelectorAll('.swatch')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n,'::before');return {width:r.width,height:r.height,dotWidth:parseFloat(s.width),dotHeight:parseFloat(s.height),selected:n.getAttribute('aria-pressed')}})`,
    );
    await shot('palette-' + theme);
    if (palette.some((p) => p.width !== p.height)) failures.push(theme + ' swatches are stretched');
    if (!process.argv.includes('--expect-drag-defects')) {
      assert(
        palette.every(
          (p) => p.width === 36 && p.height === 36 && p.dotWidth === 24 && p.dotHeight === 24,
        ),
        JSON.stringify(palette),
      );
      assert.equal(palette.filter((p) => p.selected === 'true').length, 1);
      const alignment = await app.evaluate(
        `(()=>{const p=document.querySelector('.custom-colour'),r=p.getBoundingClientRect(),children=[...p.querySelectorAll('input')].map(n=>n.getBoundingClientRect());return children.every(c=>c.right<=r.right+1&&Math.abs(c.top+c.height/2-r.top-r.height/2)<5)})()`,
      );
      assert(alignment, 'Custom colour fields are not aligned in one row');
      await app.evaluate(`document.querySelector('.swatch[data-color="blue"]').click()`);
      await wait(
        () =>
          app.evaluate(
            `document.querySelector('.swatch[data-color="blue"]').getAttribute('aria-pressed')==='true'`,
          ),
        'Palette did not update selected colour',
      );
      assert.equal(
        await app.evaluate(`document.querySelectorAll('.swatch[aria-pressed="true"]').length`),
        1,
      );
    }
    await app.evaluate(`document.querySelector('#action-popover').hidePopover()`);
  }
  await fs.writeFile(
    path.join(out, 'marker-geometry.json'),
    JSON.stringify({ fromLeft, fromRight, a, b, failures }, null, 2),
  );
  if (process.argv.includes('--expect-drag-defects')) {
    assert(failures.length >= 3);
    results.push(...failures);
    return;
  }
  // Collapsed cards and list layouts need shorter/differently oriented bars.
  for (const c of (await rpc('load')).state.collections.slice(0, 2))
    await rpc('edit', { kind: 'collection', collectionId: c.id, collapsed: true });
  await delay(150);
  data = await start(card(right.id) + ' .collection-name');
  await app.evaluate(`document.querySelector('#main').scrollTop=0`);
  const visible = (await rpc('load')).state.collections,
    shortA = await rect(card(visible[0].id)),
    shortB = await rect(card(visible[1].id));
  await over(data, { x: shortA.right - 2, y: shortA.top + 20 });
  const shortMarker = await marker();
  assert(shortMarker.height < fromRight.height / 2, 'Collapsed neighbours did not shorten the bar');
  await shot('collapsed-marker');
  await end(data, { x: shortA.right - 2, y: shortA.top + 20 }, true);
  await app.evaluate(`document.querySelector('#board').classList.add('list-view')`);
  data = await start(card(right.id) + ' .collection-name');
  await app.evaluate(`document.querySelector('#main').scrollTop=0`);
  const listA = await rect(card(visible[0].id)),
    listB = await rect(card(visible[1].id));
  await over(data, { x: listA.left + 80, y: listA.bottom - 2 });
  const listAfter = await marker();
  await over(data, { x: listB.left + 80, y: listB.top + 2 });
  assert.deepEqual(await marker(), listAfter);
  assert.equal(listAfter.height, 2);
  await shot('list-marker');
  await end(data, { x: listB.left + 80, y: listB.top + 2 }, true);
  await app.evaluate(`document.querySelector('#board').classList.remove('list-view')`);
  for (const width of [1440, 390]) {
    await app.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await app.evaluate(
      `document.querySelector('${card(left.id)} .collection-head').scrollIntoView({block:'center'});document.querySelector('${card(left.id)} .collection-head button:last-child').click()`,
    );
    await delay(100);
    const shapes = await app.evaluate(
      `[...document.querySelectorAll('.icon-button')].filter(n=>n.getBoundingClientRect().width&&n.querySelector('svg')&&!n.textContent.trim()).map(n=>{const r=n.getBoundingClientRect(),s=n.querySelector('svg').getBoundingClientRect();return {label:n.getAttribute('aria-label'),width:r.width,height:r.height,dx:Math.abs(s.left+s.width/2-r.left-r.width/2),dy:Math.abs(s.top+s.height/2-r.top-r.height/2)}})`,
    );
    await fs.writeFile(
      path.join(out, 'control-geometry-' + width + '.json'),
      JSON.stringify(shapes, null, 2),
    );
    assert(
      shapes.every((s) => Math.abs(s.width - s.height) < 1 && s.dx < 1 && s.dy < 1),
      JSON.stringify(
        shapes.filter((s) => Math.abs(s.width - s.height) >= 1 || s.dx >= 1 || s.dy >= 1),
      ),
    );
    assert(
      await app.evaluate(
        `document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#action-popover').getBoundingClientRect().right<=innerWidth`,
      ),
      'Narrow menu overflow',
    );
    await shot('controls-' + width);
    await app.evaluate(`document.querySelector('#action-popover').hidePopover()`);
  }
  await app.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const saved = (await rpc('load')).state.collections.find((c) => c.id === right.id);
  const linkRow = (id) => `[data-link-id="${id}"]`;
  data = await start(linkRow(saved.links[0].id) + ' .link-open');
  const savedA = await rect(linkRow(saved.links[1].id)),
    savedB = await rect(linkRow(saved.links[2].id));
  await over(data, { x: savedA.left + 60, y: savedA.bottom - 2 });
  const savedAfter = await marker();
  await over(data, { x: savedB.left + 60, y: savedB.top + 2 });
  assert.deepEqual(await marker(), savedAfter, 'Saved link boundary moved between approaches');
  assert.equal(savedAfter.height, 2);
  assert.equal(savedAfter.count, 1);
  assert.equal(
    await app.evaluate(`document.querySelectorAll('.collection.drag-over').length`),
    0,
    'Link repositioning also highlighted the whole card',
  );
  await shot('saved-tab-insertion');
  await end(data, { x: savedB.left + 60, y: savedB.top + 2 });
  await wait(async () => {
    const c = (await rpc('load')).state.collections.find((c) => c.id === right.id);
    return c.links[1].id === saved.links[0].id;
  }, 'Saved link position disagreed with its bar');
  const row = (id) => `.tab-row[data-tab-id="${id}"]`;
  await app.evaluate(`document.querySelector('#sidebar').scrollTop=0`);
  data = await start(row(tabs[0].id) + ' .tab-open');
  const r1 = await rect(row(tabs[1].id)),
    r2 = await rect(row(tabs[2].id));
  await over(data, { x: r1.left + 90, y: r1.bottom - 2 });
  const below = await marker();
  await over(data, { x: r2.left + 90, y: r2.top + 2 });
  const above = await marker();
  assert.deepEqual(below, above, 'Tab insertion boundary differs from opposite sides');
  assert.equal(above.count, 1);
  assert.equal(above.height, 2);
  assert.equal(
    await app.evaluate(`document.querySelectorAll('.native-drop-over').length`),
    0,
    'Repositioning should show a bar, not a box',
  );
  await shot('native-tab-insertion');
  await end(data, { x: r2.left + 90, y: r2.top + 2 });
  await wait(
    () =>
      app.evaluate(
        `Promise.all([${tabs[0].id},${tabs[1].id},${tabs[2].id}].map(id=>chrome.tabs.get(id))).then(([m,a,b])=>a.index<m.index&&m.index<b.index)`,
      ),
    'Browser position disagrees with tab marker',
  );
  // Exercise the lower half explicitly, including the last row in a native group.
  const group = await app.evaluate(
    `chrome.tabs.group({tabIds:[${tabs[3].id},${tabs[4].id},${tabs[5].id}]})`,
  );
  await wait(
    () => app.evaluate(`!!document.querySelector('.open-tab-group[data-group-id="${group}"]')`),
    'Group missing',
  );
  data = await start(row(tabs[3].id) + ' .tab-open');
  const last = await rect(row(tabs[5].id));
  await over(data, { x: last.left + 60, y: last.bottom - 2 });
  await shot('native-group-end');
  await end(data, { x: last.left + 60, y: last.bottom - 2 });
  await wait(
    () =>
      app.evaluate(
        `Promise.all([${tabs[3].id},${tabs[5].id}].map(id=>chrome.tabs.get(id))).then(([m,last])=>m.groupId===${group}&&m.index>last.index)`,
      ),
    'Bottom-half drop did not move to group end',
  );
  results.push(
    'One canonical collection bar per gap, dynamic expanded/collapsed height, horizontal list bars and exact gap drops; saved/live-tab before/after bars agree with persisted order, including native group end; round swatches, immediate selected colour, aligned custom fields and square centred icon controls at 1440px/390px in both themes',
  );
}

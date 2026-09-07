// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkUIRefresh({ app, rpc, results, delay, origin, out }) {
  const wait = async (fn, msg) => {
    for (let i = 0; i < 90; i++) {
      if (await fn()) return;
      await delay(75);
    }
    await fs.writeFile(
      path.join(out, 'failure.png'),
      Buffer.from((await app.send('Page.captureScreenshot')).data, 'base64'),
    );
    throw Error(msg);
  };
  const shot = async (name) =>
    fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await app.send('Page.captureScreenshot')).data, 'base64'),
    );
  await app.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await rpc('settings', { settings: { theme: 'dark', autoGroup: false } });
  const titles = [
    'Design systems that scale',
    'Working with browser tabs',
    'Prototype review notes',
    'A guide to accessible interfaces',
    'Research backlog',
    'Project roadmap',
  ];
  const tabs = await app.evaluate(
    `Promise.all(Array.from({length:36},(_,i)=>chrome.tabs.create({url:${JSON.stringify(origin)}+'/ui/'+i,active:false})))`,
  );
  await wait(
    () =>
      app.evaluate(
        `chrome.tabs.query({}).then(ts=>ts.filter(t=>${JSON.stringify(tabs.map((t) => t.id))}.includes(t.id)).every(t=>t.status==='complete'))`,
      ),
    'Fixture tabs did not load',
  );
  await app.evaluate(
    `Promise.all(${JSON.stringify(tabs.map((t) => t.id))}.map((tabId,i)=>chrome.scripting.executeScript({target:{tabId},func:title=>document.title=title,args:[${JSON.stringify(titles)}[i%6]+' '+(i+1)]})))`,
  );
  const names = [
    'Design research',
    'Building Neo',
    'Reading list',
    'AI experiments',
    'University',
    'Everyday tools',
    'Writing notes',
    'Weekend projects',
  ];
  await rpc('import', {
    collections: Array.from({ length: 18 }, (_, i) => ({
      name: names[i % 8] + (i > 7 ? ' ' + (i + 1) : ''),
      color: ['rose', 'blue', 'mint', 'lavender', 'peach', 'teal'][i % 6],
      note:
        i === 1
          ? 'Review the tab workflow, try the prototype, and keep the useful references together.'
          : '',
      groups: i % 3 === 0 ? [{ id: 'g' + i, name: 'Useful references' }] : [],
      links: Array.from({ length: 6 }, (_, j) => ({
        title: titles[j],
        url: origin + '/saved/' + i + '/' + j,
        groupId: i % 3 === 0 ? 'g' + i : null,
      })),
    })),
  });
  await delay(550);
  const collections = (await rpc('load')).state.collections,
    first = collections[0];
  if(process.argv.includes('--drag-polish')) {
    return (await import('./check-drag-polish.mjs')).checkDragPolish({app,rpc,results,delay,out,tabs,collections});
  }
  const point = (selector) =>
    app.evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`,
    );
  await app.send('Input.setInterceptDrags', { enabled: true });
  await app.evaluate(
    `window.__scrollTrace=[];for(const type of ['dragover','dragleave','dragend'])document.addEventListener(type,e=>window.__scrollTrace.push([type,e.clientX,e.clientY,e.relatedTarget?.tagName,document.querySelector('#sidebar').scrollTop]),true);`,
  );
  async function start(selector) {
    await wait(
      () => app.evaluate(`!document.getAnimations().some(a=>a.playState==='running')`),
      'Move animation did not settle',
    );
    app.dragEvents.length = 0;
    const p = await point(selector);
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
        x: p.x + 10 * i,
        y: p.y + 2 * i,
        button: 'left',
        buttons: 1,
      });
    await wait(() => app.dragEvents.length, 'Native drag did not start');
    return app.dragEvents.at(-1).data;
  }
  async function over(data, p) {
    for (const type of ['dragEnter', 'dragOver'])
      await app.send('Input.dispatchDragEvent', { type, ...p, data });
  }
  async function cancel(data, p) {
    await app.send('Input.dispatchDragEvent', { type: 'dragCancel', ...p, data });
    await app.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await delay(120);
  }
  const side = await app.evaluate(
    `(()=>{const r=document.querySelector('#sidebar').getBoundingClientRect();return {x:r.left+r.width/2,top:r.top,bottom:r.bottom}})()`,
  );
  let data = await start('#tabs .tab-row .tab-open');
  await over(data, { x: side.x, y: side.bottom - 45 });
  await wait(
    () => app.evaluate(`document.querySelector('#sidebar').scrollTop>100`),
    'Sidebar edge scroll did not advance',
  );
  const down = await app.evaluate(`document.querySelector('#sidebar').scrollTop`);
  assert(down > 80, 'Dragging at the sidebar bottom did not scroll: ' + down);
  await over(data, { x: side.x, y: side.top + 45 });
  await wait(
    () => app.evaluate(`document.querySelector('#sidebar').scrollTop<${down - 70}`),
    'Sidebar upward scrolling did not advance',
  );
  const up = await app.evaluate(`document.querySelector('#sidebar').scrollTop`);
  await fs.writeFile(
    path.join(out, 'scroll-trace.json'),
    JSON.stringify({ down, up, events: await app.evaluate('window.__scrollTrace') }, null, 2),
  );
  assert(
    up < down - 60,
    'Dragging at sidebar top did not scroll up: ' + JSON.stringify({ down, up }),
  );
  await over(data, { x: side.x, y: 500 });
  await wait(
    () => app.evaluate(`!document.querySelector('#sidebar').dataset.dragScroll`),
    'Centre drag did not stop edge scrolling',
  );
  const stopped = await app.evaluate(`document.querySelector('#sidebar').scrollTop`);
  await delay(250);
  assert(
    Math.abs((await app.evaluate(`document.querySelector('#sidebar').scrollTop`)) - stopped) < 3,
    'Scrolling continued away from edge',
  );
  await cancel(data, { x: side.x, y: 500 });
  assert.deepEqual(
    (await rpc('load')).tabs
      .filter((t) => tabs.some((x) => x.id === t.id))
      .map((t) => t.id)
      .sort(),
    tabs.map((t) => t.id).sort(),
  );
  results.push(
    'Real native tab drag scrolls down/up while held at sidebar edges and stops in the centre; cancelled drag preserves tabs',
  );
  await app.evaluate(
    `document.querySelector('#sidebar').scrollTop=0;document.querySelector('#main').scrollTop=0`,
  );
  data = await start(`[data-collection-id="${first.id}"] .collection-name`);
  const main = await app.evaluate(
    `(()=>{const r=document.querySelector('#main').getBoundingClientRect();return {x:r.left+r.width*.55,y:Math.min(innerHeight,r.bottom)-45}})()`,
  );
  await over(data, main);
  await wait(
    () =>
      app.evaluate(
        `Math.max(document.querySelector('#main').scrollTop,document.scrollingElement.scrollTop)>400`,
      ),
    'Board edge scroll did not advance',
  );
  assert(
    (await app.evaluate(
      `Math.max(document.querySelector('#main').scrollTop,document.scrollingElement.scrollTop)`,
    )) > 80,
    'Collection dragging did not scroll main panel',
  );
  const target = await app.evaluate(
    `(()=>{const cards=[...document.querySelectorAll('.collection')].filter(n=>n.dataset.collectionId!==${JSON.stringify(first.id)}&&n.getBoundingClientRect().top>50&&n.getBoundingClientRect().top<650);const n=cards.at(-1),r=n.getBoundingClientRect();return {id:n.dataset.collectionId,x:r.left+25,y:r.top+22}})()`,
  );
  await over(data, target);
  await shot('collection-drag');
  await app.send('Input.dispatchDragEvent', { type: 'drop', ...target, data });
  await app.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...target,
    button: 'left',
    clickCount: 1,
  });
  await wait(
    async () => (await rpc('load')).state.collections[0].id !== first.id,
    'Collection drop did not persist after scrolling',
  );
  const after = await rpc('load');
  assert.equal(after.state.collections.length, collections.length);
  assert.equal(
    after.state.collections.reduce((n, c) => n + c.links.length, 0),
    108,
  );
  await delay(180);
  assert.equal(await app.evaluate(`document.querySelectorAll('[data-drag-scroll]').length`), 0);
  results.push(
    'Real collection drag edge-scrolls the board, drops at the visible insertion target and preserves all collections and links',
  );
  await app.evaluate(`document.querySelector('#main').scrollTop=0`);
  const source = after.state.collections[0],
    link = source.links[0];
  data = await start(`[data-link-id="${link.id}"] .link-open`);
  await over(data, main);
  await wait(
    () => app.evaluate(`document.querySelector('#main').scrollTop>400`),
    'Saved link did not scroll down',
  );
  const boardDown = await app.evaluate(`document.querySelector('#main').scrollTop`);
  await over(data, { x: main.x, y: 45 });
  await wait(
    () => app.evaluate(`document.querySelector('#main').scrollTop<${boardDown - 90}`),
    'Saved link did not scroll up',
  );
  const linkTarget = await app.evaluate(
    `(()=>{const rows=[...document.querySelectorAll('.saved-row')].filter(n=>n.closest('.collection').dataset.collectionId!==${JSON.stringify(source.id)}&&n.getBoundingClientRect().top>100&&n.getBoundingClientRect().bottom<850);const n=rows.at(-1),r=n.getBoundingClientRect();return {collectionId:n.closest('.collection').dataset.collectionId,linkId:n.dataset.linkId,x:r.left+60,y:r.top+18}})()`,
  );
  await over(data, linkTarget);
  assert(
    await app.evaluate(
      `document.querySelectorAll('.drop-insertion[data-kind="link"]').length===1`,
    ),
    'Saved link insertion marker absent',
  );
  await shot('saved-link-drag');
  await app.send('Input.dispatchDragEvent', { type: 'drop', ...linkTarget, data });
  await app.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...linkTarget,
    button: 'left',
    clickCount: 1,
  });
  await wait(async () => {
    const c = (await rpc('load')).state.collections.find((c) => c.id === linkTarget.collectionId);
    const i = c.links.findIndex((l) => l.id === linkTarget.linkId);
    return c.links[i - 1]?.id === link.id;
  }, 'Saved link did not persist at the displayed insertion point');
  const groupSource = (await rpc('load')).state.collections.find((c) => c.groups.length),
    group = groupSource.groups[0],
    members = groupSource.links.filter((l) => l.groupId === group.id).map((l) => l.id);
  await app.evaluate(
    `document.querySelector('[data-collection-id="${groupSource.id}"] .group-header').scrollIntoView({block:'center'})`,
  );
  data = await start(`[data-collection-id="${groupSource.id}"] .group-header`);
  const groupScroll = await app.evaluate(`document.querySelector('#main').scrollTop`);
  await over(data, main);
  await wait(
    () => app.evaluate(`document.querySelector('#main').scrollTop>${groupScroll + 90}`),
    'Saved group did not scroll',
  );
  const groupTarget = await app.evaluate(
    `(()=>{const cards=[...document.querySelectorAll('.collection')].filter(n=>n.dataset.collectionId!==${JSON.stringify(groupSource.id)}&&n.getBoundingClientRect().top>40&&n.getBoundingClientRect().top<850);const n=cards.at(-1),r=n.getBoundingClientRect();return {id:n.dataset.collectionId,x:r.left+30,y:r.top+20}})()`,
  );
  await over(data, groupTarget);
  await app.send('Input.dispatchDragEvent', { type: 'drop', ...groupTarget, data });
  await app.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...groupTarget,
    button: 'left',
    clickCount: 1,
  });
  await wait(async () => {
    const c = (await rpc('load')).state.collections.find((c) => c.id === groupTarget.id);
    return members.every((id) => c.links.some((l) => l.id === id && l.groupId === group.id));
  }, 'Saved group did not preserve its members after scrolling and dropping');
  assert.equal(
    (await rpc('load')).state.collections.reduce((n, c) => n + c.links.length, 0),
    108,
  );
  results.push(
    'Saved links scroll the board in both directions and drop at their insertion marker; saved groups edge-scroll and move with all members intact',
  );
  await wait(
    () => app.evaluate(`!document.getAnimations().some(a=>a.playState==='running')`),
    'Move animation did not finish',
  );
  await app.evaluate(
    `(async()=>{const {captureMoveAnimation}=await import('./ui/drag-scroll.js');const root=document.querySelector('#board'),n=root.querySelector('.collection');const animate=captureMoveAnimation(root,'.collection','collectionId');n.style.marginTop='20px';animate();window.__move=root.getAnimations({subtree:true})[0];window.__move.effect.updateTiming({duration:1000});})()`,
  );
  await app.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 380,
    y: 70,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  const held = await app.evaluate(
    `({state:window.__move.playState,time:window.__move.currentTime})`,
  );
  await delay(120);
  assert.equal(held.state, 'paused');
  assert.equal(
    await app.evaluate(`window.__move.currentTime`),
    held.time,
    'Move continued under a held pointer',
  );
  await app.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 380,
    y: 70,
    button: 'left',
    clickCount: 1,
  });
  await wait(
    () => app.evaluate(`window.__move.playState==='finished'`),
    'Move animation did not resume',
  );
  await app.evaluate(`document.querySelector('#board .collection').style.marginTop=''`);
  await app.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  assert(
    await app.evaluate(
      `(async()=>{const {captureMoveAnimation}=await import('./ui/drag-scroll.js');const root=document.querySelector('#board'),n=root.querySelector('.collection'),animate=captureMoveAnimation(root,'.collection','collectionId');n.style.marginTop='20px';animate();n.style.marginTop='';return !root.getAnimations({subtree:true}).length})()`,
    ),
  );
  await app.send('Emulation.setEmulatedMedia', { features: [] });
  results.push(
    'Move animations pause during pointer interaction, resume after release, and respect reduced motion',
  );
  await app.evaluate(
    `document.querySelector('#main').scrollTop=0;document.querySelector('#sidebar').scrollTop=0`,
  );
  for (const theme of ['dark', 'light']) {
    await rpc('settings', { settings: { theme } });
    await delay(200);
    await shot('library-' + theme);
    const computed = await app.evaluate(
      `(()=>{const row=document.querySelector('.tab-open'),b=document.querySelector('.tab-more-button');return {font:parseFloat(getComputedStyle(row).fontSize),button:b.getBoundingClientRect().width,side:document.querySelector('#sidebar').getBoundingClientRect().width,bodyOverflow:document.documentElement.scrollWidth>innerWidth}})()`,
    );
    assert(
      computed.font >= 15 &&
        computed.button >= 36 &&
        computed.side >= 350 &&
        !computed.bodyOverflow,
      JSON.stringify(computed),
    );
    await app.evaluate(
      `document.querySelector('#settings').click()`,
    );
    await shot('settings-' + theme);
    assert(await app.evaluate(`![...document.querySelectorAll('#action-popover button')].some(b=>/rules/i.test(b.textContent))`), 'Settings must not expose a rule editor');
    assert(
      await app.evaluate(
        `[...document.querySelectorAll('#action-popover .hint,#action-popover .check-label,#action-popover .settings-preference')].every(n=>parseFloat(getComputedStyle(n).fontSize)>=13)`,
      ),
    );
    const contrast = await app.evaluate(`(()=>{
     const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});ctx.canvas.width=ctx.canvas.height=1;
     const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map(v=>v/255)};
     const over=(f,b)=>f.slice(0,3).map((v,i)=>v*f[3]+b[i]*(1-f[3]));
     const lum=c=>c.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
     return [...document.querySelectorAll('#action-popover .hint,#action-popover .settings-preference>span,#action-popover .rule-summary-text>span,#action-popover button:not(:disabled),#action-popover h2')].filter(n=>n.getBoundingClientRect().height>0).map(n=>{
       const ancestors=[];for(let p=n;p;p=p.parentElement)ancestors.unshift(p);let bg=[1,1,1];for(const p of ancestors)bg=over(rgba(getComputedStyle(p).backgroundColor),bg);
       const a=lum(over(rgba(getComputedStyle(n).color),bg)),b=lum(bg);return {label:n.textContent.trim().slice(0,50),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
     });
   })()`);
    await fs.writeFile(
      path.join(out, 'contrast-' + theme + '.json'),
      JSON.stringify(contrast, null, 2),
    );
    assert(
      contrast.every((c) => c.ratio >= 4.5),
      JSON.stringify(contrast.filter((c) => c.ratio < 4.5)),
    );
    if (theme === 'light') {
      await app.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(100);
      assert(
        await app.evaluate(
          `document.querySelector('#action-popover').scrollWidth<=document.querySelector('#action-popover').clientWidth+1`,
        ),
        'Settings horizontal overflow',
      );
      await shot('settings-390');
      await app.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
    }
    await app.evaluate(`document.querySelector('#action-popover').hidePopover()`);
  }
  for (const width of [1920, 390]) {
    await app.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(150);
    assert(
      await app.evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),
      'Horizontal overflow at ' + width,
    );
    await shot('library-' + width);
  }
  results.push(
    'Light/dark library and settings reviewed at 1440px; 15px tab text, 36px toolbar targets and wider sidebar; 1920px/390px layouts avoid horizontal overflow',
  );
}

// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkOnboarding({app,rpc,results,delay,origin,out,connect,targets,extensionOrigin,extensionClient,loadedId}) {
  const wait=async(fn,message)=>{
    for(let i=0;i<100;i++){const value=await fn();if(value)return value;await delay(100);}
    throw Error(message);
  };
  const onboardingURL=extensionOrigin+'/app.html#onboarding';
  const target=await wait(async()=>(await targets()).find(t=>t.url===onboardingURL),'First install did not open the library tour');
  assert.equal((await targets()).filter(t=>t.url===onboardingURL).length,1);
  const tour=await connect(target.webSocketDebuggerUrl);
  await tour.send('Runtime.enable');
  await wait(()=>tour.evaluate('!!document.querySelector("#onboarding-dialog[open]") && !!document.querySelector("#spaces .active")'),'Tour did not render inside the library');
  const click=label=>tour.evaluate('Array.from(document.querySelectorAll("#onboarding-dialog button")).find(b=>b.textContent==='+JSON.stringify(label)+').click()');
  const settled=()=>wait(()=>tour.evaluate('!document.querySelector("#onboarding-dialog").getAnimations({subtree:true}).some(a=>a.playState==="running")'),'Guide animation did not settle');
  const step=async number=>{
    await wait(()=>tour.evaluate('document.querySelector("#onboarding-dialog")?.dataset.step==='+JSON.stringify(String(number))),'Guide step '+number+' did not open');
    await settled();
  };
  const snapshot=async name=>{
    await settled();
    await fs.writeFile(path.join(out,name+'.png'),Buffer.from((await tour.send('Page.captureScreenshot')).data,'base64'));
  };
  const geometry=()=>tour.evaluate('(()=>{const d=document.querySelector("#onboarding-dialog"),r=d.getBoundingClientRect();return {fits:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&d.scrollWidth<=d.clientWidth,centered:Math.abs(r.left+r.width/2-document.documentElement.clientWidth/2)<1&&Math.abs(r.top+r.height/2-innerHeight/2)<1,placement:d.dataset.placement};})()');
  const state=()=>tour.evaluate('chrome.storage.local.get("leotabs-onboarding-v1").then(v=>v["leotabs-onboarding-v1"]?.status)');
  const noMockUI=()=>tour.evaluate('!document.querySelector("#onboarding-dialog input,#onboarding-dialog img,#onboarding-dialog canvas,.tour-example")');
  assert.equal((await rpc('load')).state.collections.length,0,'Onboarding must not seed or save user tabs');
  assert.deepEqual(await app.evaluate('chrome.permissions.getAll().then(p=>p.origins||[])'),[],'Onboarding requests no website access');
  assert.equal(await state(),'shown');
  assert(await noMockUI(),'Guide still includes theme selection or mock media');
  results.push('A real first installation opens one guided library without theme setup, mock media, sample collections or extra access');

  await tour.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  // Compare computed styles against the real Import dialog, not copied constants.
  await app.evaluate('document.querySelector("#imports").click()');
  await wait(()=>app.evaluate('!!document.querySelector("dialog[open] .dialog-head")'),'Reference dialog missing');
  const styleScript='(()=>{const d=document.querySelector("dialog[open]"),h=d.querySelector(".dialog-head"),t=h.querySelector("h2"),b=d.querySelector(".dialog-body"),s=getComputedStyle(d);return {radius:s.borderRadius,shadow:s.boxShadow,background:s.backgroundColor,border:s.borderTopColor,headPadding:getComputedStyle(h).padding,bodyPadding:getComputedStyle(b).padding,font:getComputedStyle(t).fontSize,weight:getComputedStyle(t).fontWeight};})()';
  assert.deepEqual(await tour.evaluate(styleScript),await app.evaluate(styleScript),'Guide does not match the shared dialog styles');
  await app.evaluate('document.querySelector("dialog[open]").close()');
  assert((await geometry()).centered,'Welcome must be centered');
  await rpc('settings',{settings:{theme:'dark'}});
  await wait(()=>tour.evaluate('document.documentElement.dataset.theme==="dark"'),'Dark theme did not apply');
  await snapshot('tour-01-welcome-dark');

  // Freeze the transition mid-flight and confirm that position really changes.
  const animation=await tour.evaluate('(()=>{const d=document.querySelector("#onboarding-dialog"),before=d.getBoundingClientRect();Array.from(d.querySelectorAll("button")).find(b=>b.textContent==="Next").click();const a=d.getAnimations().find(a=>a.id==="tour-position"),content=d.getAnimations({subtree:true}).find(a=>a.id==="tour-content");if(!a)return {exists:false};a.pause();a.currentTime=100;const middle=d.getBoundingClientRect();a.play();return {exists:true,duration:a.effect.getTiming().duration,moved:Math.abs(before.left-middle.left)>1||Math.abs(before.top-middle.top)>1,content:!!content};})()');
  assert(animation.exists&&animation.moved&&animation.content&&animation.duration===200,JSON.stringify(animation));
  await step(2);
  assert(await tour.evaluate('(()=>{const h=document.querySelector(".tour-highlight").getBoundingClientRect(),t=document.querySelector("#tabs").getBoundingClientRect();return !document.querySelector(".tour-highlight").hidden&&h.left<=t.left&&h.right>=t.right&&h.top<=t.top&&h.bottom>=t.bottom;})()'),'Save spotlight does not surround the real tab list');
  await snapshot('tour-02-save');
  await click('Next');await step(3);
  assert.equal(await tour.evaluate('document.querySelector("#tour-title").textContent'),'Stash all tabs');
  await click('Next');await step(4);
  assert.equal(await tour.evaluate('document.querySelector("#tour-title").textContent'),'Organize saved tabs');
  assert((await geometry()).centered,'Organize saved tabs should be centered without a specific target');
  await snapshot('tour-03-organize');

  await tour.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await tour.evaluate('document.querySelectorAll(".tour-dots button")[5].click()');await step(6);
  assert.equal(await tour.evaluate('document.querySelector("#onboarding-dialog").getAnimations({subtree:true}).length'),0,'Reduced-motion preference ignored');
  await snapshot('tour-06-spaces');
  await tour.send('Emulation.setEmulatedMedia',{features:[]});
  await click('Next');await step(7);
  assert.equal(await tour.evaluate('document.querySelector(".tour-body").textContent'),'Press / to search your library.');
  assert.equal(await tour.evaluate('document.querySelectorAll(".tour-body kbd").length'),1);
  await snapshot('tour-07-search');
  await tour.evaluate('document.querySelectorAll(".tour-dots button")[8].click()');await step(9);
  assert((await geometry()).centered,'Pin step retained a previous anchor');
  assert(await tour.evaluate('chrome.commands.getAll().then(commands=>document.querySelector(".tour-body kbd").textContent===commands.find(c=>c.name==="open-library").shortcut)'),'Pin step uses a stale library shortcut');
  await snapshot('tour-09-pin');

  const recordings=new Set();
  for(const number of [2,3,4,5,8,9]) {
    await tour.evaluate('document.querySelectorAll(".tour-dots button")['+(number-1)+'].click()');await step(number);
    await wait(()=>tour.evaluate('!!document.querySelector("video") && document.querySelector("video").readyState>=2 && !document.querySelector("video").error'),'Bundled recording did not decode');
    const media=await tour.evaluate('(()=>{const v=document.querySelector("video");return {url:v.currentSrc,muted:v.muted,loop:v.loop,controls:v.controls,width:v.videoWidth,duration:v.duration};})()');
    assert(media.muted&&media.loop&&media.controls&&media.width>=800&&media.duration>3,JSON.stringify(media));
    assert(media.url.startsWith(extensionOrigin+'/media/onboarding/'));
    recordings.add(new URL(media.url).pathname.split('/').at(-1));
    await tour.send('Page.bringToFront');
    await wait(()=>tour.evaluate('document.querySelector("video").currentTime>0 && !document.querySelector("video").paused'),'Recording did not autoplay');
    await tour.evaluate('document.querySelector("video").pause()');
    assert(await tour.evaluate('document.querySelector("video").paused'));
    await tour.evaluate('document.querySelector("video").play()');
    await snapshot('recording-step-'+number);
    await tour.evaluate('window.previousVideo=document.querySelector("video")');
    await tour.evaluate('document.querySelectorAll(".tour-dots button")[0].click()');await step(1);
    assert(await tour.evaluate('previousVideo.paused&&!previousVideo.isConnected&&!previousVideo.hasAttribute("src")'),'Previous recording kept playing after navigation');
  }
  const shipped=(await fs.readdir(new URL('../../extension/media/onboarding/',import.meta.url))).filter(file=>file.endsWith('.mp4'));
  assert.deepEqual([...recordings].sort(),shipped.sort(),'Not every supplied recording is used');
  assert.equal(recordings.size,6);
  await tour.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await tour.evaluate('document.querySelectorAll(".tour-dots button")[8].click()');await step(9);
  await delay(250);
  assert(await tour.evaluate('document.querySelector("video").paused&&!document.querySelector("video").autoplay'),'Reduced motion still autoplays video');
  await tour.evaluate('document.querySelector("video").play()');
  await wait(()=>tour.evaluate('document.querySelector("video").currentTime>0'),'Manual play failed with reduced motion');
  await tour.send('Emulation.setEmulatedMedia',{features:[]});
  await app.send('Page.bringToFront');
  await wait(()=>tour.evaluate('document.hidden && document.querySelector("video").paused'),'Hidden guide kept playing');
  await tour.send('Page.bringToFront');
  await wait(()=>tour.evaluate('!document.hidden && !document.querySelector("video").paused'),'Visible guide did not resume');
  await tour.evaluate('document.querySelector("video").currentTime=document.querySelector("video").duration-.1');
  await wait(()=>tour.evaluate('document.querySelector("video").currentTime<1'),'Recording did not loop');
  const fullscreen=await tour.send('Runtime.evaluate',{expression:'document.querySelector("video").requestFullscreen()',awaitPromise:true,userGesture:true});
  assert(!fullscreen.exceptionDetails,JSON.stringify(fullscreen.exceptionDetails));
  await wait(()=>tour.evaluate('document.fullscreenElement===document.querySelector("video")'),'Recording did not enter full screen');
  assert.equal(await tour.evaluate('getComputedStyle(document.fullscreenElement).maxHeight'),'none','Full screen keeps the small inline height limit');
  await tour.evaluate('document.exitFullscreen()');
  await wait(()=>tour.evaluate('!document.fullscreenElement'),'Full screen did not close');
  assert(await tour.evaluate('!!document.querySelector("#onboarding-dialog[open]")'),'Leaving full screen closed the guide');
  results.push('All six bundled recordings decode and play with mute, loop, pause/full-screen controls, reduced motion, visibility handling and cleanup');

  await tour.evaluate('document.querySelector(".tour-dots button:last-child").focus()');
  for(const [key,modifiers] of [['Tab',0],['Tab',8]]) {
    await tour.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:9,modifiers});
    await tour.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:9,modifiers});
    assert(await tour.evaluate('document.querySelector("#onboarding-dialog").contains(document.activeElement)'),'Focus escaped the guide');
  }
  await tour.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await tour.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait(()=>tour.evaluate('!document.querySelector("#onboarding-dialog")'),'Escape did not dismiss the guide');
  assert.equal(await state(),'skipped');
  assert.equal(await tour.evaluate('document.activeElement.id'),'tab-search');
  assert.equal(await tour.evaluate('document.querySelectorAll(".tour-shade,.tour-highlight").length'),0);
  // Check the actual library shortcut with focus outside the search field.
  await tour.evaluate('document.querySelector("#settings").focus()');
  await tour.send('Input.dispatchKeyEvent',{type:'keyDown',key:'/',code:'Slash',windowsVirtualKeyCode:191});
  await tour.send('Input.dispatchKeyEvent',{type:'keyUp',key:'/',code:'Slash',windowsVirtualKeyCode:191});
  assert.equal(await tour.evaluate('document.activeElement.id'),'tab-search');
  results.push('Shared flat styles, centering, real spotlights, animated movement/content, reduced motion, / search and keyboard dismissal verified');

  await tour.send('Page.navigate',{url:onboardingURL});
  await wait(()=>tour.evaluate('!!document.querySelector("#spaces .active") && !location.hash'),'Dismissed tour did not clear automatic route');
  assert(!await tour.evaluate('!!document.querySelector("#onboarding-dialog")'),'Dismissed tour repeated');
  await tour.evaluate('document.querySelector("#settings").click()');
  await wait(()=>tour.evaluate('!!document.querySelector(".settings-entry")'),'Settings menu missing');
  await tour.evaluate('Array.from(document.querySelectorAll(".settings-entry")).find(b=>b.textContent==="Quick start").click()');
  await step(1);await click('Skip');
  await wait(()=>tour.evaluate('!document.querySelector("#onboarding-dialog")'),'Skip did not close guide');
  await tour.send('Page.navigate',{url:extensionOrigin+'/help.html'});
  await wait(()=>tour.evaluate('Array.from(document.links).some(a=>a.getAttribute("href")==="app.html#tour")'),'Help quick-start link missing');
  await tour.evaluate('Array.from(document.links).find(a=>a.getAttribute("href")==="app.html#tour").click()');
  await step(1);
  for(const theme of ['light','dark']) {
    await rpc('settings',{settings:{theme}});
    await wait(()=>tour.evaluate('document.documentElement.dataset.theme==='+JSON.stringify(theme)),'Theme did not apply');
    for(const [width,height] of [[1440,1000],[390,844],[320,568]]) {
      await tour.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      for(let i=1;i<=9;i++) {
        await tour.evaluate('document.querySelectorAll(".tour-dots button")['+(i-1)+'].click()');
        await step(i);
        const g=await geometry();
        assert(g.fits,'Guide step '+i+' overflows '+width+'px');
        if([1,4,5,8,9].includes(i))assert(g.centered,'General step '+i+' is not centered at '+width+'px');
        assert(await noMockUI());
        assert(await tour.evaluate('Array.from(document.querySelectorAll(".tour-body p")).map(p=>p.textContent).join(" ").split(/\\s+/).length<=20'),'Guide copy is too long');
        if(width===390&&[2,4,9].includes(i))await snapshot('tour-'+theme+'-390-step-'+i);
        if(width===1440&&theme==='light'&&i===4)await snapshot('tour-04-organize-light');
      }
    }
  }
  results.push('All nine steps fit 1440px, 390px and 320px in both themes; general steps stay centered and each description stays under 20 words');

  await tour.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await tour.evaluate('document.querySelectorAll(".tour-dots button")[0].click()');await step(1);
  await click('Import saved tabs');
  await wait(()=>tour.evaluate('!document.querySelector("#onboarding-dialog") && !!document.querySelector("dialog[open]")'),'Import handoff did not work');
  assert.match(await tour.evaluate('document.querySelector("dialog[open]").innerText'),/Import/);
  assert.equal(await state(),'completed');
  assert.equal((await rpc('load')).state.collections.length,0,'Import offer should not modify the library');
  await tour.evaluate('document.querySelector("dialog[open]").close()');
  await tour.evaluate('location.hash="#tour"');await step(1);
  // Rapid navigation must cancel previous transitions and still settle centered.
  await tour.evaluate('document.querySelectorAll(".tour-dots button")[1].click();document.querySelectorAll(".tour-dots button")[3].click();document.querySelectorAll(".tour-dots button")[8].click()');
  await step(9);assert((await geometry()).centered);
  await tour.evaluate('window.previousVideo=document.querySelector("video")');
  await click('Done');
  await wait(()=>tour.evaluate('!document.querySelector("#onboarding-dialog")'),'Done did not close guide');
  assert.equal(await state(),'completed');
  assert(await tour.evaluate('previousVideo.paused&&!previousVideo.isConnected&&!previousVideo.hasAttribute("src")'),'Recording kept playing after closing the guide');
  await tour.evaluate('chrome.storage.local.remove("leotabs-onboarding-v1")');
  await tour.evaluate('location.hash="#onboarding"');await step(1);
  await tour.send('Page.reload');
  await wait(()=>tour.evaluate('!!document.querySelector("#spaces .active") && !location.hash'),'Refresh repeated first-run guide');
  assert(!await tour.evaluate('!!document.querySelector("#onboarding-dialog")'));
  assert.equal(await state(),'shown');
  assert.equal(tour.events.length,0,JSON.stringify(tour.events));
  results.push('Settings/Help replay, import, rapid navigation, completion and refresh suppression preserve the library');
  await extensionClient.send('Target.closeTarget',{targetId:target.id});

  // CDP allows the first unpacked load without Developer mode, but Chrome
  // disables that installation on reload unless the browser setting is on.
  // Toggle it through the real Extensions UI in this disposable profile only.
  const settingsPage=await extensionClient.send('Target.createTarget',{url:'chrome://extensions/'});
  const settingsTarget=await wait(async()=>(await targets()).find(t=>t.id===settingsPage.targetId),'Extensions settings target missing');
  const settings=await connect(settingsTarget.webSocketDebuggerUrl);
  const developerToggle=`(() => {
    function find(root) {for(const el of root.querySelectorAll('*')) {if(el.id==='devMode'&&el.tagName==='CR-TOGGLE')return el;if(el.shadowRoot){const found=find(el.shadowRoot);if(found)return found;}}}
    const toggle=find(document); if(!toggle)return false;if(!toggle.checked)toggle.click();return toggle.checked;
  })()`;
  await wait(()=>settings.evaluate(developerToggle),'Developer mode toggle unavailable');
  await extensionClient.send('Target.closeTarget',{targetId:settingsPage.targetId});
  await app.send('Runtime.evaluate',{expression:'setTimeout(()=>chrome.runtime.reload(),0)'});
  await delay(1200);
  // Reload invalidates extension pages and their execution contexts. Reopen a
  // fresh page rather than trying to reuse the destroyed runtime connection.
  await wait(async()=>(await extensionClient.send('Extensions.getExtensions')).extensions.some(item=>item.id===loadedId&&item.enabled),'Reload did not re-enable extension');
  const fresh=await extensionClient.send('Target.createTarget',{url:extensionOrigin+'/app.html'});
  const freshTarget=await wait(async()=>(await targets()).find(t=>t.id===fresh.targetId),'Reloaded library target missing');
  const reloaded=await connect(freshTarget.webSocketDebuggerUrl);
  await wait(async()=>{try{return await reloaded.evaluate('!!chrome.runtime?.id && !!document.querySelector("#spaces .active")');}catch{return false;}},'Reload did not recover library');
  assert.equal((await targets()).filter(t=>t.url===onboardingURL).length,0,'Reload reopened onboarding');
  results.push('Reload fires the update path and leaves onboarding closed');

  await extensionClient.send('Extensions.uninstall',{id:loadedId});
  const exitURL=origin+'/leotabs/uninstalled/';
  const exitTarget=await wait(async()=>(await targets()).find(t=>t.url===exitURL),'Real uninstall did not open exit page');
  const exit=await connect(exitTarget.webSocketDebuggerUrl);
  await wait(()=>exit.evaluate('document.querySelector("h1")?.textContent==="Help me improve LeoTabs"'),'Exit page did not load');
  assert.equal((await targets()).filter(t=>t.url===exitURL).length,1);
  assert(await exit.evaluate(`[...document.links].some(a=>a.href.startsWith('mailto:'))`));
  assert.equal(await exit.evaluate('document.querySelectorAll("form,iframe").length'),0);
  assert(await exit.evaluate('document.querySelector("meta[name=robots]").content.includes("noindex")'));
  await exit.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await fs.writeFile(path.join(out,'uninstalled-desktop.png'),Buffer.from((await exit.send('Page.captureScreenshot',{captureBeyondViewport:true})).data,'base64'));
  await exit.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  assert(await exit.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Exit page overflows on mobile');
  await fs.writeFile(path.join(out,'uninstalled-mobile.png'),Buffer.from((await exit.send('Page.captureScreenshot',{captureBeyondViewport:true})).data,'base64'));
  results.push('Actual uninstall opens one fixed local-fixture URL with optional email feedback and no submitted form');
}

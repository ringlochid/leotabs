// SPDX-License-Identifier: MPL-2.0
import { startQuick } from './quick.js';
import stylesheet from './styles.css';
const context = globalThis.__neoOverlayContext;
if (context) {
  const previous = document.activeElement;
  const host = document.createElement('div');
  host.setAttribute('popover', 'manual');
  host.setAttribute('aria-label', 'Neo tab switcher');
  for (const [key, value] of Object.entries({
    all: 'initial',
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    'max-width': 'none',
    'max-height': 'none',
    margin: '0',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    background: 'transparent',
    font: '15px/1.5 "Segoe UI", Tahoma, sans-serif',
    'z-index': '2147483647',
  }))
    host.style.setProperty(key, value, 'important');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = stylesheet.replaceAll(':root', ':host');
  root.append(style);
  globalThis.__neoSurface = root;
  let dispose,
    closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dispose?.();
    host.remove();
    globalThis.__neoSurface = null;
    globalThis.__neoCloseOverlay = null;
    globalThis.__neoOverlayContext = null;
    if (previous?.isConnected) previous.focus();
  };
  globalThis.__neoCloseOverlay = close;
  document.documentElement.append(host);
  host.showPopover();
  startQuick()
    .then((cleanup) => {
      dispose = cleanup;
      if (closed) dispose();
    })
    .catch((error) => {
      const text = document.createElement('p');
      text.textContent = error.message;
      const button = document.createElement('button');
      button.textContent = 'Close switcher';
      button.onclick = close;
      root.append(text, button);
      button.focus();
    });
}

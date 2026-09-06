import { orderedCollections } from '../lib/collection-workflow.js';
import { PROVIDERS, providerEndpoint, aiConnectionId } from '../lib/providers.js';
// SPDX-License-Identifier: MPL-2.0
import {
  $,
  el,
  button,
  toast,
  task,
  rpc,
  modal,
  popover,
  field,
  download,
  favicon,
  domain,
  collectionChoice,
} from './shared.js';
import { uid, newCollection, safeURL } from '../lib/model.js';
import {
  parseImport,
  importBookmarkTree,
  jsonExport,
  backupExport,
  markdownExport,
  htmlExport,
} from '../lib/portable.js';
import { endpointOrigin } from '../lib/integrations.js';
import { linkPicker } from './link-picker.js';

export function createActionDialogs({ getData, windowId, getTabIds, change, onOpen = () => {} }) {
  const data = new Proxy({}, { get: (_, key) => getData()[key] });
  const win = windowId,
    selectedIds = getTabIds,
    act = (fn) => task(fn);
  function saveTo(context, { closeTabs = data.state.settings.closeAfterStash } = {}) {
    const ids = selectedIds().filter((id) => data.tabs.some((t) => t.id === id && !t.pinned));
    if (!ids.length) return toast('Select at least one unpinned tab.', { error: true });
    const check = el('input', { type: 'checkbox', checked: closeTabs });
    const save = button(
      'Save tabs',
      act(async () => {
        save.disabled = true;
        try {
          await change('save', {
            tabIds: ids,

            close: check.checked,
          });
          close();
        } finally {
          save.disabled = false;
        }
      }),
      { className: 'primary' },
    );
    const label = () => {
      save.textContent = check.checked ? 'Stash tabs' : 'Save tabs';
      save.title = save.textContent;
      save.setAttribute('aria-label', save.textContent);
    };
    check.onchange = label;
    label();
    const { close } = popover(
      `Save ${ids.length} tabs to a new collection`,
      el(
        'div',
        {},
        el(
          'p',
          { class: 'hint' },
          'Tip: drag tabs or a group into an existing collection to save them there.',
        ),
        el('label', { class: 'check-label' }, check, 'and close them'),
        el('p', { class: 'hint' }, 'Pinned tabs stay open. Saved groups are kept together.'),
      ),
      [save, button('Cancel', () => close())],
    );
  }
  const opening = new Set();
  async function resumeDialog(c, { target = 'current', linkIds } = {}) {
    if (!c?.links.length || (linkIds && !linkIds.length)) return toast('No saved pages to open.');
    const key = c.id + ':' + target;
    if (opening.has(key)) return;
    opening.add(key);
    try {
      const job = await rpc('resume-start', {
        collectionId: c.id,
        linkIds,
        target,
        windowId: win,
        deferred: false,
      });
      toast('Opening ' + job.total + ' tabs…');
      clearTimeout($('#toast')?._timer);
      const cancel = button('Cancel', () => rpc('cancel-operation', { id: job.id }), {
        quiet: false,
      });
      $('#toast')?.append(cancel);
      const result = await rpc('resume-run', { id: job.id });
      cancel.remove();
      toast(
        result.created.length +
          ' tabs opened' +
          (result.failed.length ? ' · ' + result.failed.length + ' failed' : '') +
          (result.groupFailures.length ? ' · Some groups could not be restored' : ''),
        { error: !!result.failed.length || !!result.groupFailures.length },
      );
      onOpen();
      if (result.focusFirst && result.created[0])
        await rpc('activate', { tabId: result.created[0] });
    } catch (e) {
      toast(e.message, { error: true });
    } finally {
      opening.delete(key);
    }
  }
  let swapping = false;
  async function closeCollection(collection) {
    if (!collection || swapping) return;
    swapping = true;
    try {
      return await change('close-collection', { collectionId: collection.id, windowId: win });
    } finally {
      swapping = false;
    }
  }
  async function swapCollection(collection) {
    if (!collection || swapping) return;
    swapping = true;
    try {
      const result = await change('switch', {
        destinationId: collection.id,
        windowId: win,
        saveCurrent: true,
        requestId: uid(),
        focusPage: !!globalThis.__neoOverlayContext,
      });
      if (result?.status === 'partial' || result?.cancelled || result?.failed?.length)
        throw new Error('Swap incomplete. Review Previously open before trying again.');
      onOpen();
      return result;
    } finally {
      swapping = false;
    }
  }
  function switchDialog() {
    const trigger = globalThis.__neoSurface?.activeElement || document.activeElement;
    const ids = data.tabs.filter((t) => t.windowId === win && !t.pinned).map((t) => t.id);
    let running = false,
      requestId;
    const search = el('input', {
      type: 'search',
      placeholder: 'Search collections…',
      'aria-label': 'Search collections',
    });
    const saveCurrent = el('input', {
      type: 'checkbox',
      checked: !!ids.length,
      disabled: !ids.length,
    });
    const list = el('div', {
      class: 'switch-choices collection-choices',
      'aria-label': 'Collections',
    });
    const status = el('p', { class: 'hint', role: 'status' });
    const retained = (data.sessionState?.retained || []).filter((x) => x.key.startsWith(win + ':'));
    const collections = [
      ...orderedCollections(data.state.collections),
      ...retained.filter((x) => !data.state.collections.some((c) => c.id === x.id)),
    ];
    function render() {
      const query = search.value.trim().toLocaleLowerCase();
      const matches = collections.filter((x) => x.name.toLocaleLowerCase().includes(query));
      list.replaceChildren(
        ...matches.map((collection) => {
          const space = data.state.spaces?.find((x) => x.id === collection.spaceId)?.name;
          const choose = collectionChoice(
            collection,
            act(async () => {
              if (running) return;
              running = true;
              requestId = uid();
              search.disabled = saveCurrent.disabled = true;
              for (const row of list.querySelectorAll('button')) row.disabled = true;
              status.textContent = 'Switching to ' + collection.name + '…';
              try {
                const result = await change('switch', {
                  requestId,
                  tabIds: ids,
                  destinationId: collection.id,
                  saveCurrent: saveCurrent.checked,
                  focusPage: !!globalThis.__neoOverlayContext,
                  windowId: win,
                });
                if (
                  result.status === 'partial' ||
                  result.failed?.length ||
                  result.groupFailures?.length ||
                  result.cancelled
                )
                  throw new Error('Switch incomplete. Check Recovery before trying again.');
                running = false;
                close();
                onOpen();
              } catch (error) {
                status.textContent = error.message;
              } finally {
                running = false;
                search.disabled = false;
                saveCurrent.disabled = !ids.length;
                for (const row of list.querySelectorAll('button')) row.disabled = false;
              }
            }),
            {
              detail: `${data.sessionState?.active?.[win]?.collectionId === collection.id ? 'Current · ' : retained.some((x) => x.id === collection.id) ? 'Resume · ' : ''}${collection.links.length} tabs${space ? ' · ' + space : ''}`,
            },
          );
          return choose;
        }),
      );
      status.textContent = matches.length
        ? ''
        : collections.length
          ? 'No matching collections.'
          : 'No saved collections with tabs yet.';
    }
    search.oninput = render;
    render();
    const { close, dialog } = popover(
      'Switch collection',
      el(
        'div',
        { class: 'switch-picker' },
        search,
        el('label', { class: 'check-label' }, saveCurrent, 'Save current tabs'),
        el(
          'p',
          { class: 'hint switch-explanation' },
          'Save keeps a snapshot for switching back. Tabs are replaced in this window; pinned tabs stay.',
        ),
        list,
        status,
      ),
      [
        button('Cancel', () => {
          close();
        }),
      ],
    );
    dialog.addEventListener('toggle', (e) => {
      if (e.newState === 'closed' && running)
        rpc('cancel-operation', { id: requestId }).catch(() => {});
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        trigger?.focus();
        return;
      }
      if (running) return;
      const rows = [...list.querySelectorAll('button')];
      const index = rows.indexOf(e.target);
      if ((e.target === search || index >= 0) && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'ArrowUp' && index <= 0) search.focus();
        else rows[Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))]?.focus();
      } else if ((e.target === search || index >= 0) && e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        rows[Math.max(0, index)]?.click();
      }
    });
    search.focus({ preventScroll: true });
  }
  function importDialog() {
    const input = el('input', { type: 'file', accept: '.json,.html,.htm,.md,.markdown,.txt' });
    input.onchange = act(async () => {
      const f = input.files[0];
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) throw new Error('Choose a file smaller than 20 MB.');
      previewImport(parseImport(await f.text(), f.name));
    });
    focusedDialog(
      'Import data',
      el(
        'div',
        { class: 'transfer-options' },
        el(
          'p',
          { class: 'hint' },
          'Bring your saved work into Neo. Your current collections are kept.',
        ),
        button(
          'Import browser bookmarks',
          act(async () => {
            if (!(await chrome.permissions.request({ permissions: ['bookmarks'] }))) return;
            previewImport(importBookmarkTree(await rpc('bookmarks-read')));
          }),
          { glyph: 'library', className: 'transfer-primary' },
        ),
        el(
          'details',
          {},
          el('summary', {}, 'Import from a file'),
          el(
            'p',
            { class: 'hint' },
            'Neo backup, bookmark HTML, Markdown, Toby JSON or OneTab text.',
          ),
          field('Choose a file', input),
        ),
        button('Switch to Export & backup', backupDialog),
      ),
    );
  }

  function previewImport(result) {
    const preferences = el('input', { type: 'checkbox' });
    const { close } = modal(
      'Review import',
      el(
        'div',
        {},
        el(
          'p',
          {},
          `${result.collections.length} collections · ${result.links} links${result.skipped ? ` · ${result.skipped} unsupported links skipped` : ''}`,
        ),
        el(
          'div',
          { class: 'review-list' },
          result.collections.map((c) => el('p', {}, `${c.name} · ${c.links.length}`)),
        ),
        el('p', { class: 'hint' }, 'Imported collections are added as separate copies.'),
        result.settings
          ? el(
              'label',
              { class: 'check-label' },
              preferences,
              'Restore saved preferences and domain rules',
            )
          : null,
        result.settings
          ? el(
              'p',
              { class: 'hint' },
              'Keys and website permissions are not in backups. Automatic preview capture stays off until enabled in Settings. Recovery log entries are imported for reference; old browser actions are never replayed.',
            )
          : null,
      ),
      [
        button(
          'Import collections',
          act(async () => {
            await change('import', {
              collections: result.collections,
              spaces: result.spaces,
              settings: preferences.checked ? result.settings : undefined,
              recovery: result.recovery,
            });
            close();
          }),
          { className: 'primary' },
        ),
      ],
    );
  }
  function exportDialog(c, trigger) {
    const { close, dialog } = popover(
      `Export ${c.name}`,
      el(
        'div',
        {},

        el(
          'div',
          { class: 'actions' },
          button('Markdown', () => download(markdownExport([c]), c.name + '.md', 'text/markdown')),
          button('Bookmark HTML', () => download(htmlExport([c]), c.name + '.html', 'text/html')),
          button('Neo JSON', () => download(jsonExport([c]), c.name + '.json', 'application/json')),
          button(
            'Copy Markdown',
            act(async () => {
              await navigator.clipboard.writeText(markdownExport([c]));
              toast('Markdown copied');
            }),
          ),
          button('Send to Notion…', () => notionDialog(c)),
          button(
            'Export to browser bookmarks…',
            act(async () => {
              if (!(await chrome.permissions.request({ permissions: ['bookmarks'] }))) return;
              const tree = await rpc('bookmarks-read');
              const select = el('select');
              function folders(n, depth = 0) {
                if (!n.url && n.id !== '0')
                  select.append(el('option', { value: n.id }, '— '.repeat(depth) + n.title));
                for (const child of n.children || []) if (!child.url) folders(child, depth + 1);
              }
              tree.forEach((n) => folders(n));
              const { close } = popover(
                'Export browser bookmarks',
                field('Create a new group inside', select),
                [
                  button(
                    'Create bookmarks',
                    act(async () => {
                      await change('bookmarks-export', {
                        collectionId: c.id,
                        parentId: select.value,
                      });
                      close();
                    }),
                    { className: 'primary' },
                  ),
                ],
              );
            }),
          ),
        ),
      ),
      [],
      { menu: true, anchor: trigger },
    );
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('button')) close();
    });
  }
  function notionDialog(c) {
    const parent = el('input', {
      value: data.state.settings.notionParent,
      placeholder: 'Destination page ID',
    });
    const { close } = modal(
      'Send a snapshot to Notion',
      el(
        'div',
        {},
        el(
          'p',
          {},
          `Create a new page containing ${c.links.length} links and notes. People with access to the parent page may see this content.`,
        ),
        field('Destination page ID', parent),
        el(
          'p',
          { class: 'hint' },
          'Share the parent page with your internal integration first. Configure its token in Settings.',
        ),
      ),
      [
        button(
          'Create Notion page',
          act(async () => {
            if (!(await chrome.permissions.request({ origins: ['https://api.notion.com/*'] })))
              return;
            const result = await rpc('notion-export', {
              collectionId: c.id,
              parent: parent.value.trim(),
            });
            close();
            runNotion(result);
          }),
          { className: 'primary' },
        ),
      ],
    );
  }
  function runNotion(initial, resume = false) {
    let running = true,
      job = initial;
    const status = el('p', { role: 'status' }),
      link = el('div'),
      progress = el('progress', { max: Math.max(1, job.total), value: job.cursor });
    const { dialog, close } = modal(
      'Export to Notion',
      el(
        'div',
        {},
        status,
        progress,
        link,
        el(
          'p',
          { class: 'hint' },
          'You can pause between batches and continue from Recovery. A request already sent may finish after this dialog closes.',
        ),
      ),
      [
        button('Pause', () => {
          running = false;
          close();
        }),
      ],
    );
    dialog.addEventListener(
      'close',
      () => {
        running = false;
      },
      { once: true },
    );
    async function run() {
      try {
        while (running) {
          status.textContent = `${job.cursor} of ${job.total} blocks sent`;
          progress.value = job.cursor;
          if (job.remoteURL)
            link.replaceChildren(
              el(
                'a',
                { href: job.remoteURL, target: '_blank', rel: 'noreferrer' },
                'Open the Notion page',
              ),
            );
          if (job.status === 'complete') {
            status.textContent = 'Snapshot exported to Notion.';
            dialog.querySelector('footer').replaceChildren(button('Done', close));
            return;
          }
          if (!resume && ['partial', 'failed', 'uncertain', 'sending'].includes(job.status)) {
            status.textContent =
              job.error ||
              'This request may already be in Notion. Inspect the destination before taking another action.';
            dialog.querySelector('footer').replaceChildren(button('Close', close));
            return;
          }
          if (job.retryAt > Date.now()) {
            status.textContent = `${job.cursor} of ${job.total} blocks sent · waiting for Notion`;
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(1000, job.retryAt - Date.now())),
            );
            continue;
          }
          job = await rpc('notion-step', { id: job.id, resume });
          resume = false;
        }
      } catch (error) {
        if (running) {
          status.textContent = error.message;
          dialog.querySelector('footer').replaceChildren(button('Close', close));
        }
      }
    }
    run();
  }
  function aiDialog(c, { linkIds } = {}) {
    const instruction = el('textarea', {
        value: 'Group these links by project. Leave uncertain links ungrouped.',
      }),
      picks = linkPicker(linkIds ? c.links.filter((l) => linkIds.includes(l.id)) : c.links, {
        max: 300,
      });
    const requestId = uid(),
      status = el('p', { class: 'hint', role: 'status' });
    let running = false,
      cancelled = false;
    const generate = button(
      'Generate a plan',
      act(async () => {
        if (!picks.ids().length) throw new Error('Select between 1 and 300 links.');
        generate.disabled = true;
        running = true;
        status.textContent = 'Preparing your organisation plan…';
        try {
          const plan = await rpc('ai-plan', {
            requestId,
            collectionId: c.id,
            linkIds: picks.ids(),
            instruction: instruction.value,
          });
          if (!cancelled) {
            running = false;
            close();
            reviewPlan(c, plan);
          }
        } catch (error) {
          if (!cancelled) status.textContent = error.message;
        } finally {
          running = false;
          generate.disabled = false;
        }
      }),
      { className: 'primary' },
    );
    const { dialog, close } = modal(
      'Organise with AI',
      el(
        'div',
        {},
        !data.connections.ai
          ? el(
              'div',
              { class: 'ai-setup' },
              el(
                'p',
                { class: 'hint' },
                'Connect an AI provider in AI connection settings before generating a plan.',
              ),
              button('AI connection settings', () => settingsDetails('AI connection')),
            )
          : null,
        el(
          'p',
          {},
          `Send selected link titles, URLs and notes to ${PROVIDERS[data.state.settings.provider]?.name || 'your configured provider'}.`,
        ),
        el(
          'p',
          { class: 'hint' },
          'Choose up to 300 links. Page contents, previews, other collections and browser history are excluded.',
        ),
        picks.node,
        field('Instruction', instruction),
        status,
      ),
      [
        button('Cancel', () => {
          cancelled = true;
          close();
        }),
        generate,
      ],
    );
    dialog.addEventListener(
      'close',
      () => {
        cancelled = true;
        if (running) rpc('ai-cancel', { requestId }).catch(() => {});
      },
      { once: true },
    );
  }
  function reviewPlan(c, plan) {
    const groups = plan.groups.map((g) => {
      const check = el('input', {
        type: 'checkbox',
        checked: true,
        onchange: (e) => (g.accepted = e.target.checked),
      });
      return el(
        'div',
        { class: 'plan-group' },
        el(
          'div',
          { class: 'row' },
          check,
          el('input', {
            value: g.name,
            'aria-label': 'Proposed group name',
            oninput: (e) => (g.name = e.target.value),
          }),
        ),
        el(
          'ul',
          {},
          g.linkIds.map((id) =>
            el('li', {}, c.links.find((l) => l.id === id)?.title || 'Unknown link'),
          ),
        ),
      );
    });
    const note = el('textarea', { value: plan.note, oninput: (e) => (plan.note = e.target.value) }),
      applyNote = el('input', { type: 'checkbox' });
    const { close } = modal(
      'Review your organisation plan',
      el(
        'div',
        {},
        groups,
        el(
          'label',
          { class: 'check-label' },
          applyNote,
          'Replace the collection note with this draft',
        ),
        note,
      ),
      [
        button(
          'Apply selected changes',
          act(async () => {
            await change('ai-apply', { plan, applyNote: applyNote.checked });
            close();
          }),
          { className: 'primary' },
        ),
      ],
    );
  }
  function recoveryDialog() {
    modal(
      'Recovery',
      el(
        'div',
        {},
        el(
          'p',
          { class: 'hint' },
          'Recover saved URLs and groups. Unsaved form or app state cannot be restored. Interrupted actions are never replayed automatically.',
        ),
        data.journal.map((op) =>
          el(
            'div',
            { class: 'recovery-row' },
            el(
              'div',
              { class: 'row' },
              el('strong', {}, op.label),
              el('small', {}, new Date(op.at).toLocaleString()),
            ),
            el(
              'p',
              {},
              op.kind === 'notion' ? `${op.cursor} / ${op.total} blocks · ${op.status}` : op.status,
            ),
            op.error ? el('p', {}, op.error) : null,
            op.kind === 'notion' && ['ready', 'waiting', 'partial', 'failed'].includes(op.status)
              ? button('Continue export', () => runNotion(op, true))
              : null,
            op.kind === 'notion' && ['sending', 'uncertain'].includes(op.status)
              ? el(
                  'p',
                  { class: 'hint' },
                  'A batch may already be in Notion. Inspect the destination; it will not be sent again automatically.',
                )
              : null,
            op.recoverable
              ? button(
                  'Recover pages',
                  act(() => change('recover', { id: op.id, windowId: win })),
                )
              : null,
            op.undoable
              ? button(
                  'Restore earlier collection…',
                  act(() => recoverLibrary(op)),
                )
              : null,
            (op.undoable || op.closed?.length) && op.status !== 'undone'
              ? button(
                  'Undo action',
                  act(() => change('undo-action', { id: op.id, windowId: win })),
                )
              : null,
            op.remoteURL
              ? el('a', { href: op.remoteURL, target: '_blank', rel: 'noreferrer' }, 'Open export')
              : null,
          ),
        ),
      ),
    );
  }
  function focusedDialog(title, body, actions = []) {
    const result = modal(title, body, actions);
    result.dialog.classList.add('settings-detail');
    const focus =
      body.querySelector('input:not([type=file]), select, textarea') ||
      result.dialog.querySelector('h2');
    if (focus.tagName === 'H2') focus.tabIndex = -1;
    focus.focus({ preventScroll: true });
    return result;
  }
  function backupDialog() {
    focusedDialog(
      'Export & backup',
      el(
        'div',
        { class: 'transfer-options' },
        el(
          'p',
          { class: 'hint' },
          'Keep a copy of your collections, notes, preferences and recovery log. API keys are excluded.',
        ),
        button(
          'Download Neo backup',
          () =>
            download(backupExport(data.state, data.journal), 'neo-backup.json', 'application/json'),
          { glyph: 'tray', className: 'transfer-primary' },
        ),
        el(
          'details',
          {},
          el('summary', {}, 'Other formats'),
          el(
            'div',
            { class: 'transfer-formats' },
            button('Bookmark HTML', () =>
              download(htmlExport(data.state.collections), 'neo-bookmarks.html', 'text/html'),
            ),
            button('Markdown', () =>
              download(
                markdownExport(data.state.collections),
                'neo-collections.md',
                'text/markdown',
              ),
            ),
          ),
        ),
        button('Switch to Import data', importDialog),
      ),
    );
  }
  function settingsDialog() {
    const s = data.state.settings;
    const body = el('div', { class: 'settings-list' });
    let close;
    const row = (label, run, glyph) =>
      button(
        label,
        () => {
          close();
          run();
        },
        { glyph, className: 'settings-entry' },
      );
    const preference = (label, name, options) => {
      const select = el(
        'select',
        { 'aria-label': label },
        options.map(([value, text]) => el('option', { value, selected: s[name] === value }, text)),
      );
      select.onchange = act(async () => {
        select.disabled = true;
        try {
          await change('settings', { settings: { [name]: select.value } });
        } finally {
          select.disabled = false;
        }
      });
      return el('label', { class: 'settings-preference' }, el('span', {}, label), select);
    };
    const toggle = (label, name) => {
      const check = el('input', {
        type: 'checkbox',
        role: 'switch',
        checked: !!s[name],
        'aria-label': label,
      });
      check.onchange = act(async () => {
        const value = check.checked;
        check.disabled = true;
        try {
          if (
            name === 'previewCapture' &&
            value &&
            !(await chrome.permissions.request({ origins: ['<all_urls>'] }))
          ) {
            check.checked = false;
            toast('Preview access was not enabled');
            return;
          }
          await change('settings', { settings: { [name]: value } });
        } catch (error) {
          check.checked = !value;
          throw error;
        } finally {
          check.disabled = false;
        }
      });
      return el('label', { class: 'settings-preference' }, el('span', {}, label), check);
    };
    body.append(
      preference('Theme', 'theme', [
        ['system', 'System'],
        ['light', 'Light'],
        ['dark', 'Dark'],
      ]),
      toggle('Show this window only', 'currentWindowOnly'),
      toggle('Capture page previews', 'previewCapture'),
      el('hr'),
      row('AI connection', () => settingsDetails('AI connection'), 'sparkles'),
      row('Notion', () => settingsDetails('Notion'), 'note'),
      row('Domain rules', () => settingsDetails('Domain rules'), 'group'),
      el('hr'),
      row('Import data', importDialog, 'plus'),
      row('Export & backup', backupDialog, 'tray'),
      row('Privacy & permissions', () => settingsDetails('Data & permissions'), 'settings'),
      el('hr'),
      row(
        'Keyboard shortcuts',
        () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }),
        'external',
      ),
      row(
        'Help & privacy',
        () => chrome.tabs.create({ url: chrome.runtime.getURL('help.html') }),
        'external',
      ),
    );
    const result = popover('Settings', body);
    close = result.close;
    result.dialog.classList.add('settings-menu');
    // Preserve the original anchor after CSS changes the menu dimensions.
    const bounds = result.dialog.getBoundingClientRect();
    result.dialog.style.left =
      Math.max(12, Math.min(innerWidth - bounds.width - 12, bounds.left)) + 'px';
    result.dialog.style.top =
      Math.max(12, Math.min(innerHeight - bounds.height - 12, bounds.top)) + 'px';
    const trigger = $('#settings');
    trigger?.setAttribute('aria-expanded', 'true');
    result.dialog.addEventListener('toggle', (e) => {
      if (e.newState === 'closed') trigger?.setAttribute('aria-expanded', 'false');
    });
    result.dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        trigger?.focus();
      }
    });
    body.querySelector('select').focus({ preventScroll: true });
  }
  function settingsDetails(sectionName = 'AI connection') {
    const s = data.state.settings;
    const fields = {};
    const input = (name, type = 'text') =>
      (fields[name] = el('input', { value: s[name] || '', type }));
    const select = (name, choices) =>
      (fields[name] = el(
        'select',
        {},
        choices.map((v) =>
          el(
            'option',
            { value: v, selected: s[name] === v },
            name === 'provider' ? PROVIDERS[v].name : v[0].toUpperCase() + v.slice(1),
          ),
        ),
      ));
    const aiKey = el('input', {
        type: 'password',
        autocomplete: 'off',
        placeholder: data.connections.ai ? 'Saved · leave blank to keep' : 'Your API key',
      }),
      notionKey = el('input', {
        type: 'password',
        autocomplete: 'off',
        placeholder: data.connections.notion
          ? 'Saved · leave blank to keep'
          : 'Your internal integration token',
      });
    const rules = el('textarea', {
      rows: 3,
      value: s.rules.map((r) => `${r.domain} => ${r.group}`).join('\n'),
      placeholder: 'github.com => Development',
    });
    const body = el(
      'div',
      {},
      el(
        'section',
        { class: 'settings-section' },
        el('h3', {}, 'AI connection'),
        field('Provider', select('provider', Object.keys(PROVIDERS))),
        field('Model', input('model')),
        field('Compatible endpoint (complete chat/completions URL)', input('aiEndpoint')),
        field('API key', aiKey),
        el(
          'p',
          { class: 'hint' },
          'Calls go directly to your provider only when requested. Keys stay in extension-local storage, outside backups; they are not encrypted by an OS keychain.',
        ),
        button(
          'Forget AI key',
          act(async () => {
            await change('credentials', {
              aiKey: '',
              aiProvider: fields.provider.value,
              aiEndpoint: fields.aiEndpoint.value,
            });
            aiKey.value = '';
            updateProvider();
          }),
        ),
      ),
      el(
        'section',
        { class: 'settings-section' },
        el('h3', {}, 'Notion'),
        field('Notion integration token', notionKey),
        field('Notion parent page ID', input('notionParent')),
        button(
          'Forget Notion token',
          act(() => change('credentials', { notionKey: '' })),
        ),
      ),
      el(
        'section',
        { class: 'settings-section' },
        el('h3', {}, 'Domain rules'),
        field('One domain => group per line', rules),
        el(
          'p',
          { class: 'hint' },
          'Rules run only when you choose Apply domain rules in a collection menu.',
        ),
      ),
      el(
        'section',
        { class: 'settings-section' },
        el('h3', {}, 'Data & permissions'),
        button('Export & backup', backupDialog),
        button(
          'Enable browser history search',
          act(async () => {
            const granted = await chrome.permissions.request({ permissions: ['history'] });
            toast(granted ? 'History search enabled' : 'History access was not enabled');
          }),
        ),
        button(
          'Revoke optional access',
          act(async () => {
            const p = await chrome.permissions.getAll();
            await chrome.permissions.remove({
              origins: p.origins || [],
              permissions: (p.permissions || []).filter((x) =>
                ['history', 'bookmarks'].includes(x),
              ),
            });
            await change('settings', { settings: { previewCapture: false } });
            toast('Optional access revoked');
          }),
        ),
        el(
          'p',
          { class: 'hint' },
          'No account, telemetry or server is required. Export a backup before uninstalling, which removes this extension’s local data.',
        ),
      ),
    );
    const section = [...body.querySelectorAll('.settings-section')].find(
      (node) => node.querySelector('h3').textContent === sectionName,
    );
    section.querySelector('h3').remove();
    body.replaceChildren(section);
    if (sectionName === 'Data & permissions') {
      section.prepend(
        el(
          'p',
          { class: 'hint' },
          'Previews stay on this device. Only active pages are captured. The cache is limited to 50 MB.',
        ),
        button(
          'Clear cached previews',
          act(() => change('clear-previews', {})),
        ),
      );
    }
    function draftConnection() {
      return { provider: fields.provider.value, aiEndpoint: fields.aiEndpoint.value };
    }
    function updateProvider(reset = false) {
      if (sectionName !== 'AI connection') return;
      const provider = PROVIDERS[fields.provider.value];
      if (reset) {
        fields.model.value = provider.model;
        fields.aiEndpoint.value = provider.endpoint;
        aiKey.value = '';
      }
      fields.aiEndpoint.closest('.field').hidden = fields.provider.value !== 'compatible';
      aiKey.placeholder = data.connections.aiProviders?.[aiConnectionId(draftConnection())]
        ? 'Saved for this provider · leave blank to keep'
        : 'API key for ' + provider.name;
    }
    if (sectionName === 'AI connection') {
      fields.provider.onchange = () => updateProvider(true);
      fields.aiEndpoint.oninput = () => updateProvider();
      updateProvider();
    }
    const activeFields = Object.fromEntries(
      Object.entries(fields).filter(([, node]) => section.contains(node)),
    );
    const { close } = focusedDialog(
      sectionName === 'Data & permissions' ? 'Privacy & permissions' : sectionName,
      body,
      sectionName === 'Data & permissions'
        ? []
        : [
            button(
              'Save settings',
              act(async () => {
                const settings = Object.fromEntries(
                  Object.entries(activeFields).map(([k, v]) => [k, v.value]),
                );
                if (sectionName === 'Domain rules')
                  settings.rules = rules.value
                    .split('\n')
                    .filter((x) => x.trim())
                    .map((line) => {
                      const [domain, ...parts] = line.split('=>');
                      if (!parts.length) throw new Error('Use domain => group for each rule.');
                      return { domain: domain.trim(), group: parts.join('=>').trim() };
                    });
                const origins = [];
                if (
                  sectionName === 'AI connection' &&
                  (aiKey.value.trim() ||
                    data.connections.aiProviders?.[aiConnectionId(settings)] ||
                    (settings.provider === 'compatible' && settings.aiEndpoint))
                )
                  origins.push(endpointOrigin(providerEndpoint(settings)) + '/*');
                if (sectionName === 'Notion' && notionKey.value.trim())
                  origins.push('https://api.notion.com/*');
                if (
                  origins.length &&
                  !(await chrome.permissions.request({ origins: [...new Set(origins)] }))
                )
                  throw new Error('Permission was not granted. Settings were not saved.');
                await change('settings', { settings });
                const credentials = {};
                if (sectionName === 'AI connection' && aiKey.value.trim())
                  Object.assign(credentials, {
                    aiKey: aiKey.value.trim(),
                    aiProvider: settings.provider,
                    aiEndpoint: settings.aiEndpoint,
                  });
                if (sectionName === 'Notion' && notionKey.value.trim())
                  credentials.notionKey = notionKey.value.trim();
                if (Object.keys(credentials).length) await change('credentials', credentials);
                close();
              }),
              { className: 'primary' },
            ),
          ],
    );
  }

  function noteDialog(c) {
    const input = el('textarea', {
      value: c.note,
      rows: 7,
      maxLength: 10000,
      'aria-label': 'Continuation note',
    });
    const { close } = popover('Note · ' + c.name, input, [
      button(
        'Save note',
        act(async () => {
          await change('edit', { kind: 'collection', collectionId: c.id, note: input.value });
          close();
        }),
        { className: 'primary' },
      ),
    ]);
  }
  async function recoverLibrary(op) {
    const collections = await rpc('library-snapshot', { id: op.id });
    const selected = new Set();
    const list = el(
      'div',
      { class: 'review-list' },
      collections.map((c) =>
        el(
          'label',
          {},
          el('input', {
            type: 'checkbox',
            onchange: (event) =>
              event.target.checked ? selected.add(c.id) : selected.delete(c.id),
          }),
          el('span', { class: 'row-title' }, c.name),
          el('small', {}, `${c.links.length} links`),
        ),
      ),
    );
    const { close } = modal(
      'Restore an earlier collection',
      el(
        'div',
        {},
        el(
          'p',
          { class: 'hint' },
          'Choose collections from before this action. They are restored as separate copies, keeping your current work.',
        ),
        list,
      ),
      [
        button(
          'Restore selected copies',
          act(async () => {
            if (!selected.size) throw new Error('Choose a collection first.');
            await change('restore-library', { id: op.id, collectionIds: [...selected] });
            close();
          }),
          { className: 'primary' },
        ),
      ],
    );
  }
  async function updateCollection(context) {
    const plan = await rpc('collection-update-preview', {
      collectionId: context.id,
      windowId: win,
    });
    const picked = new Set(plan.additions.map((l) => l.url));
    const status = el('p', { class: 'hint', role: 'status' });
    const commit = button(
      '',
      act(async () => {
        commit.disabled = true;
        try {
          await change('collection-update', {
            collectionId: context.id,
            windowId: win,
            expectedRevision: plan.revision,
            signature: plan.signature,
            urls: [...picked],
          });
          close();
        } catch (error) {
          status.textContent = error.message;
        } finally {
          commit.disabled = !picked.size;
        }
      }),
      { className: 'primary' },
    );
    const updateLabel = () => {
      commit.textContent = 'Add ' + picked.size + (picked.size === 1 ? ' tab' : ' tabs');
      commit.setAttribute('aria-label', commit.textContent);
      commit.disabled = !picked.size;
    };
    const body = el(
      'div',
      {},
      el('p', { class: 'hint' }, `Current window · ${plan.currentCount} unpinned tabs`),
      el('p', {}, `${plan.additions.length} new · ${plan.alreadySaved} already saved`),
      el(
        'p',
        { class: 'hint' },
        'Adds selected tabs. Existing saved links, custom titles and notes are kept.',
      ),
      el(
        'div',
        { class: 'collection-update-list' },
        plan.additions.map((link) =>
          el(
            'label',
            { class: 'collection-update-row', title: link.url },
            el('input', {
              type: 'checkbox',
              checked: true,
              'aria-label': 'Add ' + link.title,
              onchange: (e) => {
                e.target.checked ? picked.add(link.url) : picked.delete(link.url);
                updateLabel();
              },
            }),
            favicon(link),
            el('span', {}, el('strong', {}, link.title), el('small', {}, domain(link.url))),
          ),
        ),
      ),
      !plan.additions.length
        ? el(
            'p',
            {},
            plan.currentCount
              ? 'All current tabs are already saved.'
              : 'No open pages to add from this window.',
          )
        : null,
      status,
    );
    const { close } = modal('Update ' + context.name, body, [
      button('Cancel', () => close()),
      button(
        'Review again',
        act(() => updateCollection(context)),
      ),
      commit,
    ]);
    updateLabel();
  }
  async function collectionVersions(c) {
    const rows = await rpc('collection-versions', { collectionId: c.id });
    const body = el('div', { class: 'collection-versions' });
    body.append(
      el(
        'p',
        { class: 'hint' },
        'Previous versions of ' + c.name + '. Restoring keeps the current version in this history.',
      ),
    );
    for (const row of rows) {
      const details = el(
        'details',
        { class: 'session-entry collection-version', dataset: { versionId: row.id } },
        el(
          'summary',
          {},
          new Date(row.at).toLocaleString(),
          el(
            'small',
            {},
            `${row.snapshot.links.length} ${row.snapshot.links.length === 1 ? 'tab' : 'tabs'}${row.version ? ' · Saved version' : ' · Earlier snapshot'}`,
          ),
        ),
      );
      for (const link of row.snapshot.links)
        details.append(
          el(
            'div',
            { class: 'session-page' },
            favicon(link),
            el('span', { class: 'row-title' }, link.title, el('small', {}, domain(link.url))),
          ),
        );
      details.append(
        button(
          'Restore this version',
          act(async () => {
            await change('collection-version-restore', {
              collectionId: c.id,
              id: row.id,
              windowId: win,
            });
            close();
            toast('Collection version restored');
          }),
          { className: 'session-restore' },
        ),
      );
      body.append(details);
    }
    if (!rows.length)
      body.append(
        el(
          'p',
          { class: 'empty' },
          'No previous versions yet. Changes will appear here automatically.',
        ),
      );
    const { close } = modal('Version history · ' + c.name, body);
  }
  function stashDialog(context) {
    return saveTo(context, { closeTabs: true });
  }
  return {
    save: saveTo,
    update: updateCollection,
    versions: collectionVersions,
    stash: stashDialog,
    resume: resumeDialog,
    switch: switchDialog,
    swap: swapCollection,
    closeCollection,
    note: noteDialog,
    export: exportDialog,
    ai: aiDialog,
    recovery: recoveryDialog,
    settings: settingsDialog,
    aiSettings: () => settingsDetails('AI connection'),
    import: importDialog,
    previewImport,
    reviewPlan,
  };
}

// SPDX-License-Identifier: MPL-2.0
import { el, button, icon, popover, task, menu } from './shared.js';
import { duplicateCandidates } from '../lib/model.js';

export function orderedTabs(tabs, order = 'recent') {
  const sorted = [...tabs].sort(
    order === 'recent'
      ? (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
      : (a, b) => a.windowId - b.windowId || a.index - b.index,
  );
  return order === 'reverse' ? sorted.reverse() : sorted;
}

// Both tab surfaces use these exact controls, settings and save dialog.
export function createTabTools({ getTabs, getSettings, change, actions, compact = false }) {
  const sort = button(
    'Sort tabs',
    (e) =>
      menu(
        'Sort tabs',
        [
          ['recent', 'Most recent first'],
          ['position', 'Position in tab bar'],
          ['reverse', 'Reverse tab order'],
        ].map(([tabSort, label]) => [
          label,
          () => change('settings', { settings: { tabSort } }),
          getSettings().tabSort === tabSort ? 'check' : undefined,
        ]),
        { anchor: e.currentTarget },
      ),
    { glyph: 'sort', quiet: compact },
  );
  const save = button('Save tabs', () => actions.save(), { glyph: 'tray', quiet: compact });
  const dedup = button(
    'Close duplicate tabs',
    task(async () => {
      const tabIds = duplicateCandidates(getTabs());
      if (tabIds.length) await change('close', { tabIds });
    }),
    { glyph: 'broom', quiet: compact, className: 'dedup-button' },
  );
  const node = el(
    'div',
    { class: 'tab-tools' + (compact ? ' compact' : ''), 'aria-label': 'Tab actions' },
    sort,
    save,
    dedup,
  );
  function update() {
    const count = duplicateCandidates(getTabs()).length;
    dedup.replaceChildren(
      icon('broom'),
      ...(compact ? [] : ['Duplicates']),
      ...(count
        ? [el('span', { class: 'count-badge', 'aria-hidden': 'true' }, count > 99 ? '99+' : count)]
        : []),
    );
    dedup.title = count
      ? `Close ${count} duplicate tab${count === 1 ? '' : 's'}`
      : 'No duplicate tabs';
    dedup.setAttribute('aria-label', dedup.title);
    dedup.disabled = !count;
    save.disabled = !getTabs().some((t) => !t.pinned);
  }
  update();
  return { node, update, save, dedup };
}

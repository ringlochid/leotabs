// SPDX-License-Identifier: MPL-2.0
import { nearestRow, rowSlot } from './insertion.js';

// Preview and commit use this one plan. Saved collections render loose links
// first, followed by groups; an indicator must respect that same structure.
export function collectionDropPlan(card, collection, point, payload) {
  const body = card.querySelector('.collection-body');
  const groupDrag = payload.type === 'group' || payload.wholeGroup === true;
  const own = payload.collectionId === collection.id;
  const excluded = new Set(own && !groupDrag ? payload.linkIds || [payload.linkId] : []);
  const groups = [...card.querySelectorAll('.saved-group')]
    .filter(node => !(own && groupDrag && node.dataset.groupId === payload.groupId));
  const header = card.querySelector('.collection-head').getBoundingClientRect();
  const fallback = { left: header.left + 6, top: header.bottom - 1, width: header.width - 12, height: 2 };
  if (groupDrag) {
    const nearest = nearestRow(groups, point.y);
    if (nearest) {
      const slot = rowSlot(groups, nearest, point.y);
      const ordered = collection.groups.filter(group => !(own && group.id === payload.groupId));
      const beforeId = slot.next?.dataset.groupId || (slot.after ? ordered[ordered.findIndex(group => group.id === nearest.dataset.groupId) + 1]?.id : undefined);
      return { rect: slot, beforeId, group: true };
    }
    const loose = [...(body?.querySelectorAll(':scope > .saved-row') || [])];
    const last = loose.at(-1)?.getBoundingClientRect();
    return { rect: last ? { left: last.left, top: last.bottom - 1, width: last.width, height: 2 } : fallback, group: true };
  }
  const group = groups.find(node => {
    const rect = node.getBoundingClientRect();
    return point.y >= rect.top && point.y <= rect.bottom && point.x >= rect.left;
  });
  const groupId = group?.dataset.groupId || null;
  const list = group?.querySelector('.group-members') || (group ? null : body);
  const nodes = [...(list?.querySelectorAll(':scope > .saved-row') || [])]
    .filter(node => !excluded.has(node.dataset.linkId));
  const nearest = nearestRow(nodes, point.y);
  const links = collection.links.filter(link => (link.groupId || null) === groupId && !excluded.has(link.id));
  if (nearest) {
    const slot = rowSlot(nodes, nearest, point.y);
    // A preview may hide following links. Insert after the last visible link,
    // before the first hidden one, rather than jumping to the collection end.
    const id = slot.next?.dataset.linkId || (slot.after ? links[links.findIndex(link => link.id === nearest.dataset.linkId) + 1]?.id : undefined);
    return { rect: slot, beforeId: id, groupId, group: false };
  }
  if (group) {
    const rect = group.querySelector('.group-header').getBoundingClientRect();
    return { rect: { left: rect.left + 18, top: rect.bottom - 1, width: rect.width - 18, height: 2 }, groupId, group: false };
  }
  const first = groups[0]?.getBoundingClientRect();
  const rect = first ? { left: first.left, top: first.top - 1, width: first.width, height: 2 } : fallback;
  return { rect, groupId: null, group: false };
}

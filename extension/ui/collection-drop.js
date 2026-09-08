// SPDX-License-Identifier: MPL-2.0
import { nearestRow, rowSlot } from './insertion.js';

const NEUTRAL = 4;
const EDGE_REACH = 24;
const inside = (rect, point) => point.x >= rect.left && point.x <= rect.right &&
  point.y >= rect.top && point.y <= rect.bottom;
const line = (rect, y, indent = 0) => ({left:rect.left+indent, top:y-1, width:rect.width-indent, height:2});

function nearbySlot(nodes, point, {groups = false} = {}) {
  const first = nodes[0]?.getBoundingClientRect(), last = nodes.at(-1)?.getBoundingClientRect();
  const padding = groups ? EDGE_REACH : 6;
  if (!first || point.y < first.top-padding || point.y > last.bottom+padding) return null;
  const nearest = nearestRow(nodes, point.y);
  if (!nearest) return null;
  const rect = nearest.getBoundingClientRect();
  if (point.x < rect.left || point.x > rect.right) return null;
  // The center is intentionally neutral: tiny pointer movements must not flip
  // the line between opposite ends of a row (or a tall expanded group).
  if (Math.abs(point.y - (rect.top + rect.bottom) / 2) < NEUTRAL) return null;
  const slot = rowSlot(nodes, nearest, point.y);
  const distance = Math.abs(point.y - (slot.top + 1));
  if (distance > (groups ? EDGE_REACH : rect.height / 2 + 6)) return null;
  return {slot, nearest};
}

function anchor(items, id, after, excluded) {
  let index = items.findIndex(item => item.id === id) + Number(after);
  while (index < items.length && excluded.has(items[index]?.id)) index++;
  return items[index]?.id;
}

// Preview and drop resolve the same bounded target. No target means no line
// AND no mutation. Notes, controls, and gaps between unrelated lists never
// fall back to a distant loose row. Source items stay in the visual geometry.
export function collectionDropPlan(card, collection, point, payload, {copy = false} = {}) {
  const body = card.querySelector('.collection-body');
  const groupDrag = payload.type === 'group' || payload.wholeGroup === true;
  const own = !copy && payload.collectionId === collection.id;
  const excluded = new Set(own ? groupDrag ? [payload.groupId] : payload.linkIds || [payload.linkId] : []);
  const groups = [...card.querySelectorAll('.saved-group')];
  const loose = [...(body?.querySelectorAll(':scope > .saved-row') || [])];
  const header = card.querySelector('.collection-head').getBoundingClientRect();
  const headerTarget = inside(header, point);

  if (groupDrag) {
    const target = nearbySlot(groups, point, {groups:true});
    if (target) {
      const {slot, nearest} = target;
      return {rect:slot, beforeId:anchor(collection.groups, nearest.dataset.groupId, slot.after, excluded), group:true};
    }
    if (!groups.length) {
      const last = loose.at(-1)?.getBoundingClientRect();
      if (last && point.x >= last.left && point.x <= last.right && Math.abs(point.y-last.bottom) <= EDGE_REACH)
        return {rect:line(last,last.bottom), group:true};
      if (!last && headerTarget) return {rect:line(header,header.bottom,6), group:true};
    }
    return null;
  }

  if (headerTarget) {
    const first = loose[0]?.getBoundingClientRect();
    const links = collection.links.filter(link => !link.groupId);
    return {rect:first ? line(first,first.top) : line(header,header.bottom,6),
      beforeId:links.find(link=>!excluded.has(link.id))?.id, groupId:null, group:false};
  }
  const group = groups.find(node => inside(node.getBoundingClientRect(), point));
  const groupId = group?.dataset.groupId || null;
  const list = group ? group.querySelector('.group-members') : body;
  const nodes = [...(list?.querySelectorAll(':scope > .saved-row') || [])];
  const links = collection.links.filter(link => (link.groupId || null) === groupId);
  if (group) {
    const heading = group.querySelector('.group-header').getBoundingClientRect();
    if (inside(heading, point)) {
      // Entering a group is explicit on its header. A folded group's line
      // marks its first position; the group opens after the completed drop.
      const first = nodes[0]?.getBoundingClientRect();
      return {rect:first ? line(first,first.top) : line(heading,heading.bottom,18),
        beforeId:links.find(link=>!excluded.has(link.id))?.id, groupId, group:false};
    }
  } else {
    // Loose links always precede groups. Gaps beside/between/below groups are
    // not alternative loose-link positions, even when the collection is tall.
    if (groups.some(node => point.y >= node.getBoundingClientRect().top)) return null;
  }
  const target = nearbySlot(nodes, point);
  if (!target) return null;
  const {slot, nearest} = target;
  return {rect:slot, beforeId:anchor(links,nearest.dataset.linkId,slot.after,excluded), groupId, group:false};
}

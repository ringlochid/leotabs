// SPDX-License-Identifier: MPL-2.0
const BAR = 2;

// A boundary belongs to the gap, rather than to either adjacent item. This
// keeps its geometry identical when approached from either side.
export function collectionSlot(
  items,
  hoveredId,
  point,
  { list = false, gapX = 28, gapY = 30 } = {},
) {
  const index = items.findIndex((item) => item.id === hoveredId);
  if (index < 0) return null;
  const hovered = items[index].rect;
  const after = list
    ? point.y > (hovered.top + hovered.bottom) / 2
    : point.x > (hovered.left + hovered.right) / 2;
  const boundary = index + Number(after),
    previous = items[boundary - 1],
    next = items[boundary];
  const a = previous?.rect,
    b = next?.rect;
  if (list) {
    const rect = b || a;
    const y = a && b ? (a.bottom + b.top) / 2 : b ? b.top - gapY / 2 : a.bottom + gapY / 2;
    return {
      beforeId: next?.id,
      left: rect.left,
      top: y - BAR / 2,
      width: rect.right - rect.left,
      height: BAR,
    };
  }
  const adjacent =
    a && b && Math.abs(a.top - b.top) < 2 && b.left >= a.right && b.left - a.right <= gapX * 1.5;
  const rect = b || a;
  const x = adjacent ? (a.right + b.left) / 2 : b ? b.left - gapX / 2 : a.right + gapX / 2;
  const top = adjacent ? Math.min(a.top, b.top) : rect.top;
  const bottom = adjacent ? Math.max(a.bottom, b.bottom) : rect.bottom;
  return { beforeId: next?.id, left: x - BAR / 2, top, width: BAR, height: bottom - top };
}

export function rowSlot(nodes, node, y) {
  const index = nodes.indexOf(node),
    rect = node.getBoundingClientRect();
  const after = y > (rect.top + rect.bottom) / 2;
  const previous = after ? node : nodes[index - 1],
    next = after ? nodes[index + 1] : node;
  const a = previous?.getBoundingClientRect(),
    b = next?.getBoundingClientRect();
  const edge = a && b ? (a.bottom + b.top) / 2 : b ? b.top : a.bottom;
  return { after, next, left: rect.left, top: edge - BAR / 2, width: rect.width, height: BAR };
}

// Resolve the same boundary across rows AND their intervening padding/gaps.
// DOM hit targets switch to the parent in those gaps; treating that parent as
// an append target makes the indicator jump to the end of the group.
export function nearestRow(nodes, y) {
  return nodes.reduce((best, node) => {
    const rect = node.getBoundingClientRect();
    const distance = Math.max(rect.top - y, 0, y - rect.bottom);
    return !best || distance < best.distance ? { node, distance } : best;
  }, null)?.node;
}

export function createInsertionIndicator() {
  let marker;
  return {
    clear() {
      marker?.remove();
      marker = null;
    },
    show(rect, container, kind) {
      if (!rect) return this.clear();
      const clip = container.getBoundingClientRect();
      const left = Math.max(0, clip.left, rect.left),
        top = Math.max(0, clip.top, rect.top);
      const right = Math.min(innerWidth, clip.right, rect.left + rect.width);
      const bottom = Math.min(innerHeight, clip.bottom, rect.top + rect.height);
      if (right <= left || bottom <= top) return this.clear();
      if (!marker) {
        marker = document.createElement('div');
        marker.className = 'drop-insertion';
        marker.setAttribute('aria-hidden', 'true');
        document.body.append(marker);
      }
      marker.dataset.kind = kind;
      Object.assign(marker.style, {
        left: left + 'px',
        top: top + 'px',
        width: right - left + 'px',
        height: bottom - top + 'px',
      });
    },
  };
}

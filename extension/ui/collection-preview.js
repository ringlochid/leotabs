// SPDX-License-Identifier: MPL-2.0
// A collection has one visual row budget. Group headings consume a row too,
// including empty/folded groups, so adding groups cannot bypass the preview.
export function collectionPreview(ungrouped, groups, limit) {
  let remaining = limit;
  const links = ungrouped.slice(0, remaining);
  remaining -= links.length;
  let hiddenTabs = ungrouped.length - links.length, hiddenGroups = 0;
  const visibleGroups = [];
  for (const section of groups) {
    const open = !section.collapsed;
    // Never leave an expanded nonempty group heading stranded at the cutoff.
    const minimum = open && section.links.length ? 2 : 1;
    if (remaining < minimum) {
      hiddenTabs += section.links.length;
      hiddenGroups++;
      remaining = 0;
      continue;
    }
    remaining--;
    const members = open ? section.links.slice(0, remaining) : [];
    remaining -= members.length;
    if (open) hiddenTabs += section.links.length - members.length;
    visibleGroups.push({ ...section, links: members });
  }
  return { links, groups: visibleGroups, hiddenTabs, hiddenGroups,
    hasMore: hiddenTabs > 0 || hiddenGroups > 0 };
}

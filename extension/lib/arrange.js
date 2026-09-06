// SPDX-License-Identifier: MPL-2.0
export const DEFAULT_RULES = [{ id: 'github', domain: 'github.com/*', group: 'Github' }];
export function matchingRule(url, rules) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  const value = u.hostname + u.pathname + u.search;
  return rules.filter(r => r.enabled !== false).find(r => {
    const pattern = r.domain.replace(/^https?:\/\//, '').toLowerCase();
    if (!pattern.includes('/')) return u.hostname === pattern || u.hostname.endsWith('.' + pattern);
    const escaped = pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp('^' + escaped + '$', 'i').test(value);
  });
}
export function arrangeSaved(c, rules) {
  for (const link of c.links) {
    if (link.groupId) continue;
    const rule = matchingRule(link.url, rules);
    if (!rule) continue;
    let group = c.groups.find(g => g.name === rule.group);
    if (!group) { group = {id:crypto.randomUUID(), name:rule.group, color:'blue', collapsed:false}; c.groups.push(group); }
    link.groupId = group.id;
  }
  return c;
}

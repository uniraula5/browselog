export function normalizeSite(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  let url;
  try {
    url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`);
  } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const site = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!site || !site.includes('.') || site.length > 253) return null;
  return site;
}

export function siteMatches(site, ruleSite) {
  if (typeof site !== 'string' || typeof ruleSite !== 'string') return false;
  return site === ruleSite || site.endsWith(`.${ruleSite}`);
}

export function isExcluded(site, excludedSites = []) {
  return Array.isArray(excludedSites) && excludedSites.some(item =>
    typeof item === 'string' && siteMatches(site, item));
}

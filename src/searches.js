// Only these search result pages have a query format BrowseLog understands.
const GOOGLE_HOSTS = new Set([
  'google.com', 'google.ca', 'google.co.uk', 'google.com.au', 'google.com.np'
]);

export function parseSearch(address) {
  let url;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let engine;
  let parameter;
  if (GOOGLE_HOSTS.has(host) && url.pathname === '/search') {
    engine = 'Google';
    parameter = 'q';
  } else if (host === 'bing.com' && url.pathname === '/search') {
    engine = 'Bing';
    parameter = 'q';
  } else if ((host === 'youtube.com' || host === 'm.youtube.com') &&
      url.pathname === '/results') {
    engine = 'YouTube';
    parameter = 'search_query';
  } else {
    return null;
  }

  const query = url.searchParams.get(parameter)?.replace(/\s+/g, ' ').trim();
  if (!query) return null;
  return { engine, query: query.slice(0, 500) };
}

// YouTube watch pages keep the video ID in the query, while Shorts use the path.
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

export function parseVideo(address) {
  let url;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return null;

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    return VIDEO_ID.test(id || '') ? { id, format: 'Video' } : null;
  }

  const shorts = url.pathname.match(/^\/shorts\/([^/]+)\/?$/);
  const id = shorts?.[1];
  return VIDEO_ID.test(id || '') ? { id, format: 'Shorts' } : null;
}

// These examples come only from labels saved by the user.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'you',
  'are', 'how', 'what', 'why', 'part', 'video', 'youtube', 'shorts', 'watch'
]);

export function words(text) {
  return new Set((String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => word.length >= 3 && !/^\d+$/.test(word) && !STOP_WORDS.has(word)));
}

export function makeExample(visit, purpose, topic) {
  return {
    id: visit.cloudId || visit.id, site: visit.site, format: visit.format || 'webpage',
    accountUid: visit.accountUid,
    text: String(visit.searchQuery || visit.title || '').slice(0, 500), purpose, topic
  };
}

export function saveExample(examples, example) {
  const earlier = Array.isArray(examples) ? examples : [];
  return [example, ...earlier.filter(item => item?.id !== example.id)].slice(0, 300);
}

export function removeExample(examples, id) {
  return (Array.isArray(examples) ? examples : []).filter(example => example?.id !== id);
}

function similarWords(first, second) {
  const a = words(first);
  const b = words(second);
  if (a.size < 2 || b.size < 2) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared >= 2 && shared / Math.min(a.size, b.size) >= 0.6;
}

function choose(examples, key, minimum) {
  const votes = new Map();
  for (const example of examples) {
    const value = example[key];
    if (!value || value === 'unknown') continue;
    votes.set(value, (votes.get(value) || 0) + 1);
  }
  const [value, count] = [...votes].sort((a, b) => b[1] - a[1])[0] || [];
  return count >= minimum && count / examples.length >= 0.75 ? value : null;
}

export function learnedLabels(visit, format, examples = []) {
  if (!Array.isArray(examples)) return null;
  const content = ['video', 'shorts', 'search'].includes(format);
  const text = visit.searchQuery || visit.title || '';
  const related = examples.filter(example => {
    if (!example || example.format !== format) return false;
    if (example.accountUid !== visit.accountUid) return false;
    const youtubeSite = site => site === 'youtube.com' || site?.endsWith('.youtube.com');
    const sameSite = example.site === visit.site ||
      (youtubeSite(example.site) && youtubeSite(visit.site));
    if (!sameSite) return false;
    return !content || similarWords(text, example.text);
  });
  const minimum = content ? 2 : 3;
  if (related.length < minimum) return null;
  const purpose = choose(related, 'purpose', minimum);
  const topic = choose(related, 'topic', minimum);
  if (!purpose && !topic) return null;
  return { purpose, topic, learnedFrom: related.length };
}

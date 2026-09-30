export function engagedTime(visit) {
  const active = Math.max(0, visit.activeMs || visit.focusedMs || 0);
  const playback = Math.max(0, visit.playbackMs || 0);
  const overlap = Math.min(active, playback, Math.max(0, visit.overlapMs || 0));
  return active + playback - overlap;
}

export function summarize(visits) {
  const result = {
    visits: visits.length, searches: 0, shorts: 0,
    activeMs: 0, playbackMs: 0, engagedMs: 0,
    sites: {}, purposes: {}, topics: {}, formats: {}
  };
  for (const visit of visits) {
    const active = Math.max(0, visit.activeMs || visit.focusedMs || 0);
    const playback = Math.max(0, visit.playbackMs || 0);
    const engaged = engagedTime(visit);
    result.activeMs += active;
    result.playbackMs += playback;
    result.engagedMs += engaged;
    if (visit.searchQuery) result.searches++;
    if (visit.videoFormat === 'Shorts') result.shorts++;
    const groups = [
      [result.sites, visit.site || 'unknown'],
      [result.purposes, visit.purpose || 'unknown'],
      [result.topics, visit.topic || 'unknown'],
      [result.formats, visit.format || 'webpage']
    ];
    for (const [group, name] of groups) group[name] = (group[name] || 0) + engaged;
  }
  return result;
}

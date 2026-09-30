import { siteMatches } from './settings.js';

export const PURPOSES = ['learning', 'information', 'entertainment', 'other', 'unknown'];
export const TOPICS = ['education', 'gaming', 'news', 'technology', 'other', 'unknown'];

export function contentFormat(visit) {
  if (visit.videoFormat === 'Shorts') return 'shorts';
  if (visit.videoFormat === 'Video') return 'video';
  if (visit.searchQuery) return 'search';
  return 'webpage';
}

export function classifyVisit(visit, rules = []) {
  const format = contentFormat(visit);
  const rule = (Array.isArray(rules) ? rules : []).find(item => item?.site &&
    siteMatches(visit.site, item.site) &&
    PURPOSES.includes(item.purpose) && TOPICS.includes(item.topic));
  if (rule) return {
    format, purpose: rule.purpose, topic: rule.topic, labelSource: 'rule'
  };

  const text = `${visit.title || ''} ${visit.searchQuery || ''}`.toLowerCase();
  const learning = /\b(tutorial|lesson|lecture|course|study|homework|explained|how to|research)\b/.test(text);
  const gaming = /\b(gaming|gameplay|minecraft|fortnite|roblox|valorant|gamer)\b/.test(text);
  const news = /\b(news|headlines|current events)\b/.test(text);
  const technology = /\b(programming|coding|javascript|python|software|computer science)\b/.test(text);

  let topic = 'unknown';
  if (gaming) topic = 'gaming';
  else if (technology) topic = 'technology';
  else if (learning) topic = 'education';
  else if (news) topic = 'news';

  let purpose = 'unknown';
  if (learning) purpose = 'learning';
  else if (news) purpose = 'information';
  else if (gaming) purpose = 'entertainment';

  return { format, purpose, topic, labelSource: 'automatic' };
}

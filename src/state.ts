import { LS_KEY } from './constants';
import { normCode, uid } from './utils';
import { makeEntry } from './schedule/sections';
import type { ApiConfig, Course, Entry, Planner, TimeRange } from './types';

export function defaultPlanner(): Planner {
  return { mode: 'time', rank: 'even', items: [{ id: uid(), code: '', times: [], sections: [], all: false, enabled: true }] };
}
export function sanitizePlanner(raw: any): Planner {
  const p = raw || {};
  const wasOnly = p.mode === 'only';
  const items = (Array.isArray(p.items) ? p.items : []).map(it => ({
    id: uid(),
    code: normCode((it && it.code) || ''),
    all: wasOnly || !!(it && it.all),
    enabled: it && typeof it.enabled === 'boolean' ? it.enabled : true,
    times: ((it && it.times) || []).filter(t => t && t.day >= 1 && t.day <= 5 && isFinite(Number(t.time)))
      .map(t => ({ day: Number(t.day), time: Number(t.time), labels: t.labels || null })),
    sections: (Array.isArray(it && it.sections) ? it.sections : []).filter(s => typeof s === 'string' && s)
  }));
  if (!items.length) items.push({ id: uid(), code: '', times: [], sections: [], all: false, enabled: true });
  return {
    mode: (p.mode === 'course' || wasOnly) ? 'course' : 'time',
    rank: p.rank === 'distance' ? 'distance' : 'even',
    items: items
  };
}
export function sanitizeRanges(arr: any): TimeRange[] {
  return (Array.isArray(arr) ? arr : []).map(b => ({
    id: uid(),
    day: Number(b && b.day),
    start: Number(b && b.start),
    end: Number(b && b.end)
  })).filter(b => b.day >= 1 && b.day <= 5 && isFinite(b.start) && isFinite(b.end) && b.end > b.start);
}
export function loadPlannerState(): Planner {
  try{
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return sanitizePlanner(parsed.planner);
  }catch(e){
    return defaultPlanner();
  }
}
export const API_LS_KEY = 'hkust-course-planner-api-v1';
export function defaultApiCfg(): ApiConfig {
  return { url: 'https://getclasslist.moltocantabile.workers.dev/', cartUrl: 'https://addtocart.moltocantabile.workers.dev/', enrollUrl: 'https://enroll.moltocantabile.workers.dev/', token: '', studentId: '', termId: '2610' };
}
export function loadApiCfg(): ApiConfig {
  try{
    const parsed = JSON.parse(localStorage.getItem(API_LS_KEY) || localStorage.getItem('hkust-course-planner-proxy-v1') || '{}');
    const d = defaultApiCfg();
    return {
      url: typeof parsed.url === 'string' && parsed.url ? parsed.url : d.url,
      cartUrl: typeof parsed.cartUrl === 'string' && parsed.cartUrl ? parsed.cartUrl : d.cartUrl,
      enrollUrl: typeof parsed.enrollUrl === 'string' && parsed.enrollUrl ? parsed.enrollUrl : d.enrollUrl,
      token: typeof parsed.token === 'string' ? parsed.token : '',
      studentId: typeof parsed.studentId === 'string' ? parsed.studentId : '',
      termId: typeof parsed.termId === 'string' && parsed.termId ? parsed.termId : d.termId
    };
  }catch(e){
    return defaultApiCfg();
  }
}
export function saveApiCfg(cfg: ApiConfig): void {
  try{ localStorage.setItem(API_LS_KEY, JSON.stringify(cfg || {})); localStorage.removeItem('hkust-course-planner-proxy-v1'); }catch(e){ /* storage blocked */ }
}
export function apiDataTag(type: string, termId: string): string {
  return 'api · ' + type + ' ' + (String(termId || '').trim() || '?');
}
export function academicTermOptions(): { id: string; label: string }[] {
  const seasons = [['Fall', 10], ['Winter', 20], ['Spring', 30], ['Summer', 40]];
  const now = new Date().getFullYear();
  const out = [];
  for (let y = now - 4; y <= now + 2; y++){
    const yy = String(y).slice(-2);
    for (const [name, code] of seasons){
      out.push({ id: yy + code, label: y + '-' + String(y + 1).slice(-2) + ' ' + name });
    }
  }
  return out;
}
export function plannerForSave(planner: Planner){
  return {
    mode: planner.mode,
    rank: planner.rank,
    items: (planner.items || []).map(it => ({ code: it.code || '', times: it.times || [], sections: it.sections || [], all: !!it.all, enabled: it && typeof it.enabled === 'boolean' ? it.enabled : true }))
  };
}
export function hydrateSchedule(arr: any, courseList: Course[]): Entry[] {
  const ids = new Set();
  const byId = {};
  (courseList || []).forEach(c => c.sections.forEach(sec => { ids.add(sec.id); byId[sec.id] = { course: c, section: sec }; }));
  return (Array.isArray(arr) ? arr : []).filter(en => en && en.section && ids.has(en.section)).map(en => {
    const hit = byId[en.section];
    if (hit) return makeEntry(hit.course.code, hit.section);
    return { course: en.course, section: en.section, label: en.label || '', meetings: Array.isArray(en.meetings) ? en.meetings : [], component: en.component || '' };
  });
}

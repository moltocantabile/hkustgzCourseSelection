import { DAY_NAMES, MAX_SOLUTIONS, TRANSFER_GAP } from '../constants';
import { CODE_RE } from '../constants';
import { fmtDec, normCode } from '../utils';
import { courseBundles, parallelClassCount } from './sections';
import { findConflicts, meetingInRanges } from './conflict';
import type { Course, Entry, Meeting } from '../types';

export interface TimetableScore {
  entries: Entry[];
  full?: Entry[];
  even: { hours: number[]; variance: number; std: number };
  dist: { pairs: number; same: number; far: number; unknown: number; farPairs: string[] };
}

/* ================= auto scheduler (backtracking + pruning) ================= */
export function meetingCoversTime(m: Meeting, day: number, time: number): boolean {
  return m.day === day && m.start <= time && time <= m.end;
}
export function bundleCoversTimes(bundle: Entry[], times: { day: number; time: number }[]): boolean {
  if (!times || !times.length) return true;
  const meetings = [];
  for (const e of bundle) for (const mt of (e.meetings || [])) meetings.push(mt);
  return times.some(t => meetings.some(m => meetingCoversTime(m, t.day, t.time)));
}
export function normalizeSchedRequests(input: any){
  if (Array.isArray(input)){
    const out = [], seen = {};
    for (const r of input){
      const code = normCode(r && (r.code || r));
      if (!code || seen[code]) continue;
      seen[code] = true;
      const times = [];
      for (const t of ((r && r.times) || [])){
        const day = Number(t.day), time = Number(t.time);
        if (day >= 1 && day <= 5 && isFinite(time)) times.push({ day: day, time: time });
      }
      const sections = ((r && r.sections) || []).filter(s => s && typeof s === 'string');
      out.push({ code: code, times: times, sections: sections });
    }
    return out;
  }
  const codes = [], seen = {};
  const m = String(input || '').matchAll(CODE_RE);
  for (const hit of m){
    const c = normCode(hit[0]);
    if (c && !seen[c]){ seen[c] = true; codes.push({ code: c, times: [], sections: [] }); }
  }
  return codes;
}
export function buildingOf(room: string): string {
  const s = String(room || '').trim();
  if (!s || /^no room required$/i.test(s) || /^tba$/i.test(s) || /online/i.test(s)) return '';
  let m = s.match(/,\s*([EWSN]\d)\b/i);
  if (m) return m[1].toUpperCase();
  m = s.match(/\(([EWSN]\d)\s*[-–]/i);
  if (m) return m[1].toUpperCase();
  m = s.match(/\b([EWSN]\d)\b/i);
  if (m) return m[1].toUpperCase();
  m = s.match(/lecture hall\s*([A-Z])/i);
  if (m) return 'LH-' + m[1].toUpperCase();
  return s;
}
export function parseISODate(s: string): Date | null {
  const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}
export function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7));
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
export function mergeDayIntervals(list: { start: number; end: number }[]){
  const arr = list.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const it of arr){
    const last = out[out.length - 1];
    if (last && it.start < last.end + 1e-9){
      if (it.end > last.end) last.end = it.end;
    } else {
      out.push(Object.assign({}, it));
    }
  }
  return out;
}
export function meetingInWeek(m: { day: number; startDate?: string; endDate?: string }, weekMonday: Date): boolean {
  if (!m.startDate || !m.endDate) return true;
  const s = parseISODate(m.startDate), e = parseISODate(m.endDate);
  if (!s || !e) return true;
  const occ = new Date(weekMonday);
  occ.setUTCDate(occ.getUTCDate() + (m.day - 1));
  return occ >= s && occ <= e;
}
export function scoreTimetable(entries: Entry[]): TimetableScore {
  const byDay: Record<number, any[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  let minD = null, maxD = null;
  for (const en of (entries || [])){
    for (const mt of (en.meetings || [])){
      if (mt.day < 1 || mt.day > 5) continue;
      byDay[mt.day].push({ day: mt.day, start: mt.start, end: mt.end, building: buildingOf(mt.room), course: en.course, label: en.label, startDate: mt.startDate, endDate: mt.endDate });
      if (mt.startDate){
        const d = parseISODate(mt.startDate);
        if (d && (!minD || d < minD)) minD = d;
      }
      if (mt.endDate){
        const d = parseISODate(mt.endDate);
        if (d && (!maxD || d > maxD)) maxD = d;
      }
    }
  }
  const hours = [0, 0, 0, 0, 0];
  if (minD && maxD){
    for (let wk = mondayOf(minD); wk <= maxD; wk.setUTCDate(wk.getUTCDate() + 7)){
      for (const day of [1, 2, 3, 4, 5]){
        const h = mergeDayIntervals(byDay[day].filter(m => meetingInWeek(m, wk)))
          .reduce((s, it) => s + Math.max(0, it.end - it.start), 0);
        if (h > hours[day - 1]) hours[day - 1] = h;
      }
    }
  } else {
    for (const day of [1, 2, 3, 4, 5]){
      hours[day - 1] = mergeDayIntervals(byDay[day])
        .reduce((s, it) => s + Math.max(0, it.end - it.start), 0);
    }
  }
  for (const day of [1, 2, 3, 4, 5]) byDay[day] = mergeDayIntervals(byDay[day]);
  const mean = hours.reduce((a, b) => a + b, 0) / 5;
  const variance = hours.reduce((s, h) => s + (h - mean) * (h - mean), 0) / 5;
  let pairs = 0, same = 0, far = 0, unknown = 0;
  const farPairs = [];
  for (const day of [1, 2, 3, 4, 5]){
    const arr = byDay[day].slice().sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 0; i < arr.length; i++){
      for (let j = i + 1; j < arr.length; j++){
        const a = arr[i], b = arr[j];
        const gap = b.start - a.end;
        if (gap < -1e-9) continue;
        if (gap > TRANSFER_GAP + 1e-9) break;
        pairs++;
        if (!a.building || !b.building){ unknown++; continue; }
        if (a.building === b.building) same++;
        else {
          far++;
          farPairs.push(a.course + ' ' + a.label + ' → ' + b.course + ' ' + b.label);
        }
      }
    }
  }
  return {
    entries: entries,
    even: { hours: hours, variance: variance, std: Math.sqrt(variance) },
    dist: { pairs: pairs, same: same, far: far, unknown: unknown, farPairs: farPairs }
  };
}
export function sortScored(list: any[], rankBy: string){
  list.sort((a, b) => {
    if (rankBy === 'distance'){
      if (a.dist.far !== b.dist.far) return a.dist.far - b.dist.far;
      if (a.even.variance !== b.even.variance) return a.even.variance - b.even.variance;
    } else {
      if (a.even.variance !== b.even.variance) return a.even.variance - b.even.variance;
      if (a.dist.far !== b.dist.far) return a.dist.far - b.dist.far;
    }
    if (a.dist.same !== b.dist.same) return b.dist.same - a.dist.same;
    return a.even.std - b.even.std;
  });
  return list;
}
export function cloneEntry(e: Entry): Entry {
  return { course: e.course, section: e.section, label: e.label, meetings: (e.meetings || []).map(m => Object.assign({}, m)), component: e.component };
}

export function generateSchedules(input: any, coursesById: Record<string, Course>, opts: any){
  opts = opts || {};
  const collectLimit = Math.max(1, opts.collectLimit || MAX_SOLUTIONS);
  const showLimit = Math.max(1, opts.showLimit || MAX_SOLUTIONS);
  const rankBy = opts.rankBy === 'distance' ? 'distance' : 'even';
  const locked = (opts.locked || []).map(cloneEntry);
  const requests = normalizeSchedRequests(input);
  const reqCodes = {};
  requests.forEach(r => { if (r.code) reqCodes[r.code] = true; });
  const lockedForConflict = locked.filter(e => !(e.course && reqCodes[e.course]));
  const warnings = [];
  const pool = [];
  let kept = 0;
  for (const req of requests){
    const code = req.code;
    const onTimetable = locked.some(e => e.course === code);
    if (onTimetable){
      kept++;
      warnings.push(code + ': already on the timetable — regenerating will replace its current sections');
    }
    const c = coursesById[code];
    if (!c){ warnings.push(code + ': not offered this term (no class sections)'); continue; }
    let bundles = courseBundles(c);
    const before = bundles.length;
    if (!before){
      warnings.push(code + ': no valid section combination (Lecture/Tutorial pairing has no conflict-free option)');
      continue;
    }
    if (req.times && req.times.length){
      bundles = bundles.filter(b => bundleCoversTimes(b, req.times));
      const label = req.times.map(t => DAY_NAMES[t.day] + ' ' + fmtDec(t.time)).join(' + ');
      if (!bundles.length){
        warnings.push(code + ': no section covers ' + label + ' (' + before + ' bundle(s) before time filter)');
        continue;
      }
      warnings.push(code + ': time filter ' + label + ' → ' + bundles.length + '/' + before + ' section bundle(s)');
    }
    if (req.sections && req.sections.length){
      const want = req.sections.slice();
      const beforeS = bundles.length;
      bundles = bundles.filter(b => want.every(id => b.some(en => en.section === id)));
      if (!bundles.length){
        warnings.push(code + ': no section bundle contains ' + want.join(', ') + ' (' + beforeS + ' bundle(s) before section filter)');
        continue;
      }
      if (bundles.length !== beforeS){
        warnings.push(code + ': section filter ' + want.join(', ') + ' → ' + bundles.length + '/' + beforeS + ' section bundle(s)');
      }
    }
    if (opts.blocked && opts.blocked.length){
      const beforeB = bundles.length;
      bundles = bundles.filter(bundle => !bundle.some(entry => (entry.meetings || []).some(m => meetingInRanges(m, opts.blocked))));
      if (bundles.length !== beforeB){
        warnings.push(code + ': blocked periods exclude ' + (beforeB - bundles.length) + '/' + beforeB + ' section bundle(s)');
        if (!bundles.length) continue;
      }
    }
    bundles = bundles.filter(bundle => !bundle.some(entry => findConflicts(entry.meetings, lockedForConflict).length));
    if (!bundles.length){
      warnings.push(code + ': every section bundle conflicts with the current timetable');
      continue;
    }
    const nPar = parallelClassCount(c);
    if (nPar > 1) warnings.push(code + ': ' + bundles.length + ' feasible section bundle(s)');
    pool.push({ code: code, name: c.name, bundles: bundles });
  }
  if (!pool.length) return { solutions: [], warnings: warnings, truncated: false, rankBy: rankBy, kept: kept };
  pool.sort((a, b) => a.bundles.length - b.bundles.length);
  const solutions = [];
  const chosen = lockedForConflict.slice();
  const baseLen = lockedForConflict.length;
  let nodes = 0;
  const MAX_NODES = 400000;
  let truncated = false;
  function bt(i){
    nodes++;
    if (nodes > MAX_NODES){ truncated = true; return; }
    if (i === pool.length){
      solutions.push({ added: chosen.slice(baseLen).map(cloneEntry), full: chosen.map(cloneEntry) });
      return;
    }
    for (const bundle of pool[i].bundles){
      let ok = true;
      for (const entry of bundle){
        if (findConflicts(entry.meetings, chosen).length){ ok = false; break; }
      }
      if (!ok) continue;
      const n = bundle.length;
      for (const entry of bundle) chosen.push(entry);
      bt(i + 1);
      chosen.length -= n;
      if (solutions.length >= collectLimit || truncated) return;
    }
  }
  bt(0);
  const scored = sortScored(solutions.map(s => {
    const sc = scoreTimetable(s.full);
    sc.entries = s.added;
    sc.full = s.full;
    return sc;
  }), rankBy);
  return { solutions: scored.slice(0, showLimit), warnings: warnings, truncated: truncated, rankBy: rankBy, found: solutions.length, kept: kept };
}

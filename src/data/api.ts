// Cloudflare Workers API access: course-data query and "add to system cart".
// URL / TOKEN / TERM are configured in the UI and stored by src/state.ts.
import type { ApiConfig, Course, Entry, Section } from '../types';

export async function fetchApiPayload(cfg: ApiConfig, type: string){
  const base = String(cfg.url || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('API URL is empty');
  const qs = new URLSearchParams();
  qs.set('TYPE', type);
  if (String(cfg.termId || '').trim()) qs.set('TERM_ID', String(cfg.termId).trim());
  if (String(cfg.token || '').trim()) qs.set('TOKEN', String(cfg.token).trim());
  const res = await fetch(base + '/?' + qs.toString(), { cache: 'no-store' });
  let body = null;
  try{ body = await res.json(); }catch(ex){ throw new Error('API returned non-JSON (HTTP ' + res.status + ')'); }
  if (!res.ok || (body && typeof body === 'object' && body.error)){
    throw new Error((body && body.error) ? String(body.error) : 'HTTP ' + res.status);
  }
  const payload = Array.isArray(body) ? body
    : (body && Array.isArray(body.data) ? body.data
    : (body && Array.isArray(body.records) ? body.records : null));
  if (!payload) throw new Error('API response has no data array');
  return payload;
}

export async function addToSystemCart(cfg: ApiConfig, schedule: Entry[], coursesById: Record<string, Course>){
  const token = String(cfg.token || '').trim();
  if (!token) throw new Error('missing-token');
  if (!schedule || !schedule.length) throw new Error('empty-schedule');
  const base = String(cfg.cartUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('empty-cart-url');
  const idsByType = { sisn: [], klms: [] };
  const seen = {};
  for (const en of schedule){
    if (seen[en.section]) continue;
    seen[en.section] = true;
    const c = en.course && coursesById && coursesById[en.course];
    const type = (c && c.cartSystem) ? c.cartSystem : ((c && c.klms) ? 'klms' : 'sisn');
    idsByType[type].push(en.section);
  }
  let added = 0, failed = [];
  const errors = [];
  // SISN and KLMS are independent systems: one failing (network / auth / upstream)
  // must not prevent the other request from being sent. Failures are collected
  // per system and reported alongside the combined result.
  for (const type of ['sisn', 'klms']){
    const ids = idsByType[type];
    if (!ids.length) continue;
    try{
      const r = await postToCart(base, token, type, ids);
      added += r.added;
      failed = failed.concat(r.failedIds);
    }catch(ex){
      errors.push(type.toUpperCase() + ': ' + (ex && ex.message ? ex.message : String(ex)));
    }
  }
  return { added: added, failed: failed, errors: errors };
}

async function postToCart(base: string, token: string, type: string, ids: string[]){
  const qs = new URLSearchParams();
  qs.set('TOKEN', token);
  qs.set('TYPE', type);
  const res = await fetch(base + '/?' + qs.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classIds: ids })
  });
  let body = null;
  try{ body = await res.json(); }catch(ex){ throw new Error('cart API returned non-JSON (HTTP ' + res.status + ')'); }
  if (!res.ok || (body && body.error)){
    throw new Error((body && body.error) ? String(body.error) : 'HTTP ' + res.status);
  }
  if (body && body._decryptError) throw new Error('cart response decryption failed: ' + body._decryptError);
  if (body && body.code !== undefined && body.code !== null && String(body.code) !== '0'){
    throw new Error((body && body.message) ? String(body.message) : 'upstream error ' + body.code);
  }
  const data = body && typeof body.data === 'object' ? body.data : null;
  const failedIds = (data && Array.isArray(data.failedIds)) ? data.failedIds.map(String) : [];
  const successCount = (data && isFinite(Number(data.successCount))) ? Number(data.successCount) : null;
  const added = successCount != null ? Math.max(0, successCount) : Math.max(0, ids.length - failedIds.length);
  return { added: added, failedIds: failedIds };
}

// Enroll every timetable section via the enroll worker. The upstream API only
// accepts a single class per request, so sections are submitted in parallel
// and each failure is collected without blocking the remaining requests.
export async function enrollSections(cfg: ApiConfig, schedule: Entry[], coursesById: Record<string, Course>){
  const token = String(cfg.token || '').trim();
  if (!token) throw new Error('missing-token');
  if (!schedule || !schedule.length) throw new Error('empty-schedule');
  const base = String(cfg.enrollUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('empty-enroll-url');
  const seen = {};
  const tasks = [];
  for (const en of schedule){
    if (seen[en.section]) continue;
    seen[en.section] = true;
    const c = en.course && coursesById && coursesById[en.course];
    const sec = c && c.sections.find(s => s.id === en.section);
    if (!c || !sec) continue;
    const type = (c.cartSystem) ? c.cartSystem : ((c.klms) ? 'klms' : 'sisn');
    tasks.push({ classId: en.section, type: type, sec: sec });
  }
  const results = await Promise.all(tasks.map(t => enrollOne(base, token, t.type, t.sec)
    .then(() => null)
    .catch(ex => ({ classId: t.classId, error: ex && ex.message ? ex.message : String(ex) }))));
  const failed = results.filter(r => r != null);
  return { added: tasks.length - failed.length, failed: failed };
}

async function enrollOne(base: string, token: string, type: string, sec: Section){
  const payload = {
    classId: sec.id,
    crseWid: String(sec.crseWid || '').trim() || undefined,
    termId: String(sec.termId || '').trim() || undefined,
    crseComponentId: String(sec.crseComponentId || '').trim() || undefined,
    acadCareer: String(sec.acadCareer || '').trim() || undefined,
    enrollType: 'NORMAL'
  };
  // Send every field the section carries; optional fields are left out only
  // when the data does not provide them. Do not drop requests just because a
  // field marked required is absent.
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  const qs = new URLSearchParams();
  qs.set('TOKEN', token);
  qs.set('TYPE', type);
  const res = await fetch(base + '/?' + qs.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let body = null;
  try{ body = await res.json(); }catch(ex){ throw new Error('enroll API returned non-JSON (HTTP ' + res.status + ')'); }
  if (!res.ok || (body && body.error)){
    throw new Error((body && body.error) ? String(body.error) : 'HTTP ' + res.status);
  }
  if (body && body._decryptError) throw new Error('enroll response decryption failed: ' + body._decryptError);
  if (body && body.code !== undefined && body.code !== null && String(body.code) !== '0'){
    throw new Error((body && body.message) ? String(body.message) : 'upstream error ' + body.code);
  }
  const data = body && typeof body.data === 'object' ? body.data : null;
  if (data && Array.isArray(data.failedIds) && data.failedIds.length){
    throw new Error('upstream failed: ' + data.failedIds.map(String).join(', '));
  }
}

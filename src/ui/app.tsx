import { LS_KEY, DAY_NAMES } from '../constants';
import { buildCatalog } from '../data/catalog';
import { addToSystemCart, fetchApiPayload } from '../data/api';
import { mergeCourses, normalizeCourses, normalizeKlmsCourses } from '../data/normalizer';
import { findConflicts, meetingInRanges } from '../schedule/conflict';
import { courseDragTargets, pickTarget, pointerOverCalendar } from '../schedule/drag';
import { companionSections, makeEntry, upsertSectionChoice } from '../schedule/sections';
import { apiDataTag, hydrateSchedule, loadApiCfg, loadPlannerState, plannerForSave, sanitizePlanner, sanitizeRanges, saveApiCfg } from '../state';
import { fmtDec, normCode, uid } from '../utils';
import { ApiModal } from './api-modal';
import { CartFab, Toasts } from './cart';
import { DepsTab } from './deps-tab';
import { LoadScreen, ManualLoad } from './load';
import { SchedulerTab } from './scheduler-tab';
import { applyFilters, CourseCard, CourseDetail, EMPTY_FILTERS, FilterBar, filtersActive, searchCourses } from './search';
import { Timetable } from './timetable';

export function App(){
  const [status, setStatus] = React.useState('loading');
  const [courses, setCourses] = React.useState([]);
  const [catalogMap, setCatalogMap] = React.useState({});
  const [query, setQuery] = React.useState('');
  const [filters, setFilters] = React.useState(EMPTY_FILTERS);
  const [selected, setSelected] = React.useState(null);
  const [schedule, setSchedule] = React.useState([]);
  const [tab, setTab] = React.useState('sched');
  const [deps, setDeps] = React.useState({ key: 0, code: '' });
  const [drag, setDrag] = React.useState(null);
  const [hover, setHover] = React.useState(null);
  const [toasts, setToasts] = React.useState([]);
  const [schedFocusTick, setSchedFocusTick] = React.useState(0);
  const [leftOpen, setLeftOpen] = React.useState(true);
  const [rightOpen, setRightOpen] = React.useState(true);
  const [dataLabels, setDataLabels] = React.useState({ courses: 'courses.json', catalog: 'data.json', klms: 'courses_klms.json' });
  const [planner, setPlanner] = React.useState(() => loadPlannerState());
  const [crossDrag, setCrossDrag] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const [cartOpen, setCartOpen] = React.useState(false);
  const [apiCfg, setApiCfg] = React.useState(loadApiCfg);
  const [apiOpen, setApiOpen] = React.useState(false);
  const [apiBusy, setApiBusy] = React.useState(null);
  const [cartBusy, setCartBusy] = React.useState(false);
  const [blockedPeriods, setBlockedPeriods] = React.useState([]);
  const [containsSlots, setContainsSlots] = React.useState([]);
  const gridRef = React.useRef(null);
  const loadedRef = React.useRef(false);
  const rawCoursesRef = React.useRef(null);
  const rawCatalogRef = React.useRef(null);
  const rawKlmsRef = React.useRef([]);

  const coursesById = React.useMemo(() => { const m = {}; courses.forEach(c => m[c.code] = c); return m; }, [courses]);
  const names = React.useMemo(() => {
    const m = {};
    courses.forEach(c => m[c.code] = c.name);
    Object.keys(catalogMap).forEach(k => { if (!m[k]) m[k] = catalogMap[k].crseTitle || ''; });
    return m;
  }, [courses, catalogMap]);
  const selectedCourse = selected && coursesById[selected] ? coursesById[selected] : null;
  const scheduledIds = React.useMemo(() => new Set(schedule.map(en => en.section)), [schedule]);
  const conflictSections = React.useMemo(() => {
    const s = new Set();
    schedule.forEach((en, i) => { if (findConflicts(en.meetings, schedule.filter((e, j) => j !== i)).length) s.add(en.section); });
    return s;
  }, [schedule]);

  function toast(msg){
    const id = uid();
    setToasts(t => t.concat([{ id: id, msg: msg }]));
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
  }
  function applyLoadedData(rawCourses, rawCatalog, labels, rawKlms?){
    const cm = buildCatalog(rawCatalog || []);
    const klmsRaw = rawKlms !== undefined ? (rawKlms || []) : (rawKlmsRef.current || []);
    const cs = mergeCourses(normalizeCourses(Array.isArray(rawCourses) ? rawCourses : [], cm), normalizeKlmsCourses(klmsRaw, cm));
    if (!cs.length && !Object.keys(cm).length) throw new Error('no courses could be parsed');
    rawCoursesRef.current = rawCourses;
    rawCatalogRef.current = rawCatalog;
    rawKlmsRef.current = klmsRaw;
    setCatalogMap(cm);
    setCourses(cs);
    setDataLabels(Object.assign({ courses: 'courses.json', catalog: 'data.json', klms: 'courses_klms.json' }, labels || {}));
    setSelected(null);
    const ids = {};
    cs.forEach(c => c.sections.forEach(s => { ids[s.id] = true; }));
    setSchedule(prev => prev.filter(en => ids[en.section]));
  }
  function readJsonFile(file){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => { try { resolve(JSON.parse(r.result as string)); } catch (ex){ reject(ex); } };
      r.onerror = () => reject(new Error('read failed'));
      r.readAsText(file);
    });
  }
  async function onPickCustom(kind, e){
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try{
      const data = await readJsonFile(f);
      if (kind === 'courses'){
        if (!Array.isArray(data)) throw new Error('courses file must be a JSON array');
        applyLoadedData(data, rawCatalogRef.current, { courses: f.name, catalog: dataLabels.catalog });
        toast('Loaded course data · ' + f.name);
      } else if (kind === 'klms'){
        if (!Array.isArray(data)) throw new Error('KLMS file must be a JSON array');
        applyLoadedData(rawCoursesRef.current, rawCatalogRef.current, { courses: dataLabels.courses, catalog: dataLabels.catalog, klms: f.name }, data);
        toast('Loaded KLMS courses · ' + f.name);
      } else {
        applyLoadedData(rawCoursesRef.current, data, { courses: dataLabels.courses, catalog: f.name });
        toast('Loaded catalog · ' + f.name);
      }
    }catch(ex){
      toast('Could not load ' + (f && f.name ? f.name : 'file') + ': ' + ex.message);
    }
  }

  async function onApiLoad(type){
    try{
      setApiBusy(type);
      const payload = await fetchApiPayload(apiCfg, type);
      const tag = apiDataTag(type, apiCfg.termId);
      if (type === 'data'){
        applyLoadedData(rawCoursesRef.current, payload, { courses: dataLabels.courses, catalog: tag });
        toast('Loaded catalog from API · ' + payload.length + ' record(s)');
      } else if (type === 'klms'){
        applyLoadedData(rawCoursesRef.current, rawCatalogRef.current, { courses: dataLabels.courses, catalog: dataLabels.catalog, klms: tag }, payload);
        toast('Loaded KLMS courses from API · ' + payload.length + ' course(s)');
      } else {
        applyLoadedData(payload, rawCatalogRef.current, { courses: tag, catalog: dataLabels.catalog });
        toast('Loaded courses from API · ' + payload.length + ' course(s)');
      }
      saveApiCfg(apiCfg);
    }catch(ex){
      toast('API load failed: ' + ex.message);
    }finally{
      setApiBusy(null);
    }
  }

  async function onAddToSystemCart(){
    const token = String(apiCfg.token || '').trim();
    if (!token){
      toast('Set your API TOKEN first (API button)');
      setApiOpen(true);
      return;
    }
    if (!schedule.length){
      toast('Timetable is empty — nothing to add');
      return;
    }
    const base = String(apiCfg.cartUrl || '').trim().replace(/\/+$/, '');
    if (!base){
      toast('Cart API URL is empty — set it in the API settings');
      setApiOpen(true);
      return;
    }
    setCartBusy(true);
    try{
      const r = await addToSystemCart(apiCfg, schedule, coursesById);
      let msg = 'Added ' + r.added + ' section(s) to the system cart';
      if (r.failed.length) msg += ' · failed: ' + r.failed.join(', ');
      if (r.errors.length) msg += ' · errors: ' + r.errors.join('; ');
      toast(msg);
    }catch(ex){
      toast('Add to cart failed: ' + ex.message);
    }finally{
      setCartBusy(false);
    }
  }

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const hasToken = !!(apiCfg.token && String(apiCfg.token).trim());
      if (hasToken){
        try{
          const [dt, cr, kl] = await Promise.all([
            fetchApiPayload(apiCfg, 'data'),
            fetchApiPayload(apiCfg, 'sisn'),
            fetchApiPayload(apiCfg, 'klms')
          ]);
          if (!alive) return;
          const cm = buildCatalog(dt);
          const klms = Array.isArray(kl) ? kl : [];
          const cs = mergeCourses(normalizeCourses(Array.isArray(cr) ? cr : [], cm), normalizeKlmsCourses(klms, cm));
          if (!cs.length) throw new Error('no courses parsed from API');
          rawCoursesRef.current = cr;
          rawCatalogRef.current = dt;
          rawKlmsRef.current = klms;
          setCatalogMap(cm);
          setCourses(cs);
          setDataLabels({ courses: apiDataTag('sisn', apiCfg.termId), catalog: apiDataTag('data', apiCfg.termId), klms: apiDataTag('klms', apiCfg.termId) });
          setStatus('ready');
          toast('Loaded courses from API · ' + cs.length + ' course(s)');
          return;
        }catch(err){
          if (!alive) return;
          toast('API load failed (' + err.message + ') — trying local files');
        }
      }
      if (window.location.protocol === 'file:'){ if (alive) setStatus('manual'); return; }
      try{
        const [cr, dt, kl] = await Promise.all([
          fetch('courses.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
          fetch('data.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
          fetch('courses_klms.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => [])
        ]);
        if (!alive) return;
        const cm = buildCatalog(dt);
        const klms = Array.isArray(kl) ? kl : [];
        const cs = mergeCourses(normalizeCourses(cr, cm), normalizeKlmsCourses(klms, cm));
        if (!cs.length) throw new Error('no courses parsed');
        rawCoursesRef.current = cr;
        rawCatalogRef.current = dt;
        rawKlmsRef.current = klms;
        setCatalogMap(cm);
        setCourses(cs);
        setDataLabels({ courses: 'courses.json', catalog: 'data.json', klms: 'courses_klms.json' });
        setStatus('ready');
      }catch(err){
        if (alive) setStatus('manual');
      }
    })();
    return () => { alive = false; };
  }, []);

  function currentSnapshot(){
    return {
      schedule: schedule.map(en => ({ course: en.course, section: en.section, label: en.label })),
      planner: plannerForSave(planner),
      crossDrag: !!crossDrag,
      blocked: blockedPeriods.map(b => ({ day: b.day, start: b.start, end: b.end })),
      contains: containsSlots.map(c => ({ day: c.day, start: c.start, end: c.end })),
      savedAt: new Date().toISOString()
    };
  }
  function writeLocal(extra?){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(currentSnapshot(), extra || {}))); }catch(e){ /* storage full/blocked */ }
  }
  function saveLocal(){
    writeLocal();
    toast('Saved locally in this browser');
  }
  function exportSave(){
    const blob = new Blob([JSON.stringify(currentSnapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hkust-planner-save.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Exported planner save file');
  }
  function applySnapshot(parsed, label){
    if (!parsed || typeof parsed !== 'object') throw new Error('not a planner save');
    const nextPlanner = parsed.planner ? sanitizePlanner(parsed.planner) : planner;
    const nextSchedule = Array.isArray(parsed.schedule) ? hydrateSchedule(parsed.schedule, courses) : schedule;
    if (parsed.planner) setPlanner(nextPlanner);
    if (Array.isArray(parsed.schedule)) setSchedule(nextSchedule);
    if (typeof parsed.crossDrag === 'boolean') setCrossDrag(parsed.crossDrag);
    if (Array.isArray(parsed.blocked)) setBlockedPeriods(sanitizeRanges(parsed.blocked));
    if (Array.isArray(parsed.contains)) setContainsSlots(sanitizeRanges(parsed.contains));
    try{
      localStorage.setItem(LS_KEY, JSON.stringify({
        schedule: nextSchedule.map(en => ({ course: en.course, section: en.section, label: en.label })),
        planner: plannerForSave(nextPlanner),
        blocked: sanitizeRanges(parsed.blocked).map(b => ({ day: b.day, start: b.start, end: b.end })),
        contains: sanitizeRanges(parsed.contains).map(c => ({ day: c.day, start: c.start, end: c.end })),
        savedAt: new Date().toISOString()
      }));
    }catch(e){ /* storage full/blocked */ }
    toast('Loaded ' + (label || 'saved plan'));
  }
  async function onPickSave(e){
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try{
      const data = await readJsonFile(f);
      applySnapshot(data, f.name);
    }catch(ex){
      toast('Could not import save: ' + ex.message);
    }
  }

  React.useEffect(() => {
    if (status !== 'ready' || loadedRef.current) return;
    loadedRef.current = true;
    try{
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.planner) setPlanner(sanitizePlanner(parsed.planner));
      if (typeof parsed.crossDrag === 'boolean') setCrossDrag(parsed.crossDrag);
      if (Array.isArray(parsed.blocked)) setBlockedPeriods(sanitizeRanges(parsed.blocked));
      if (Array.isArray(parsed.contains)) setContainsSlots(sanitizeRanges(parsed.contains));
      setSchedule(hydrateSchedule(parsed.schedule, courses));
    }catch(e){ /* ignore corrupt saves */ }
    setHydrated(true);
  }, [status, courses]);

  React.useEffect(() => {
    if (status !== 'ready' || !hydrated) return;
    writeLocal();
  }, [schedule, planner, blockedPeriods, containsSlots, status, hydrated]);

  React.useEffect(() => {
    const clear = () => { setDrag(null); setHover(null); };
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  function addSection(course, section){
    const extras = companionSections(course, section).map(x => x.label);
    setSchedule(prev => upsertSectionChoice(prev, course, section));
    toast('Added ' + course.code + ' ' + section.label + (extras.length ? ' + ' + extras.join(', ') : ''));
  }
  function removeSection(sectionId){
    setSchedule(prev => {
      const hit = prev.find(en => en.section === sectionId);
      if (!hit) return prev;
      const course = coursesById[hit.course];
      const section = course && course.sections.find(sec => sec.id === sectionId);
      const bundle = section ? [section].concat(companionSections(course, section)) : [];
      const ids = {};
      ids[sectionId] = true;
      bundle.forEach(sec => { if (sec && sec.id) ids[sec.id] = true; });
      return prev.filter(en => !ids[en.section]);
    });
  }
  function addBlockedRanges(ranges){
    const clean = (ranges || []).map(r => ({ id: uid(), day: Number(r.day), start: Number(r.start), end: Number(r.end) }))
      .filter(r => r.day >= 1 && r.day <= 5 && isFinite(r.start) && isFinite(r.end) && r.end > r.start);
    if (!clean.length) return;
    setBlockedPeriods(prev => prev.concat(clean));
    toast('Blocked ' + clean.map(r => DAY_NAMES[r.day] + ' ' + fmtDec(r.start) + '–' + fmtDec(r.end)).join(', '));
  }
  function removeBlocked(id){
    setBlockedPeriods(prev => prev.filter(b => b.id !== id));
  }
  function setContainsRanges(ranges){
    const clean = (ranges || []).map(r => ({ id: uid(), day: Number(r.day), start: Number(r.start), end: Number(r.end) }))
      .filter(r => r.day >= 1 && r.day <= 5 && isFinite(r.start) && isFinite(r.end) && r.end > r.start);
    setContainsSlots(clean);
    if (clean.length) toast('Plan filter: only plans with classes ' + clean.map(r => DAY_NAMES[r.day] + ' ' + fmtDec(r.start) + '–' + fmtDec(r.end)).join(', '));
  }
  function removeContains(id){
    setContainsSlots(prev => prev.filter(c => c.id !== id));
  }
  function switchSection(courseCode, section){
    const course = coursesById[courseCode];
    if (!course) return;
    const extras = companionSections(course, section).map(x => x.label);
    setSchedule(prev => upsertSectionChoice(prev, course, section));
    toast('Switched ' + courseCode + ' to ' + section.label + (extras.length ? ' + ' + extras.join(', ') : ''));
  }
  function beginCrossDrag(e, course, origin){
    e.dataTransfer.setData('text/plain', course.code);
    e.dataTransfer.effectAllowed = 'copy';
    const targets = courseDragTargets(course, schedule);
    const originLabel = origin && origin.label ? origin.label : course.code;
    setDrag({ mode: 'cross', course: course.code, section: origin && origin.id, label: originLabel, targets: targets, raw: origin || null });
    setHover({ meetings: [], conflicts: [], active: null });
  }
  function startPoolDrag(e, course, section){
    if (crossDrag){
      beginCrossDrag(e, course, section);
      return;
    }
    e.dataTransfer.setData('text/plain', section.id);
    e.dataTransfer.effectAllowed = 'copy';
    const extras = companionSections(course, section);
    const meetings = section.meetings.concat(...extras.map(x => x.meetings));
    const label = [section.label].concat(extras.map(x => x.label)).join('+');
    setDrag({ mode: 'section', course: course.code, section: section.id, label: label, meetings: meetings, raw: section });
    setHover(null);
  }
  function startCourseDrag(e, course){
    if (!crossDrag) return;
    const first = (course.sections || []).find(sec => sec.meetings && sec.meetings.length);
    beginCrossDrag(e, course, first || null);
  }
  function startBlockDrag(e, en){
    if (!crossDrag) return;
    const course = coursesById[en.course];
    if (!course) return;
    const section = course.sections.find(sec => sec.id === en.section) || { id: en.section, label: en.label, meetings: en.meetings };
    beginCrossDrag(e, course, section);
  }
  function handleDragOver(e){
    if (!drag) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const el = gridRef.current;
    if (!el || !pointerOverCalendar(e, el)){
      setHover(null);
      return;
    }
    if (drag.mode === 'cross'){
      const active = pickTarget(drag.targets, e, el);
      const conflicts = active ? active.conflicts.slice() : [];
      if (active && (active.meetings || []).some(m => meetingInRanges(m, blockedPeriods))) conflicts.push({ type: 'blocked' });
      setHover({ meetings: active ? active.meetings : [], conflicts: conflicts, active: active });
      return;
    }
    const others = schedule.filter(en => en.course !== drag.course || (drag.raw && en.component !== drag.raw.component));
    const conflicts = findConflicts(drag.meetings, others);
    if (schedule.some(en => en.section === drag.section)) conflicts.push({ type: 'duplicate' });
    if ((drag.meetings || []).some(m => meetingInRanges(m, blockedPeriods))) conflicts.push({ type: 'blocked' });
    setHover({ meetings: drag.meetings, conflicts: conflicts });
  }
  function handleDragLeave(e){
    const to = e.relatedTarget;
    if (!to || (gridRef.current && !gridRef.current.contains(to))) setHover(null);
  }
  function handleDrop(e){
    e.preventDefault();
    if (!drag || !hover) { setDrag(null); setHover(null); return; }
    const course = coursesById[drag.course];
    if (drag.mode === 'cross'){
      if (course && hover.active && hover.active.bundle){
        setSchedule(prev => {
          let next = prev.filter(en => en.course !== course.code);
          hover.active.bundle.forEach(entry => {
            const sec = course.sections.find(sec => sec.id === entry.section);
            if (sec && sec.meetings && sec.meetings.length) next.push(makeEntry(course.code, sec));
          });
          return next;
        });
        toast((schedule.some(en => en.course === course.code) ? 'Moved ' : 'Added ') + course.code + ' ' + hover.active.label);
      }
      setDrag(null);
      setHover(null);
      return;
    }
    if (course && drag.raw){
      setSchedule(prev => upsertSectionChoice(prev, course, drag.raw));
      toast('Added ' + drag.course + ' ' + drag.label);
    }
    setDrag(null);
    setHover(null);
  }
  function applySolution(sol, requestCodes){
    const raw = Array.isArray(sol && sol.entries) ? sol.entries : (Array.isArray(sol) ? sol : []);
    const codes = {};
    const replaceCodes = {};
    (raw || []).forEach(en => { if (en && en.course) codes[en.course] = true; });
    const requested = (Array.isArray(requestCodes) ? requestCodes : []).map(normCode).filter(Boolean);
    requested.forEach(code => { if (!codes[code]) codes[code] = false; });
    const extra = [];
    const seen = {};
    for (const en of raw){
      if (!en || !en.section || seen[en.section]) continue;
      const course = coursesById[en.course];
      const section = course && course.sections.find(sec => sec.id === en.section);
      if (course && section) extra.push(makeEntry(course.code, section));
      else extra.push({ course: en.course, section: en.section, label: en.label || '', meetings: Array.isArray(en.meetings) ? en.meetings : [], component: en.component || '' });
      seen[en.section] = true;
    }
    const removed = requested.filter(code => schedule.some(en => en.course === code));
    setSchedule(prev => prev.filter(en => !(codes[en.course] === true || codes[en.course] === false)).concat(extra));
    const replaced = raw.filter(en => en && en.course && schedule.some(x => x.course === en.course)).map(en => en.course);
    const bits = [];
    if (replaced.length) bits.push('Replaced ' + replaced.join(', '));
    else if (extra.length) bits.push('Added ' + extra.length + ' class' + (extra.length === 1 ? '' : 'es'));
    if (removed.length) bits.push('Removed ' + removed.join(', '));
    toast(bits.length ? bits.join(' · ') : 'Nothing to apply from this plan');
  }
  function openDeps(code){
    setDeps(d => ({ key: d.key + 1, code: code || '' }));
    setTab('deps');
    setRightOpen(true);
  }
  function jumpTo(code){
    const c = normCode(code);
    setDeps(d => ({ key: d.key + 1, code: c }));
    setTab('deps');
    setRightOpen(true);
    if (coursesById[c]){ setQuery(c); setSelected(c); setLeftOpen(true); }
  }
  function clearSchedule(){
    if (!schedule.length) return;
    if (window.confirm('Remove all ' + schedule.length + ' section(s) from the timetable?')){
      setSchedule([]);
      toast('Schedule cleared');
    }
  }

  if (status === 'loading') return <LoadScreen />;
  if (status === 'manual') return <ManualLoad onData={(d) => {
    rawCoursesRef.current = d.rawCourses || null;
    rawCatalogRef.current = d.rawCatalog || null;
    rawKlmsRef.current = d.rawKlms || [];
    setCourses(d.courses);
    setCatalogMap(d.catalogMap);
    setDataLabels({ courses: d.coursesName || 'courses.json', catalog: d.catalogName || 'data.json', klms: d.klmsName || 'courses_klms.json' });
    setStatus('ready');
  }} />;

  const results = applyFilters(searchCourses(courses, query), filters, schedule);
  const klmsActive = !!(rawKlmsRef.current && rawKlmsRef.current.length && dataLabels.klms);
  const sisCount = Array.isArray(rawCoursesRef.current) ? rawCoursesRef.current.length : courses.filter(c => !c.klms).length;
  const klmsCount = courses.filter(c => c.klms).length;
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">HKUST SIS Course Planner</div>
        <div className="header-status">
          <span className="status-pill ok" title={dataLabels.courses}>{dataLabels.courses} · {sisCount}</span>
          {klmsActive ? <span className="status-pill ok" title={dataLabels.klms}>{dataLabels.klms} · {klmsCount}</span> : null}
          <span className="status-pill ok" title={dataLabels.catalog}>{dataLabels.catalog} · {Object.keys(catalogMap).length}</span>
        </div>
        <label className="hbtn file" title="Replace course sections JSON">
          Load courses
          <input className="hfile" type="file" accept=".json,application/json" onChange={(e) => onPickCustom('courses', e)} />
        </label>
        <label className="hbtn file" title="Replace KLMS course sections JSON (PE / general education)">
          Load KLMS courses
          <input className="hfile" type="file" accept=".json,application/json" onChange={(e) => onPickCustom('klms', e)} />
        </label>
        <label className="hbtn file" title="Replace catalog / prerequisite JSON">
          Load catalog
          <input className="hfile" type="file" accept=".json,application/json" onChange={(e) => onPickCustom('catalog', e)} />
        </label>
        <button className="hbtn" title="Configure the course-data API (URL / token / term) and load catalog / SISN / KLMS from it" onClick={() => setApiOpen(true)}>API</button>
        <div className="save-group">
          <button className="hbtn" title="Save timetable and auto-schedule list in this browser" onClick={saveLocal}>Save</button>
          <button className="hbtn" title="Download a JSON backup" onClick={exportSave}>Export</button>
          <label className="hbtn file" title="Import a previously exported save file">
            Import
            <input className="hfile" type="file" accept=".json,application/json" onChange={onPickSave} />
          </label>
        </div>
        <button className="hbtn" title="Add every section on the timetable to the HKUST(GZ) SISN / KLMS course cart (uses the API TOKEN)" onClick={onAddToSystemCart} disabled={cartBusy}>{cartBusy ? 'Adding…' : 'Add to system cart'}</button>
        <div className="spacer"></div>
        <button className="hbtn danger" onClick={clearSchedule}>Clear timetable</button>
      </header>
      <main className={'app-main' + (leftOpen ? '' : ' left-collapsed') + (rightOpen ? '' : ' right-collapsed')}>
        <aside className={'left' + (leftOpen ? '' : ' collapsed')}>
          {leftOpen ? (
          <React.Fragment>
          <div className="pane-head">
            <span className="pane-title">Search</span>
            <div className="spacer"></div>
            <button className="pane-toggle" title="Collapse search" onClick={() => setLeftOpen(false)}>‹</button>
          </div>
          <div className="search-box">
            <input value={query} placeholder="Search code / name / description…  e.g. AI, AIAA2205, Introduction"
              onChange={(e) => setQuery(e.target.value)} />
            {query ? <button className="search-clear" onClick={() => setQuery('')}>✕</button> : null}
          </div>
          <FilterBar courses={courses} filters={filters} setFilters={setFilters} />
          <div className="left-scroll">
            {selectedCourse ? (
              <CourseDetail course={selectedCourse} scheduledIds={scheduledIds} conflictSections={conflictSections}
                onAdd={addSection} onRemove={removeSection} onOpenDeps={openDeps}
                onBack={() => setSelected(null)} onDragStartSec={startPoolDrag}
                filters={filters} schedule={schedule} />
            ) : (
              <div>
                <div className="list-hint">{results.length} course{results.length === 1 ? '' : 's'}{(query || filtersActive(filters)) ? ' matched' : ''}{query ? ' · "' + query + '"' : ''} — click to inspect</div>
                {results.map(c => <CourseCard key={c.code} c={c} onClick={() => setSelected(c.code)} crossDrag={crossDrag} onDragCourse={startCourseDrag} />)}
                {!results.length ? <div className="no-sections">No courses match the current search / filters.</div> : null}
              </div>
            )}
          </div>
          </React.Fragment>
          ) : (
            <button className="pane-rail" title="Expand search" onClick={() => setLeftOpen(true)}>Search</button>
          )}
        </aside>
        <section className="center">
          <Timetable schedule={schedule} coursesById={coursesById} drag={drag} hover={hover} gridRef={gridRef}
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
            onRemoveEntry={removeSection} crossDrag={crossDrag} onToggleCrossDrag={setCrossDrag}
            onDragBlock={startBlockDrag} blockedPeriods={blockedPeriods} onAddBlocked={addBlockedRanges}
            onRemoveBlocked={removeBlocked} containsSlots={containsSlots} onRemoveContains={removeContains}
            onSetContains={setContainsRanges} onSwitchSection={switchSection} />
        </section>
        <aside className={'right' + (rightOpen ? '' : ' collapsed')}>
          {rightOpen ? (
          <React.Fragment>
          <div className="tabs">
            <button className={'tab' + (tab === 'sched' ? ' active' : '')} onClick={() => setTab('sched')}>Auto Scheduler</button>
            <button className={'tab' + (tab === 'deps' ? ' active' : '')} onClick={() => setTab('deps')}>Dependencies</button>
            <div className="spacer"></div>
            <button className="pane-toggle" title="Collapse planner" onClick={() => setRightOpen(false)}>›</button>
          </div>
          <div className="tab-body">
            {tab === 'sched'
              ? <SchedulerTab courses={courses} coursesById={coursesById} onApply={applySolution} focusTick={schedFocusTick} planner={planner} onPlannerChange={setPlanner} lockedSchedule={schedule} blockedPeriods={blockedPeriods} containsSlots={containsSlots} onContainsChange={setContainsSlots} />
              : <DepsTab key={'deps' + deps.key} initialCode={deps.code} courses={courses} coursesById={coursesById}
                  catalogMap={catalogMap} names={names} onJump={jumpTo} />}
          </div>
          </React.Fragment>
          ) : (
            <button className="pane-rail" title="Expand planner" onClick={() => setRightOpen(true)}>Planner</button>
          )}
        </aside>
      </main>
      <CartFab
        schedule={schedule}
        coursesById={coursesById}
        open={cartOpen}
        onToggle={() => setCartOpen(v => !v)}
        onClose={() => setCartOpen(false)}
        onOpenCourse={(code) => { setSelected(code); setLeftOpen(true); setCartOpen(false); }}
        onRemoveSection={removeSection}
        onRemoveCourse={(code) => { setSchedule(prev => prev.filter(en => en.course !== code)); toast('Removed ' + code); }}
      />
      {apiOpen ? <ApiModal cfg={apiCfg} busy={apiBusy} onCfg={setApiCfg} onLoad={onApiLoad} onClose={() => setApiOpen(false)} /> : null}
      <Toasts items={toasts} />
    </div>
  );
}

import { DAY_NAMES, END_HOUR, START_HOUR } from '../constants';
import { bundleCoversTimes, generateSchedules, sortScored } from '../schedule/scheduler';
import { courseBundles, parallelClassCount } from '../schedule/sections';
import { searchCourses } from './search';
import { fmtDec, fmtRange, summaryOf, uid } from '../utils';
import { CloseIcon, TrashIcon } from './icons';

/* ================= auto scheduler tab ================= */
export function hourOptions(){
  const out = [];
  for (let h = START_HOUR; h <= END_HOUR; h++){
    out.push(h);
    if (h < END_HOUR) out.push(h + 0.5);
  }
  return out;
}
export function courseTimeOptions(course){
  return ((course && course.sections) || []).filter(s => s.meetings && s.meetings.length).map(s => ({
    id: s.id,
    label: s.label,
    component: s.componentName || s.component || '',
    times: s.meetings.map(m => ({ day: m.day, time: m.start, end: m.end, labels: [s.label] })),
    summary: s.meetings.map(m => DAY_NAMES[m.day] + ' ' + fmtRange(m)).join(' / ')
  }));
}
export function slotKey(s){ return s.id || (s.day + '-' + s.time); }
export function slotLabel(s){
  const range = s.end != null ? (fmtDec(s.start != null ? s.start : s.time) + '–' + fmtDec(s.end)) : fmtDec(s.time);
  return DAY_NAMES[s.day] + ' ' + range;
}
export function CourseCombo({ value, courses, used, onChange, inputRef }){
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef(null);
  const inputRef2 = React.useRef(null);
  const [rect, setRect] = React.useState(null);
  const selected = courses.find(c => c.code === value) || null;
  function measure(){
    const el = (inputRef && inputRef.current) || inputRef2.current;
    if (el) setRect(el.getBoundingClientRect());
  }
  function openList(){
    setOpen(true);
    setQ('');
    measure();
    requestAnimationFrame(measure);
  }
  React.useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const closeOnScroll = (e) => { if (e.target && e.target.closest && e.target.closest('.combo-list.fixed')) return; setOpen(false); };
    const closeOnResize = () => { setOpen(false); setRect(null); };
    document.addEventListener('mousedown', h);
    document.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnResize);
    };
  }, []);
  const list = React.useMemo(() => {
    const avail = courses.filter(c => !used[c.code] || c.code === value);
    const query = String(q || '').trim();
    if (!query) return avail.slice().sort((a, b) => a.code.localeCompare(b.code));
    return searchCourses(avail, query);
  }, [courses, used, value, q]);
  const inputEl = inputRef || inputRef2;
  const listBox = open && rect ? (
    <div className="combo-list fixed" style={{ left: rect.left, top: rect.bottom + 4, width: rect.width }}>
      {list.map(c => (
        <button type="button" key={c.code} className={'combo-item' + (c.code === value ? ' on' : '')}
          onMouseDown={(e) => { e.preventDefault(); onChange(c.code); setOpen(false); setQ(''); setRect(null); }}>
          <b>{c.code}</b>
          <span>{c.name}</span>
          {parallelClassCount(c) > 1 ? <em>{parallelClassCount(c)} sections</em> : null}
        </button>
      ))}
      {!list.length ? <div className="combo-empty">No matching courses</div> : null}
    </div>
  ) : null;
  return (
    <div className="combo" ref={boxRef}>
      <input ref={inputEl} value={open ? q : (selected ? selected.code + '  ' + selected.name : q)}
        placeholder="Search course code / name"
        spellCheck={false}
        onFocus={openList}
        onClick={measure}
        onChange={(e) => { setQ(e.target.value); setOpen(true); measure(); if (!e.target.value) onChange(''); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]){ onChange(list[0].code); setOpen(false); setQ(''); setRect(null); e.preventDefault(); }
          if (e.key === 'Escape'){ setOpen(false); setRect(null); }
        }} />
      {window.ReactDOM && listBox ? window.ReactDOM.createPortal(listBox, document.body) : null}
    </div>
  );
}
export function SchedCourseRow({ item, courses, used, mode, onChange, onRemove, inputRef }){
  const [day, setDay] = React.useState(1);
  const [time, setTime] = React.useState(9);
  const [slot, setSlot] = React.useState('');
  const course = courses.find(c => c.code === item.code) || null;
  const times = item.times || [];
  const sections = item.sections || [];
  const slots = React.useMemo(() => courseTimeOptions(course), [course]);
  React.useEffect(() => { setSlot('__all__'); }, [item.code]);
  function addTimeFromClock(){
    if (times.some(t => t.day === day && t.time === time)) return;
    onChange(Object.assign({}, item, { all: false, times: times.concat([{ day: day, time: time }]) }));
  }
  function addSectionFromCourse(){
    if (slot === '__all__'){
      onChange(Object.assign({}, item, { all: true, times: [], sections: [] }));
      return;
    }
    const hit = slots.find(s => slotKey(s) === slot);
    if (!hit) return;
    if (sections.some(id => id === hit.id)) return;
    onChange(Object.assign({}, item, { all: false, times: [], sections: sections.concat([hit.id]) }));
  }
  function removeTime(idx){
    onChange(Object.assign({}, item, { times: times.filter((_, i) => i !== idx) }));
  }
  function removeSection(idx){
    onChange(Object.assign({}, item, { sections: sections.filter((_, i) => i !== idx) }));
  }
  let remain = null;
  let remainBad = false;
  if (course && item.all){
    const nBundles = courseBundles(course).length;
    remain = nBundles ? nBundles + ' section bundle(s)' : 'No valid section combination for this course';
    remainBad = !nBundles;
  } else if (course && sections.length){
    const all = courseBundles(course);
    const n = all.filter(b => sections.every(id => b.some(en => en.section === id))).length;
    remain = n + '/' + all.length;
    remainBad = !all.length;
  } else if (course && times.length){
    const all = courseBundles(course);
    remain = all.filter(b => bundleCoversTimes(b, times)).length + '/' + all.length;
  }
  const enabled = item.enabled !== false;
  return (
    <div className={'sched-row' + (enabled ? '' : ' off')}>
      <div className="sched-row-body">
        <div className="sched-radio">
          <button type="button" className={enabled ? 'on' : ''} title={enabled ? 'Exclude from scheduling' : 'Include in scheduling'}
            onClick={() => onChange(Object.assign({}, item, { enabled: !enabled }))} aria-pressed={enabled}></button>
        </div>
        <div className="sched-radio-body">
      <div className="sched-row-top">
        <CourseCombo value={item.code} courses={courses} used={used} onChange={(code) => onChange(Object.assign({}, item, { code: code, times: [], sections: [], all: false, enabled: true }))} inputRef={inputRef} />
        <button className="sbtn rm icon" title="Remove course" aria-label="Remove course" onClick={onRemove}><TrashIcon /></button>
      </div>
      <div className="sched-row-times">
        {mode === 'course' ? (
          <div className="sched-time-add">
            <select className="sched-slot" value={slot} disabled={!course} onChange={(e) => setSlot(e.target.value)}>
              {!course ? <option value="">Select a course first</option> : null}
              {course ? <option value="__all__">All sections</option> : null}
              {slots.map(s => <option key={slotKey(s)} value={slotKey(s)}>{s.label} {s.component ? '(' + s.component + ') ' : ''}· {s.summary}</option>)}
            </select>
            <button className="sbtn" onClick={addSectionFromCourse} disabled={!course || !slot}>{slot === '__all__' ? 'Use all sections' : 'Add this section'}</button>
          </div>
        ) : (
          <div className="sched-time-add">
            <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {[[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri']].map(p => <option key={p[0]} value={p[0]}>{p[1]}</option>)}
            </select>
            <select value={time} onChange={(e) => setTime(Number(e.target.value))}>
              {hourOptions().map(h => <option key={h} value={h}>{fmtDec(h)}</option>)}
            </select>
            <button className="sbtn" onClick={addTimeFromClock} disabled={!item.code}>Add time</button>
          </div>
        )}
        {sections.map((sid, i) => {
          const s = slots.find(x => x.id === sid);
          return (
            <span className="tchip" key={sid}>
              {s ? s.label + (s.component ? ' (' + s.component + ')' : '') + ' · ' + s.summary : sid}
              <button type="button" onClick={() => removeSection(i)}>×</button>
            </span>
          );
        })}
        {times.map((tm, i) => (
          <span className="tchip" key={i}>
            {slotLabel(tm)}{tm.labels && tm.labels.length ? ' · ' + tm.labels.join('/') : ''}
            <button type="button" onClick={() => removeTime(i)}>×</button>
          </span>
        ))}
        {remain ? <span className={'sched-note' + (remainBad ? ' bad' : '')}>{item.all ? remain : remain + (sections.length ? ' bundles contain the selected section(s)' : ' bundles cover the selected time(s)')}</span> : null}
        {item.all ? (
          <span className="tchip">All sections<button type="button" onClick={() => onChange(Object.assign({}, item, { all: false, times: [], sections: [] }))}>×</button></span>
        ) : null}
        {course && !item.all && !sections.length && !times.length && parallelClassCount(course) > 1 ? <span className="sched-note">{parallelClassCount(course)} sections</span> : null}
      </div>
        </div>
      </div>
    </div>
  );
}
export function fmtHours(n){
  const x = Math.round(Number(n) * 10) / 10;
  return (x % 1 === 0 ? String(x.toFixed(0)) : String(x)) + 'h';
}
export function SchedulerTab({ courses, coursesById, onApply, focusTick, planner, onPlannerChange, lockedSchedule, blockedPeriods, containsSlots, onContainsChange }){
  const mode = planner.mode;
  const items = planner.items;
  const rank = planner.rank || 'even';
  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [filterSlots, setFilterSlots] = React.useState([]);
  const [fDay, setFDay] = React.useState(1);
  const [fStart, setFStart] = React.useState(START_HOUR);
  const [fEnd, setFEnd] = React.useState(START_HOUR + 1);
  const firstRef = React.useRef(null);
  React.useEffect(() => { if (focusTick && firstRef.current) firstRef.current.focus(); }, [focusTick]);
  const used = {};
  items.forEach(it => { if (it.code) used[it.code] = true; });
  function setMode(next){ onPlannerChange(Object.assign({}, planner, { mode: next })); }
  function setRank(next){
    onPlannerChange(Object.assign({}, planner, { rank: next }));
    setResult(prev => prev ? Object.assign({}, prev, { solutions: sortScored(prev.solutions.slice(), next), rankBy: next }) : prev);
  }
  function setItems(updater){
    onPlannerChange(prev => {
      const cur = prev.items;
      const next = typeof updater === 'function' ? updater(cur) : updater;
      return Object.assign({}, prev, { items: next });
    });
    setResult(null);
  }
  function loadCurrent(){
    const seen = {};
    const next = [];
    (lockedSchedule || []).forEach(en => {
      if (!en || !en.course || seen[en.course]) return;
      seen[en.course] = true;
      next.push({ id: uid(), code: en.course, times: [], sections: [], all: true, enabled: true });
    });
    if (!next.length) next.push({ id: uid(), code: '', times: [], sections: [], all: false, enabled: true });
    setItems(next);
    setResult(null);
  }
  function generate(){
    setBusy(true);
    setResult(null);
    setTimeout(() => {
      const reqs = items.filter(it => it.code && it.enabled !== false).map(it => mode === 'course'
        ? { code: it.code, times: [], sections: it.all ? [] : (it.sections || []) }
        : { code: it.code, times: it.times || [], sections: [] });
      const opts = { collectLimit: 1000, showLimit: 1000, rankBy: rank, blocked: blockedPeriods || [] };
      const r = generateSchedules(reqs, coursesById, Object.assign({ locked: lockedSchedule || [] }, opts));
      setResult(r);
      setBusy(false);
    }, 30);
  }
  function addFilterSlot(){
    if (fEnd <= fStart) return;
    const slot = { day: fDay, start: fStart, end: fEnd };
    if (filterSlots.some(sl => sl.day === slot.day && sl.start === slot.start && sl.end === slot.end)) return;
    setFilterSlots(prev => prev.concat([slot]));
  }
  function pickStart(v){
    setFStart(v);
    if (v >= fEnd) setFEnd(Math.min(END_HOUR, v + 0.5));
  }
  function pickEnd(v){
    setFEnd(v);
    if (v <= fStart) setFStart(Math.max(START_HOUR, v - 0.5));
  }
  const shown = result ? result.solutions.filter(sol => {
    const entriesOf = sol.entries && sol.entries.length ? sol.entries : (sol.full || []);
    const passSlots = filterSlots.every(slot => {
      const dayMeetings = [];
      entriesOf.forEach(en => (en.meetings || []).forEach(m => { if (m.day === slot.day) dayMeetings.push(m); }));
      return dayMeetings.length > 0 && dayMeetings.every(m => slot.start <= m.start && m.end <= slot.end);
    });
    const passContains = (containsSlots || []).every(slot => {
      let hit = false;
      entriesOf.forEach(en => (en.meetings || []).forEach(m => { if (m.day === slot.day && m.start < slot.end && slot.start < m.end) hit = true; }));
      return hit;
    });
    const passBlocked = !(blockedPeriods || []).some(b => entriesOf.some(en => (en.meetings || []).some(m => m.day === b.day && m.start < b.end && b.start < m.end)));
    return passSlots && passContains && passBlocked;
  }) : [];
  const hint = mode === 'course'
    ? 'Pick the section(s) to pin, or All to search every section'
    : 'Pick any clock time, keep sections that cover it';
  const help = 'Add courses from the searchable list. A generated plan adds new courses, or replaces their sections if they are already on the timetable — other classes stay untouched. In Course first, choose All to search every section or pin specific sections and rank by evenness / walking distance. Lecture/Tutorial same-index pairing is honoured.';
  return (
    <div>
      <div className="mode-switch">
        <span className="mode-label">Pin by</span>
        <div className="switch">
          <button type="button" className={mode === 'time' ? 'on' : ''} onClick={() => setMode('time')}>Time first</button>
          <button type="button" className={mode === 'course' ? 'on' : ''} onClick={() => setMode('course')}>Course first</button>
        </div>
        <span className="switch-hint">{hint}</span>
      </div>
      {mode === 'course' ? (
        <div className="mode-switch">
          <span className="mode-label">Rank by</span>
          <div className="switch">
            <button type="button" className={rank === 'even' ? 'on' : ''} onClick={() => setRank('even')}>Evenness first</button>
            <button type="button" className={rank === 'distance' ? 'on' : ''} onClick={() => setRank('distance')}>Distance first</button>
          </div>
          <span className="switch-hint">{rank === 'distance' ? 'Penalize 10-minute transfers across buildings first' : 'Spread daily hours first, then prefer same-building transfers'}</span>
        </div>
      ) : null}
      <div className="sched-help">{help}</div>
      <div className="sched-rows">
        {items.map((it, i) => (
          <SchedCourseRow key={it.id} item={it} courses={courses} used={used} mode={mode}
            inputRef={i === 0 ? firstRef : null}
            onChange={(next) => setItems(prev => prev.map(x => x.id === it.id ? next : x))}
            onRemove={() => setItems(prev => prev.filter(x => x.id !== it.id))} />
        ))}
        <button className="sched-add" onClick={() => setItems(prev => prev.concat([{ id: uid(), code: '', times: [], sections: [], enabled: true }]))}>+ Add course</button>
      </div>
      <div className="sched-actions">
        <button className="sched-btn" onClick={generate} disabled={busy || !items.some(it => it.code && it.enabled !== false)}>{busy ? 'Generating…' : 'Generate Schedule'}</button>
        <button className="sched-btn ghost" type="button" onClick={loadCurrent} disabled={busy || !(lockedSchedule && lockedSchedule.length)} title="Fill the list with courses currently on the timetable">Load current</button>
        <span className="sched-note">{items.filter(it => it.code && it.enabled !== false).length} course(s) selected</span>
      </div>
      {containsSlots.length ? (
        <div className="sched-filter">
          <span className="sched-note">Must include classes in (timetable right-drag box):</span>
          {containsSlots.map(sl => (
            <span className="tchip" key={sl.id}>
              {DAY_NAMES[sl.day]} {fmtDec(sl.start)}–{fmtDec(sl.end)}
              <button type="button" onClick={() => onContainsChange(containsSlots.filter(c => c.id !== sl.id))}>×</button>
            </span>
          ))}
          <button className="sbtn ghost icon" title="Clear contains filter" aria-label="Clear contains filter" onClick={() => onContainsChange([])}><CloseIcon /></button>
          {!result ? <span className="sched-note">Generate to apply this filter</span> : null}
        </div>
      ) : null}
      {blockedPeriods.length ? (
        <div className="sched-filter">
          <span className="sched-note">Blocked periods (timetable left-drag box) — plans avoid them:</span>
          {blockedPeriods.map(b => (
            <span className="tchip bad" key={b.id}>{DAY_NAMES[b.day]} {fmtDec(b.start)}–{fmtDec(b.end)}</span>
          ))}
        </div>
      ) : null}
      {result ? (
        <div>
          {result.solutions.length ? (
            <div className="sched-filter">
              <span className="sched-note">Filter plans by day window:</span>
              <select value={fDay} onChange={(e) => setFDay(Number(e.target.value))}>
                {[[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri']].map(p => <option key={p[0]} value={p[0]}>{p[1]}</option>)}
              </select>
              <select value={fStart} onChange={(e) => pickStart(Number(e.target.value))}>
                {hourOptions().map(h => <option key={h} value={h}>{fmtDec(h)}</option>)}
              </select>
              <span className="sched-note">to</span>
              <select value={fEnd} onChange={(e) => pickEnd(Number(e.target.value))}>
                {hourOptions().map(h => <option key={h} value={h}>{fmtDec(h)}</option>)}
              </select>
              <button className="sbtn" onClick={addFilterSlot} disabled={fEnd <= fStart}>Add period</button>
              {fEnd <= fStart ? <span className="sched-note bad">End must be after start</span> : null}
              {filterSlots.map((sl, i) => (
                <span className="tchip" key={i}>
                  {DAY_NAMES[sl.day]} {fmtDec(sl.start)}–{fmtDec(sl.end)}
                  <button type="button" onClick={() => setFilterSlots(prev => prev.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
              {filterSlots.length ? <button className="sbtn ghost icon" title="Clear periods" aria-label="Clear periods" onClick={() => setFilterSlots([])}><CloseIcon /></button> : null}
              {(filterSlots.length || containsSlots.length || blockedPeriods.length) ? <span className="sched-note">Showing {shown.length} of {result.solutions.length} plan{result.solutions.length === 1 ? '' : 's'}</span> : null}
              <span className="sched-note">All classes on that day must fit inside the period</span>
            </div>
          ) : null}
          {result.warnings.length ? (
            <div className="warn">{result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>
          ) : null}
          {!result.solutions.length && !result.truncated ? (
            <div className="warn bad">No conflict-free schedule found for these courses.</div>
          ) : null}
          {result.truncated ? <div className="warn">Search space exceeded — showing partial results.</div> : null}
          {result.found ? (
            <div className="sched-note" style={{ marginTop: 8 }}>{result.found} conflict-free timetable{result.found === 1 ? '' : 's'} found.</div>
          ) : null}
          {!shown.length && result.solutions.length ? (
            <div className="warn">No plans fit the current filters — adjust or clear them.</div>
          ) : null}
          {shown.map((sol, i) => (
            <div className="solution" key={i}>
              <h4>
                Plan {i + 1}
                <button className="sbtn sol-apply" onClick={() => onApply(sol, items.filter(it => it.code && it.enabled !== false).map(it => it.code))}>Add to timetable</button>
              </h4>
              {sol.even ? (
                <div className="sol-metrics">
                  <span className="metric">Evenness σ {fmtHours(sol.even.std)}</span>
                  <span className={'metric' + (sol.dist && sol.dist.far ? ' bad' : ' good')}>Cross-building {sol.dist ? sol.dist.far : 0}</span>
                  <span className="metric good">Same building {sol.dist ? sol.dist.same : 0}</span>
                  {sol.dist && sol.dist.pairs ? <span className="metric">10-min transfers {sol.dist.pairs}</span> : null}
                </div>
              ) : null}
              {sol.even ? (
                <div className="sol-days">Daily hours (full timetable): {['Mon','Tue','Wed','Thu','Fri'].map((d, di) => d + ' ' + fmtHours(sol.even.hours[di])).join(' · ')}</div>
              ) : null}
              <div className="sol-days">Adds the classes below, or replaces them if already on the timetable. Other classes stay.</div>
              {lockedSchedule && lockedSchedule.length ? (
                <div className="sol-days">Current: {lockedSchedule.map(en => en.course + ' ' + en.label).join(' · ')}</div>
              ) : null}
              {(Array.isArray(sol.entries) ? sol.entries : sol).map(en => (
                <div className="sol-row" key={en.section}>
                  <span className="sol-code">{en.course}</span>
                  <span className="sol-sec">{en.label}</span>
                  <span className="sol-time">{summaryOf(en.meetings)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

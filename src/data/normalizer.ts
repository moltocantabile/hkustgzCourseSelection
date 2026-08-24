import { cleanField, cleanTeacher, normCode, toDec } from '../utils';
import type { Course } from '../types';

/* ================= normalizer (courses.json -> app model) ================= */
export function normalizeCourse(c: any, catalogMap: Record<string, any>): Course {
  const ci = c.courseInfo || {};
  const code = normCode(ci.crseCode);
  const cat = catalogMap[code] || {};
  const sections = (c.classSections || []).map(s => {
    const meetings = [];
    for (const m of (s.meetingInfoList || [])){
      const days = String(m.weekDay || '').split(',').map(x => parseInt(x, 10)).filter(x => x >= 1 && x <= 5);
      const start = toDec(m.meetingStartTime), end = toDec(m.meetingEndTime);
      if (!days.length || !isFinite(start) || !isFinite(end) || end <= start) continue;
      const instructors = [];
      const seenInst = {};
      for (const raw of (m.instructorList || [])){
        const name = cleanTeacher(raw.instructorName) || [cleanTeacher(raw.lastName), cleanTeacher(raw.firstName)].filter(Boolean).join(' ');
        if (!name) continue;
        const inst = {
          name: name,
          email: cleanField(raw.email),
          account: cleanField(raw.userAccount),
          role: cleanField(raw.instructorRoleIndEnDesc) || cleanField(raw.instructorRoleIndDesc),
          firstName: cleanField(raw.firstName),
          lastName: cleanField(raw.lastName)
        };
        const key = inst.name + '|' + inst.email + '|' + inst.account;
        if (seenInst[key]) continue;
        seenInst[key] = true;
        instructors.push(inst);
      }
      const teacher = instructors.map(x => x.name).join('; ');
      const room = String(m.facilityName || '').trim();
      const startDate = cleanField(m.startDate), endDate = cleanField(m.endDate);
      for (const day of days) meetings.push({ day: day, start: start, end: end, room: room, teacher: teacher, instructors: instructors, startDate: startDate, endDate: endDate });
    }
    meetings.sort((a, b) => a.day - b.day || a.start - b.start);
    const assoc = Number(s.associatedClass);
    return {
      id: s.classId || (code + '-' + s.classSection),
      label: s.classSection || s.classCode || '',
      type: s.ssrComponent || s.crseComponentName || '',
      component: s.ssrComponent || 'OTH',
      componentName: s.crseComponentName || s.ssrComponent || 'Section',
      associatedClass: isFinite(assoc) ? assoc : 0,
      optional: s.optionalComponent === 'Y',
      primary: s.primaryComponent === 'Y',
      capacity: s.enrollmentCapacity || 0,
      enrolled: s.enrollmentNbr || 0,
      meetings: meetings,
      crseWid: cleanField(s.crseWid) || cleanField(s.modularCrseWid) || '',
      crseComponentId: cleanField(s.crseComponentId),
      termId: cleanField(s.termId),
      acadCareer: cleanField(ci.academicCareer)
    };
  });
  sections.sort((a, b) => a.component.localeCompare(b.component) || a.label.localeCompare(b.label, undefined, {numeric: true}));
  return {
    code: code,
    name: ci.crseName || '',
    credits: ci.totalCredits || 0,
    shortDesc: cleanField(ci.crseShortDesc),
    desc: cleanField(cat.crseDescr) || cleanField(ci.crseShortDesc),
    sections: sections,
    isMulti: ci.isMultiComponent === 'Y',
    associateMsg: cleanField(ci.associateMsg),
    subject: cleanField(ci.subjectArea) || (code.match(/^[A-Z]+/) || [''])[0],
    career: cleanField(ci.academicCareer) || cleanField((c.classSections && c.classSections[0] && c.classSections[0].careerId) || ''),
    prereq: cleanField(cat.crsePrerequisite),
    coreq: cleanField(cat.crseCorequisite),
    equiv: cleanField(cat.equivCourseCode),
    title: cleanField(cat.crseTitle)
  };
}
export function normalizeCourses(raw: any, catalogMap: Record<string, any>): Course[] {
  return (Array.isArray(raw) ? raw : []).map(c => normalizeCourse(c, catalogMap)).filter(c => c.code);
}

export const COMP_MAP_KLMS = { 'Lecture': 'LEC', 'Laboratory': 'LAB', 'Tutorial': 'TUT', 'Seminar': 'SEM', 'Other': 'OTH' };
export function normalizeKlmsCourses(raw: any, catalogMap: Record<string, any>): Course[] {
  const out = [];
  for (const item of (Array.isArray(raw) ? raw : [])){
    const ci = item.courseInfo || {};
    const code = normCode(ci.crseCode);
    if (!code) continue;
    const cat = (catalogMap && catalogMap[code]) || {};
    const sections = [];
    const seenIds = new Set();
    for (const m of (item.courseModuleInfos || [])){
      const id = String(m.classId || '');
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      const meetings = [];
      for (const mt of (m.meetingInfoList || [])){
        const days = String(mt.weekDay || '').split(',').map(x => parseInt(x, 10)).filter(x => x >= 1 && x <= 5);
        const start = toDec(mt.meetingStartTime), end = toDec(mt.meetingEndTime);
        if (!days.length || !isFinite(start) || !isFinite(end) || end <= start) continue;
        const instructors = [];
        const seenInst = {};
        for (const raw of (mt.instructorList || [])){
          const name = cleanTeacher(raw.instructorName) || cleanTeacher(raw.lastName) || cleanTeacher(raw.firstName) || '';
          if (!name) continue;
          const inst = {
            name: name,
            email: cleanField(raw.email),
            account: cleanField(raw.userAccount),
            role: cleanField(raw.instructorRole),
            firstName: cleanField(raw.firstName),
            lastName: cleanField(raw.lastName)
          };
          const key = inst.name + '|' + inst.email + '|' + inst.account;
          if (seenInst[key]) continue;
          seenInst[key] = true;
          instructors.push(inst);
        }
        const teacher = instructors.map(x => x.name).join('; ');
        const room = String(mt.facilityName || mt.location || '').trim();
        const startDate = cleanField(mt.startDate), endDate = cleanField(mt.endDate);
        for (const day of days) meetings.push({ day: day, start: start, end: end, room: room, teacher: teacher, instructors: instructors, startDate: startDate, endDate: endDate });
      }
      meetings.sort((a, b) => a.day - b.day || a.start - b.start);
      const componentName = cleanField(m.crseComponentName) || 'Other';
      const rawLabel = cleanField(m.classSection) || cleanField(m.classCode) || 'Section';
      const classCode = cleanField(m.classCode);
      sections.push({
        id: id,
        label: rawLabel,
        type: componentName,
        component: COMP_MAP_KLMS[componentName] || 'OTH',
        componentName: componentName,
        associatedClass: 0,
        optional: false,
        primary: false,
        capacity: Number(m.enrollmentCapacity) || 0,
        enrolled: Number(m.enrollmentNbr) || 0,
        _rawLabel: rawLabel,
        _classCode: classCode,
        meetings: meetings,
        crseWid: cleanField(m.crseWid) || '',
        crseComponentId: cleanField(m.crseComponentId),
        termId: cleanField(m.termId),
        acadCareer: cleanField(ci.academicCareer)
      });
    }
    const labelCount = {};
    sections.forEach(s => labelCount[s._rawLabel] = (labelCount[s._rawLabel] || 0) + 1);
    sections.forEach(s => {
      s.label = (labelCount[s._rawLabel] > 1 && s._classCode) ? s._rawLabel + ' (' + s._classCode + ')' : s._rawLabel;
      delete s._rawLabel;
      delete s._classCode;
    });
    sections.sort((a, b) => a.component.localeCompare(b.component) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    if (!sections.length) continue;
    out.push({
      code: code,
      name: ci.crseName || '',
      credits: Number(ci.totalCredits) || 0,
      klms: true,
      shortDesc: cleanField(ci.crseShortDesc),
      desc: cleanField(cat.crseDescr) || cleanField(ci.crseShortDesc),
      sections: sections,
      isMulti: false,
      associateMsg: '',
      subject: cleanField(ci.subjectArea) || (code.match(/^[A-Z]+/) || [''])[0],
      career: cleanField(ci.academicCareer) || 'UGRD',
      prereq: cleanField(cat.crsePrerequisite),
      coreq: cleanField(cat.crseCorequisite),
      equiv: cleanField(cat.equivCourseCode),
      title: cleanField(cat.crseTitle)
    });
  }
  return out;
}
export function mergeCourses(sisCourses: Course[], klmsCourses: Course[]): Course[] {
  const sis = sisCourses || [];
  const klms = klmsCourses || [];
  const out = sis.slice();
  const idxByCode = {};
  out.forEach((c, i) => { idxByCode[c.code] = i; });
  for (const k of klms){
    const idx = idxByCode[k.code];
    if (idx != null){
      // Same course in both systems: count it as SIS, but keep the KLMS course
      // data (real sections with class times); its classIds live in KLMS.
      out[idx] = Object.assign({}, k, { klms: false, cartSystem: 'klms' }) as Course;
    } else {
      out.push(k);
    }
  }
  return out;
}

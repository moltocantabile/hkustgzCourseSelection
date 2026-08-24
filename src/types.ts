// Core application model types.

export interface Instructor {
  name: string;
  email: string;
  account: string;
  role: string;
  firstName: string;
  lastName: string;
}

export interface Meeting {
  day: number;
  start: number;
  end: number;
  room: string;
  teacher: string;
  instructors: Instructor[];
  startDate?: string;
  endDate?: string;
}

export interface Section {
  id: string;
  label: string;
  type: string;
  component: string;
  componentName: string;
  associatedClass: number;
  optional: boolean;
  primary: boolean;
  capacity: number;
  enrolled: number;
  meetings: Meeting[];
}

export interface Course {
  code: string;
  name: string;
  credits: number;
  klms?: boolean;
  cartSystem?: 'sisn' | 'klms';
  shortDesc: string;
  desc: string;
  sections: Section[];
  isMulti: boolean;
  associateMsg: string;
  subject: string;
  career: string;
  prereq: string;
  coreq: string;
  equiv: string;
  title: string;
}

export interface Entry {
  course: string;
  section: string;
  label: string;
  meetings: Meeting[];
  component: string;
  associatedClass?: number;
}

export interface TimeRange {
  day: number;
  start: number;
  end: number;
}

export interface Conflict {
  type: 'time' | 'room' | 'instructor' | 'duplicate' | 'blocked';
  other?: string;
  room?: string;
  teacher?: string;
}

export type AstNode =
  | { kind: 'code'; code: string; label?: string }
  | { kind: 'or'; children: AstNode[] }
  | { kind: 'and'; children: AstNode[] }
  | { kind: 'note'; label: string };

export interface PrereqResult {
  ok: boolean;
  node: AstNode | null;
  raw: string;
  approximate: boolean;
  ignored: string[];
}

export interface ApiConfig {
  url: string;
  cartUrl: string;
  token: string;
  termId: string;
}

export interface PlannerTime {
  day: number;
  time: number;
  labels?: string[] | null;
}

export interface PlannerItem {
  id: string;
  code: string;
  all: boolean;
  enabled: boolean;
  times: PlannerTime[];
  sections: string[];
}

export interface Planner {
  mode: 'time' | 'course';
  rank: 'even' | 'distance';
  items: PlannerItem[];
}

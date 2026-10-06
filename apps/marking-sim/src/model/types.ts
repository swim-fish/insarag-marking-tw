// Domain model for INSARAG worksite, victim and RCM markings.
// Rules follow docs/insarag (handbook = 2027 edition, reference notes = 2020 edition).

export type Edition = "2027" | "2020";
export type TriageCategory = "A" | "B" | "C" | "D";
export type AsrLevel = 2 | 3 | 4 | 5;
export type VictimKind = "L" | "D";
export type RcmSymbol = "C" | "D";

export type StageId =
  | "incident"
  | "discovery"
  | "search-start"
  | "status-update"
  | "extraction"
  | "phase-complete"
  | "search-again"
  | "complete";

export interface Team {
  /** Short key used in the scenario (e.g. "t1"). Display text depends on edition. */
  key: string;
  country: string; // 3-letter code
  number: number; // 1..99
}

/** Event log entries. State is always derived by replaying these. */
export type SimEvent =
  | { type: "stage"; stage: StageId }
  | { type: "collapse" }
  | {
      type: "worksite-created";
      team: string;
      date: string;
      hazard: string;
      triage: TriageCategory;
      siteNumber: number;
      arrow: boolean;
    }
  | { type: "asr-completed"; team: string; level: 3 | 4 | 5; date: string }
  | { type: "hazard-added"; text: string }
  | { type: "worksite-closed"; date: string }
  | { type: "deceased-only-closed"; team: string; date: string; siteNumber: number }
  | { type: "victim-site"; site: string; arrow: boolean }
  | { type: "victim-found"; site: string; kind: VictimKind; count: number }
  | { type: "victim-removed"; site: string; kind: VictimKind; count: number }
  | { type: "team-enter"; team: string }
  | { type: "team-exit"; team: string }
  | { type: "rcm-enabled" }
  | { type: "rcm-marked"; object: string; symbol: RcmSymbol; team: string; date: string };

export interface AsrRecord {
  team: string;
  level: AsrLevel;
  date: string;
  seq: number;
}

export interface WorksiteState {
  team: string; // team that created the worksite (2027 ID prefix)
  siteNumber: number;
  hazards: { text: string; seq: number }[];
  triage: TriageCategory;
  arrow: boolean;
  records: AsrRecord[];
  closed: { seq: number } | null;
  deceasedOnly: boolean;
  seq: number;
}

/** One written line under a V, e.g. "L-2". Struck lines stay on the wall. */
export interface VictimLine {
  kind: VictimKind;
  count: number;
  struck: boolean;
  seq: number;
  struckSeq: number | null;
}

export interface VictimSiteState {
  site: string;
  arrow: boolean;
  lines: VictimLine[];
  seq: number;
}

export interface RcmMark {
  symbol: RcmSymbol;
  team: string;
  date: string;
  seq: number;
}

export interface SimState {
  edition: Edition;
  stage: StageId | null;
  collapsed: boolean;
  worksite: WorksiteState | null;
  victims: Record<string, VictimSiteState>;
  teamsOnSite: string[];
  rcmEnabled: boolean;
  rcm: Record<string, RcmMark[]>;
  /** Rule problems found while replaying; the event is still rejected. */
  issues: { seq: number; message: string }[];
}

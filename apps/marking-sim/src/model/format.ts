import type { Edition, Team } from "./types";

export const TEAMS: Record<string, Team> = {
  t1: { key: "t1", country: "AAA", number: 1 },
  t2: { key: "t2", country: "BBB", number: 1 },
  t3: { key: "t3", country: "CCC", number: 1 },
};

/** 2027: AAA01 (no hyphen, S6). 2020: AAA-01 (S1 §6.2 example AUS-01). */
export function teamLabel(key: string, edition: Edition): string {
  const t = TEAMS[key];
  if (!t) return key;
  const n = String(t.number).padStart(2, "0");
  return edition === "2027" ? `${t.country}${n}` : `${t.country}-${n}`;
}

/**
 * 2027: creating team ID + 4-digit serial, e.g. AAA01-0005 (S6).
 * 2020: sector letter + site number, e.g. C-5 (S1 §5.5.5).
 */
export function worksiteId(teamKey: string, siteNumber: number, edition: Edition): string {
  if (edition === "2027") return `${teamLabel(teamKey, edition)}-${String(siteNumber).padStart(4, "0")}`;
  return `C-${siteNumber}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO date (yyyy-mm-dd) -> "05 Oct", the form used in S5 examples and the handbook. */
export function markingDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[(m ?? 1) - 1]}`;
}

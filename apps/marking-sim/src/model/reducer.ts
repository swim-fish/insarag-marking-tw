import type { Edition, SimEvent, SimState, VictimSiteState } from "./types";

export function initialState(edition: Edition): SimState {
  return {
    edition,
    stage: null,
    collapsed: false,
    worksite: null,
    victims: {},
    teamsOnSite: [],
    rcmEnabled: false,
    rcm: {},
    issues: [],
  };
}

export function activeCount(site: VictimSiteState, kind: "L" | "D"): number {
  const line = site.lines.find((l) => l.kind === kind && !l.struck);
  return line ? line.count : 0;
}

/** Returns a zh-TW reason when the event breaks a marking rule, otherwise null. */
export function check(s: SimState, e: SimEvent): string | null {
  switch (e.type) {
    case "worksite-created":
      if (!s.collapsed) return "尚未發生倒塌，沒有工作場址。";
      if (s.worksite) return "工作場址標記已存在；新作業請追加紀錄。";
      return null;
    case "deceased-only-closed":
      if (s.edition !== "2027") return "2020 版沒有「僅有罹難者」的簡化標記規定。";
      if (s.worksite) return "工作場址標記已存在。";
      return null;
    case "asr-completed":
      if (!s.worksite) return "先在 ASR 2 建立工作場址標記。";
      if (s.worksite.closed) return "已畫完成線，不再追加作業紀錄。";
      return null;
    case "hazard-added":
      if (!s.worksite) return "先建立工作場址標記。";
      if (!e.text.trim()) return "危害內容不可空白。";
      return null;
    case "worksite-closed": {
      if (!s.worksite) return "先建立工作場址標記。";
      if (s.worksite.closed) return "完成線已畫過。";
      const remaining = Object.values(s.victims).some((v) => activeCount(v, "L") + activeCount(v, "D") > 0);
      if (remaining) return "仍有已知受困者留在原位置，不可畫完成線。";
      if (!s.worksite.records.some((r) => r.level >= 3))
        return "只有 ASR 2 紀錄；必要的搜救工作尚未完成。";
      return null;
    }
    case "victim-site":
      if (!s.collapsed) return "尚未發生倒塌。";
      if (s.victims[e.site]) return "此位置已有 V 標記。";
      return null;
    case "victim-found":
      if (!s.victims[e.site]) return "先在受困者位置畫 V。";
      if (e.count < 1) return "人數至少為 1。";
      if (s.worksite?.closed) return "工作場址已結案。";
      return null;
    case "victim-removed": {
      const v = s.victims[e.site];
      if (!v) return "沒有這個受困者位置。";
      const n = activeCount(v, e.kind);
      if (n < e.count) return `原位置只剩 ${e.kind}-${n}，不能移出 ${e.count} 人。`;
      return null;
    }
    case "rcm-marked": {
      if (!s.rcmEnabled) return "RCM 須由 LEMA 決定啟用。";
      const marks = s.rcm[e.object] ?? [];
      const last = marks[marks.length - 1];
      if (!last) return null;
      if (last.symbol === "D" && e.symbol === "C") return null;
      return last.symbol === "C" ? "已標記 C，不需再更新。" : "已有 D 標記；罹難者全部移出後才新增 C。";
    }
    case "team-enter":
      return s.teamsOnSite.includes(e.team) ? "隊伍已在現場。" : null;
    case "team-exit":
      return s.teamsOnSite.includes(e.team) ? null : "隊伍不在現場。";
    default:
      return null;
  }
}

/** Pure reducer. Invalid events are skipped and recorded in `issues`. */
export function apply(prev: SimState, e: SimEvent, seq: number): SimState {
  const problem = check(prev, e);
  if (problem) return { ...prev, issues: [...prev.issues, { seq, message: problem }] };
  const s: SimState = structuredClone(prev);

  switch (e.type) {
    case "stage":
      s.stage = e.stage;
      break;
    case "collapse":
      s.collapsed = true;
      break;
    case "worksite-created":
      s.worksite = {
        team: e.team,
        siteNumber: e.siteNumber,
        hazards: e.hazard ? [{ text: e.hazard, seq }] : [],
        triage: e.triage,
        arrow: e.arrow,
        records: [{ team: e.team, level: 2, date: e.date, seq }],
        closed: null,
        deceasedOnly: false,
        seq,
      };
      break;
    case "deceased-only-closed":
      // 2027 S5: a building that holds only deceased is marked with ASR 5 and the line only.
      s.worksite = {
        team: e.team,
        siteNumber: e.siteNumber,
        hazards: [],
        triage: "D",
        arrow: false,
        records: [{ team: e.team, level: 5, date: e.date, seq }],
        closed: { seq },
        deceasedOnly: true,
        seq,
      };
      break;
    case "asr-completed":
      s.worksite!.records.push({ team: e.team, level: e.level, date: e.date, seq });
      break;
    case "hazard-added":
      s.worksite!.hazards.push({ text: e.text.trim(), seq });
      break;
    case "worksite-closed":
      s.worksite!.closed = { seq };
      break;
    case "victim-site":
      s.victims[e.site] = { site: e.site, arrow: e.arrow, lines: [], seq };
      break;
    case "victim-found": {
      const v = s.victims[e.site]!;
      const current = v.lines.find((l) => l.kind === e.kind && !l.struck);
      let total = e.count;
      if (current) {
        current.struck = true;
        current.struckSeq = seq;
        total += current.count;
      }
      v.lines.push({ kind: e.kind, count: total, struck: false, seq, struckSeq: null });
      break;
    }
    case "victim-removed": {
      const v = s.victims[e.site]!;
      const current = v.lines.find((l) => l.kind === e.kind && !l.struck)!;
      current.struck = true;
      current.struckSeq = seq;
      const left = current.count - e.count;
      // When nobody is left, the old line is only struck; no "L-0" is written.
      if (left > 0) v.lines.push({ kind: e.kind, count: left, struck: false, seq, struckSeq: null });
      break;
    }
    case "team-enter":
      s.teamsOnSite.push(e.team);
      break;
    case "team-exit":
      s.teamsOnSite = s.teamsOnSite.filter((t) => t !== e.team);
      break;
    case "rcm-enabled":
      s.rcmEnabled = true;
      break;
    case "rcm-marked":
      (s.rcm[e.object] ??= []).push({ symbol: e.symbol, team: e.team, date: e.date, seq });
      break;
  }
  return s;
}

export function replay(edition: Edition, events: SimEvent[], upTo = events.length): SimState {
  let s = initialState(edition);
  for (let i = 0; i < upTo; i++) s = apply(s, events[i]!, i);
  return s;
}

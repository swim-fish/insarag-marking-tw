import { markingDate, teamLabel } from "../model/format";
import { STAGES } from "../model/scenario";
import type { Edition, SimEvent } from "../model/types";

const KIND = { L: "生還者", D: "罹難者" } as const;

/** One-line zh-TW description of an event for the log. */
export function describe(e: SimEvent, ed: Edition): string {
  const team = (k: string) => teamLabel(k, ed);
  switch (e.type) {
    case "stage":
      return `▶ 階段：${STAGES.find((s) => s.id === e.stage)?.title ?? e.stage}`;
    case "collapse":
      return "建物倒塌";
    case "worksite-created":
      return `${team(e.team)} 完成 ASR 2，建立工作場址標記（危害：${e.hazard}；分流 ${e.triage}）`;
    case "deceased-only-closed":
      return `${team(e.team)} 確定建物僅有罹難者：只記錄 ASR 5 與完成線`;
    case "asr-completed":
      return `${team(e.team)} 完成 ASR ${e.level}（${markingDate(e.date)}），追加紀錄`;
    case "hazard-added":
      return `加註危害：${e.text}`;
    case "worksite-closed":
      return "畫完成線：不需再作業";
    case "victim-site":
      return `在 ${e.site} 位置畫 V（可能有受困者）`;
    case "victim-found":
      return `${e.site} 確認${KIND[e.kind]} ${e.count} 名`;
    case "victim-removed":
      return `${e.site} 移出${KIND[e.kind]} ${e.count} 名`;
    case "team-enter":
      return `${team(e.team)} 進入現場`;
    case "team-exit":
      return `${team(e.team)} 離開現場`;
    case "rcm-enabled":
      return "LEMA 決定啟用 RCM";
    case "rcm-marked":
      return `車輛標記 RCM 菱形 ${e.symbol}（${team(e.team)} ${markingDate(e.date)}）`;
  }
}

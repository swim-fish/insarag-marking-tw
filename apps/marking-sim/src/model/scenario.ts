import { activeCount } from "./reducer";
import type { SimEvent, SimState, StageId } from "./types";

export const DAY1 = "2026-10-05";
export const DAY2 = "2026-10-06";
export const SITE_NUMBER = 5;

export type Focus = "overview" | "worksite" | "V1" | "V2" | "car";

export interface Stage {
  id: StageId;
  title: string;
  lead: string;
  focus: Focus;
  /** Rule reminders shown with the stage. */
  notes: string[];
  /** Items that changed in the 2027 edition (shown in blue). */
  changed2027?: string[];
  refs: string;
  build: (s: SimState) => SimEvent[];
}

function removeAll(s: SimState): SimEvent[] {
  const out: SimEvent[] = [];
  for (const v of Object.values(s.victims)) {
    for (const kind of ["L", "D"] as const) {
      const n = activeCount(v, kind);
      if (n > 0) out.push({ type: "victim-removed", site: v.site, kind, count: n });
    }
  }
  return out;
}

export const STAGES: Stage[] = [
  {
    id: "incident",
    title: "案發",
    lead: "建物倒塌。尚未評估，現場沒有任何標記。",
    focus: "overview",
    notes: ["採用的標記制度由 LEMA 與 UCC 協調；無國家制度時，採用 INSARAG 標記。"],
    refs: "手冊 p.1；S5 Marking System",
    build: () => [{ type: "stage", stage: "incident" }, { type: "collapse" }],
  },
  {
    id: "discovery",
    title: "發現",
    lead: "AAA01 完成 ASR 2 場址分流評估，確認為工作場址，在入口外側建立標記。",
    focus: "worksite",
    notes: [
      "順序：先寫場址編號 → 同框記錄隊伍、已完成的 ASR 等級與日期 → 沿文字畫框 → 框上寫危害 → 框下寫分流類別。",
      "分流 C：可能有生還者（旁人通報有人失聯），尚未確認。",
      "箭頭指出場址入口的實際位置（選用）。",
    ],
    changed2027: ["場址編號＝建立場址的隊伍編號＋4 位數；分區代碼由 ICMS 附加，不寫在標記上。"],
    refs: "手冊 p.2、p.4；S5 Worksite Triage Marking；S6；S7",
    build: () => [
      { type: "stage", stage: "discovery" },
      { type: "team-enter", team: "t1" },
      {
        type: "worksite-created",
        team: "t1",
        date: DAY1,
        hazard: "瓦斯洩漏",
        triage: "C",
        siteNumber: SITE_NUMBER,
        arrow: true,
      },
      { type: "team-exit", team: "t1" },
    ],
  },
  {
    id: "search-start",
    title: "開始搜索",
    lead: "BBB01 受派執行 ASR 3 快速搜索救援。搜索發現可能的受困位置，在最接近的表面畫 V。",
    focus: "V1",
    notes: [
      "單獨的 V 表示可能有受困者，不表示已確認生還者。",
      "V 約 50 cm 高，畫在最接近受困者實際位置的表面；需要時加箭頭。",
      "受困者不在工作場址方框處時，不在方框旁畫 V。",
    ],
    refs: "手冊 p.5；S5 Victim Marking",
    build: () => [
      { type: "stage", stage: "search-start" },
      { type: "team-enter", team: "t2" },
      { type: "victim-site", site: "V1", arrow: true },
    ],
  },
  {
    id: "status-update",
    title: "更新狀態",
    lead: "確認 V1 位置有 2 名生還者、1 名罹難者，在 V 下方記錄人數。",
    focus: "V1",
    notes: [
      "L＝生還者，D＝罹難者；數字是仍在原位置的人數，兩種紀錄可並存。",
      "工作場址方框下的分流類別維持 ASR 2 的判定。官方手冊沒有規定改寫方式，官方漸進範例也沒有改寫；新資訊以 Worksite Report 經 ICMS 回報。",
    ],
    refs: "手冊 p.5；S5 Victim Marking、Progressive Examples",
    build: () => [
      { type: "stage", stage: "status-update" },
      { type: "victim-found", site: "V1", kind: "L", count: 2 },
      { type: "victim-found", site: "V1", kind: "D", count: 1 },
    ],
  },
  {
    id: "phase-complete",
    title: "階段完畢",
    lead: "BBB01 救出 1 名生還者並完成 ASR 3，在方框內追加作業紀錄。",
    focus: "worksite",
    notes: [
      "移出受困者後，劃除舊人數，在下方寫剩餘人數。",
      "追加隊伍編號、已完成的 ASR 等級及日期；保留先前的紀錄。",
      "ASR 3 完成不能單獨作為結案依據。",
    ],
    refs: "手冊 p.3、p.5；S5",
    build: (s) => {
      const out: SimEvent[] = [{ type: "stage", stage: "phase-complete" }];
      const v1 = s.victims.V1;
      if (v1 && activeCount(v1, "L") > 0) out.push({ type: "victim-removed", site: "V1", kind: "L", count: 1 });
      out.push({ type: "asr-completed", team: "t2", level: 3, date: DAY1 }, { type: "team-exit", team: "t2" });
      return out;
    },
  },
  {
    id: "search-again",
    title: "再次搜索",
    lead: "CCC01 受派執行 ASR 4 完整搜索救援，移出其餘的生還者與罹難者。",
    focus: "V1",
    notes: [
      "所有已知受困者移出後，劃除全部有效的 L／D 紀錄。",
      "保留 V 與劃除痕跡，不改畫成 RCM 菱形。",
      "已知受困者全移出，不表示整棟建物已完成搜索。",
    ],
    refs: "手冊 p.5；S5 Victim Marking",
    build: (s) => [{ type: "stage", stage: "search-again" }, { type: "team-enter", team: "t3" }, ...removeAll(s)],
  },
  {
    id: "complete",
    title: "完成",
    lead: "CCC01 完成 ASR 4，判定不需再作業，畫完成線。",
    focus: "worksite",
    notes: [
      "所有必要工作完成，且確認不需再作業時，才畫完成線。",
      "完成線不代表危害消失，也不代表結構安全。",
    ],
    changed2027: ["完成線畫在場址編號下方、ASR 紀錄上方，橫越整個標記。"],
    refs: "手冊 p.3；S5 Marking Method",
    build: () => [
      { type: "stage", stage: "complete" },
      { type: "asr-completed", team: "t3", level: 4, date: DAY2 },
      { type: "worksite-closed", date: DAY2 },
      { type: "team-exit", team: "t3" },
    ],
  },
];

export function stageIndex(id: StageId | null): number {
  return id ? STAGES.findIndex((s) => s.id === id) : -1;
}

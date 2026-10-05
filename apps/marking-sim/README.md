# INSARAG Marking Simulator

Interactive three.js scene that shows how INSARAG worksite, victim and RCM markings are drawn and
updated as a collapsed-structure incident progresses. Rules follow [`docs/insarag`](../../docs/insarag/README.md):
the A5 handbook (2027 edition, default) and the 2020 reference notes (toggle).

Teaching tool only. Teams, counts and dates are illustrative; it is not an official INSARAG product.

## Run

```bash
bun install
bun run dev        # http://localhost:3000 (Bun HTML dev server, hot reload)
bun test           # model and layout rules
bun run typecheck
bun run build      # static output in dist/
```

## Stages

| # | Stage | Marking change | Handbook |
|---|---|---|---|
| 1 | 案發 Incident | Building collapses; no markings | p.1 |
| 2 | 發現 Discovery (ASR 2) | Worksite box: ID → team/ASR 2/date → box → hazard (top) → triage `C` (bottom) → arrow | p.2, p.4 |
| 3 | 開始搜索 Search start (ASR 3) | `V` + arrow on the surface nearest the victims | p.5 |
| 4 | 更新狀態 Status update | `L-2`, `D-1` under the V | p.5 |
| 5 | 階段完畢 Phase complete | `L-2` struck, `L-1` written; `BBB01 ASR 3` appended | p.3, p.5 |
| 6 | 再次搜索 Search again (ASR 4) | All live L/D lines struck; V kept | p.5 |
| 7 | 完成 Complete | `CCC01 ASR 4` appended; completion line below the ID, above the ASR records | p.3 |

Free actions: add/remove live or deceased victims at V1/V2, append ASR records, add hazards, draw the
completion line, the 2027 "deceased only" marking (ASR 5 + line), and RCM C/D on a vehicle once LEMA enables it.
Rule violations (e.g. completion line while victims remain) are rejected with an explanation.

### Triage category is not rewritten

Neither S5 (2027) nor S1 (2020) defines how to change the triage category on the marking after ASR 2,
and the official progressive examples keep the original category. The simulator therefore keeps the ASR 2
category; new victim information belongs in the Worksite Report via ICMS.

## Architecture

```
src/model/    events, pure reducer + rule checks, 7-stage scenario, ID/date formats
src/marking/  state -> ordered drawing ops (5 px = 1 cm), animated canvas painter
src/scene/    three.js world: collapse animation, decal surfaces, teams, victim indicators, camera
src/ui/       zh-TW event descriptions
src/main.ts   event log as single source of truth; timeline rewinds by replaying events
```

The same canvas is used as the 3D decal texture and the 2D close-up in the side panel.

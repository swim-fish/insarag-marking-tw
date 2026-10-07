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
| 2 | 發現 Discovery (ASR 2) | Worksite box: ID → team/ASR 2/date → box with 3 reserved rows for ASR 3–5 (dashed guides, not paint) → hazard (top) → triage `C` (bottom) → arrow | p.2, p.4 |
| 3 | 開始搜索 Search start (ASR 3) | Interior view: `V` + arrow on the cross wall of the standing storey, in front of the void | p.5 |
| 4 | 更新狀態 Status update | `L-3`, `D-1` under the V | p.5 |
| 5 | 陸續移出 Extraction | Survivors carried out one at a time through the breach; `L-3` → `L-2` → `L-1`, each old count struck | p.5 |
| 6 | 階段完畢 Phase complete | `BBB01 ASR 3` written in the first reserved row; the box is not redrawn | p.3 |
| 7 | 再次搜索 Search again (ASR 4) | Remaining `L-1`, `D-1` carried out and struck; V kept | p.5 |
| 8 | 完成 Complete | `CCC01 ASR 4` appended; completion line below the ID, above the ASR records | p.3 |

Free actions: add/remove live or deceased victims at V1/V2, append ASR records, add hazards, draw the
completion line, the 2027 "deceased only" marking (ASR 5 + line), and RCM C/D on a vehicle once LEMA enables it.
Rule violations (e.g. completion line while victims remain) are rejected with an explanation.

### Reserved rows and successive removals

The handbook (p.2 caution) asks for blank rows inside the box for ASR levels not yet completed, because later
levels may be done by other teams. A row is added only when an ASR level is completed, not when crews rotate.
The box is sized at ASR 2 for ASR 3–5 and later records fill it; the dashed guides are a teaching overlay.

Each `victim-removed` event is shown as its own step: a stretcher comes out of the breach, then the old count is
struck and the remaining count written below. Removed casualties gather at the casualty collection point.

### Triage category is not rewritten

Neither S5 (2027) nor S1 (2020) defines how to change the triage category on the marking after ASR 2,
and the official progressive examples keep the original category. The simulator therefore keeps the ASR 2
category; new victim information belongs in the Worksite Report via ICMS.

## Architecture

```
src/model/    events, pure reducer + rule checks, 8-stage scenario, ID/date formats
src/marking/  state -> ordered drawing ops (5 px = 1 cm), animated canvas painter
src/scene/    three.js world: collapse animation, interior cross wall, decal surfaces, teams, stretcher carries,
              casualty collection point, victim indicators, camera
src/ui/       zh-TW event descriptions
src/main.ts   event log as single source of truth; timeline rewinds by replaying events
```

The same canvas is used as the 3D decal texture and the 2D close-up in the side panel.

### Scene assets

`src/scene/assets.ts` builds local procedural models with shared materials and primitive geometry.
Decorative meshes are merged by material to reduce draw calls, while limbs and collapse pieces remain
separate for animation. Buildings have raised window frames, balconies, air conditioners, rooftop
equipment and textured concrete; vehicles have sloped glazing, panel seams, lights and detailed wheels.
The street includes a rescue truck, cones, tool cases, timber cribbing and a portable floodlight.

Rescuers follow the supplied Taiwan National Fire Agency special search and rescue uniform photo:
golden-orange suits, red shoulders, pale-yellow helmets, headlamps, eye and respiratory protection,
reflective strips, knee pads, harnesses and black packs. Team colors appear on upper-arm bands.
Walking and carrying use the same uniform model with separate limb poses. Generated team and carry
geometry is released when removed; shared geometry and materials stay cached.

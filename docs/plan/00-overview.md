# EU-Tort-3: Team Plan Overview

**EU-Tort-3** is "Europe (Tortoise)", an AWS region that isn't on the status page. The name, concept, and visual theme (dark console backdrop, faint grid, AWS orange) are now baked into the kit itself; this plan is how our three-person team builds the actual game in 5 hours.

## The pitch

A tower defence game where **AWS services are the towers** and **tortoise-themed intruders are infrastructure attacks**. Each tower thematically counters the attack it defeats. The **origin server** stands at the end of the path; the tortoises are marching on it, and if enough of them get through, the region goes down (the GameOver screen already says it: **REGION DOWN**).

MVP is deliberately narrow: **one tower vs one attack**, i.e. **AWS Shield** vs a **DDoS swarm** of small, fast, weak tortoises arriving in bursts. Every stat lives in a data-driven config, so tower/enemy #2 (e.g. WAF vs SQLi tortoise, GuardDuty vs cryptominer tortoise) is a ~10-line diff plus a texture. That's the demo pitch as much as the architecture: "adding a new AWS service is a config entry".

## Scope

**In (MVP):**

- Fixed S-shaped path across the 1024x768 canvas; the origin server at the end
- Waves of DDoS tortoises spawn and walk the path; leaking one costs region HP
- Buy AWS Shield towers with money earned from kills; place on fixed build slots
- 5 waves, win/lose states, restartable
- HUD: HP / money / wave counter, one shop button, wave banner

**Out (cut without discussion if time pressure hits):**

- Tower upgrades, selling, multiple maps, pathfinding, tilemaps, saving, mobile input

**Stretch (pitch-only unless we're ahead at T+3:50):** multi-region = multiple simultaneous maps, and the naming writes itself (`us-tort-1`, `ap-snapper-2`...). The orchestrator + manager pattern makes a second map a second manager set with an x-offset; events would need a `regionId` field. Do not build for this speculatively.

## Team and streams

Three streams with **disjoint file ownership** after the contracts commit; this is how we avoid merge conflicts, not branching. Full per-stream briefs:

| Stream | Doc | Owns |
|---|---|---|
| **A: Core engine** | [02-stream-core.md](./02-stream-core.md) | `scenes/Game.ts` (orchestrator), `td/GameState.ts`, `td/WaveManager.ts`, `td/configs/waves.ts`, `td/map.ts` |
| **B: Entities & combat** | [03-stream-entities.md](./03-stream-entities.md) | `td/entities/{Enemy,Tower,Projectile}.ts`, `td/configs/{towers,enemies}.ts` |
| **C: UI/UX** | [04-stream-ui.md](./04-stream-ui.md) | `scenes/HUD.ts` (new), `td/ui/Placement.ts`, `scenes/{MainMenu,GameOver,Preloader}.ts`, `public/` assets |

Shared, written together, then **frozen**: `td/types.ts`, `td/events.ts` (see [01-contracts.md](./01-contracts.md)). `src/game/main.ts` gets exactly one edit (registering the HUD scene) during the contracts phase. Changing a frozen file after T+0:45 requires announcing it out loud and everyone pulling immediately.

Streams never import each other's classes. Everything crosses stream boundaries through `types.ts` interfaces and `events.ts` bus events; the only exception is the `IEnemy[]` array Game.ts passes into `tower.update()`.

## Design decisions (and why)

We picked the lowest-API-surface option everywhere. Most of us have Phaser 3 instincts at best (or none), and Claude's training data skews Phaser 3; small hand-rolled code beats fighting a framework API for 5 hours. The `.claude/skills/` packs are the tiebreaker when we do need real Phaser API.

| Decision | Choice | Why |
|---|---|---|
| Path following | **Manual waypoint stepping** in `Enemy.preUpdate` (~15 lines) | `Phaser.Curves.Path` + followers is tween-based: speed is coupled to tween duration, and "how far along is this enemy" (needed for targeting) is buried in tween state. Manual stepping gives us `pathProgress` for free |
| Targeting | **Distance² checks** over a plain enemies array; target = furthest along the path in range | ≤50 enemies x ≤15 towers per frame is trivially cheap. Arcade physics overlap needs bodies, groups, and circular-body fiddling for zero benefit here |
| Projectiles | **Homing point-mover**: move toward target each frame, hit within 12px, guaranteed | Projectiles that can miss are the classic jam time sink (tunneling, overshoot, balance chaos). Guaranteed hits keep balance math simple |
| Grid / map | **Hand-placed `GridSlot[]` array** + Graphics outlines; no tilemap | A tilemap means Tiled tooling, tilesets, and layer APIs for one static map. Wrong tool at 5 hours. Bonus: the kit already draws a 64px grid backdrop that our slots snap onto |
| Art | **`generateTexture` placeholder shapes** first (hexagon tower, circle tortoise, dot projectile, rect server); real art only in the polish phase, same texture keys | The kit ships zero character art on purpose; placeholders make us playable at T+1 with no asset work, and swaps later are Preloader-only changes. The existing `sparkle` texture in `Preloader.create()` shows the exact pattern |
| HUD | **Separate Phaser scene** launched in parallel over Game | The single biggest conflict eliminator: Stream C never opens `Game.ts`. The camera never scrolls, so HUD coordinates == world coordinates and placement can live entirely in Stream C |
| Cross-stream comms | **Module-singleton event bus** (`Phaser.Events.EventEmitter`) with typed event names/payloads | Streams stay decoupled; payload drift is a typecheck error, not a runtime mystery |
| State mutation | **Single validation point**: only Game.ts/GameState mutate money/HP; UI emits requests | Prevents the classic double-spend and desync bugs |

## Timeline (T+0 to T+5)

| Time | What |
|---|---|
| **T+0:00–0:20 Setup** | One of us forks the kit repo on GitHub; ⚠️ everyone runs `git remote set-url origin <fork-url>` (fresh clones point at the upstream kit repo). `npm install`, `npm run dev`, confirm the stub scenes run (menu → START → grid → ENTER → REGION DOWN), `npm run typecheck` clean |
| **T+0:20–0:45 Contracts (mob, one machine)** | Type in [01-contracts.md](./01-contracts.md) verbatim: `types.ts`, `events.ts`, `map.ts`, first-guess configs, stub files for every module (so all imports resolve), placeholder textures in Preloader, HUD registered in `main.ts`. Typecheck. **Commit "contracts" and everyone pulls; this is the fan-out point. Interfaces frozen** |
| **T+0:45–2:00 Sprint 1 (parallel)** | Each stream builds its core against the contracts, self-testing with the stubs listed in its brief (B spawns enemies from a keypress; C fakes a `state-changed` emit; A fakes a spawner) |
| **T+2:00–2:20 Checkpoint 1 (all)** | Push, pull, wire up, delete stubs. **Goal: a tower bought through the UI kills tortoises walking the path, and HUD money/HP move.** Dev A is integration lead and may hot-patch across ownership lines during checkpoints only |
| **T+2:20–3:30 Sprint 2 (parallel)** | A: full 5-wave progression + win/lose. B: death/hit feedback, leak feedback. C: GameOver win variant, wave banner, rejection toast, MainMenu copy |
| **T+3:30–3:50 Checkpoint 2 (all)** | Full playthrough of BOTH outcomes, then **restart and play a second run** (this is where singleton-bus duplicate-listener bugs surface; test now, not at T+4:55). Cut-line decision per the risk table below |
| **T+3:50–4:30 Balance & juice** | Configs are single-owner so tuning parallelizes: A tunes waves, B tunes tower/enemy stats, C swaps art and adds sound/shake. Cheap win if ahead: a second tower type; it proves the data-driven pitch |
| **T+4:30–5:00 Freeze & demo prep** | Crash fixes only. Two clean-pull playthroughs, set starting money for a satisfying demo build-out, rehearse the 60-second pitch, decide who drives |

## Git workflow

**Trunk-based; all three commit straight to `main` on the fork.** No feature branches; conflicts are prevented by file ownership. Rules:

- `git pull --rebase` before every push; push every 20–30 minutes, working or not
- `npm run typecheck` **before every push** (hard rule from `CLAUDE.md`; Vite hides TS errors in dev, and one broken push blocks all three of us)
- A red typecheck on `main` is a drop-everything fix
- Announce out loud before touching any shared/frozen file

## Risks and fallbacks

1. **Integration seams don't line up at T+2:00** (payload mismatch, factory drift). Mitigation: contracts are typed and frozen, so drift fails typecheck. Fallback: Dev A hot-patches at the checkpoint; whichever side of a missing event exists first stubs the other side.
2. **A stream rat-holes on a Phaser API fight** (most likely placement input/hover, or Phaser 3 habits vs Phaser 4 reality). Mitigation: the low-API design choices above; lean on `.claude/skills/` packs rather than memory or web docs. Fallbacks: placement degrades to "click any empty slot buys a Shield" with no ghost; the path degrades to a straight line with 2 bends; art stays placeholder shapes. Judges forgive rectangles; they don't forgive a broken loop.
3. **Second-run bugs from the singleton bus** (double listeners = double bounty, ghost HUD text). Mitigation: every scene detaches its `bus` listeners on `shutdown` (written into the contracts doc), and checkpoint 2 explicitly tests a second run. Nuclear fallback: "try again" does `window.location.reload()`; inelegant, invisible in a demo.
4. **Wave-clear edge cases** (last enemy leaks vs dies, spawn timer still scheduled). Mitigation: WaveManager counts `spawned` vs `resolved` (killed + leaked) per wave; one counter pair, no display-list scanning.

## Look and feel

Stick to the kit's palette so everything reads as one game: background `0x0b1120`, grid `0x1c2a3a`, accent orange `0xff9900`, text `#e6edf3` / muted `#8ea3b8`. The MainMenu, Preloader, and GameOver scenes already use it; HUD and entity placeholders should too (tortoises get a contrasting colour, e.g. green, so threats pop against the console theme).

## Doc index

1. [01-contracts.md](./01-contracts.md): the frozen shared contracts; paste-ready TypeScript, written together at T+0:20
2. [02-stream-core.md](./02-stream-core.md): Dev A, core engine
3. [03-stream-entities.md](./03-stream-entities.md): Dev B, entities & combat
4. [04-stream-ui.md](./04-stream-ui.md): Dev C, UI/UX

Also read the repo's [`CLAUDE.md`](../../CLAUDE.md) (project layout, asset loading, house rules) before starting; it's short. The root [`initial-plan.md`](../../initial-plan.md) is the early sketch this plan grew out of; where they disagree, `docs/plan/` wins.

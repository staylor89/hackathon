# EU-Tort-3 — Write hackathon plan docs into the repo

## Context

Hackathon project shared between 3 team members, starting from `/Users/mattlaw/code/hackathon/hackathon` — the jam kit: a working Phaser 4.0 + TypeScript 5.7 + Vite 6.3 game (fork of `phaserjs/template-vite-ts`) with scenes `Boot → Preloader → MainMenu → Game → GameOver` and 26 Phaser skill packs in `.claude/skills/`.

Concept (agreed with user): **EU-Tort-3** — "Europe (Tortoise)", an AWS region that isn't on the status page. Tower defence where **AWS services are towers** and **tortoise-themed intruders are infrastructure attacks**. MVP = one tower (**AWS Shield**) vs one attack (**DDoS tortoise swarm**), data-driven so more pairs are trivial. The **origin server** is the base at the end of the path. Work splits **by subsystem** into 3 parallel streams for a **5-hour** jam. Stretch: multi-region = multiple maps.

**User's instruction:** write all the plans into the repo, as detailed as possible, so they can be shared with the other 2 team members. So the deliverable of this task is **planning documentation committed to the repo** — no game code yet.

## Files to create (all new, in the hackathon repo)

Create `docs/plan/` in `/Users/mattlaw/code/hackathon/hackathon/`:

1. **`docs/plan/00-overview.md`** — game concept + theming (origin server = base), MVP scope, the 3-stream split at a glance, design-decision table with rationale (manual waypoint steering over `Curves.Path`; distance² targeting over arcade overlap; homing point-mover projectiles with guaranteed hit; `generateTexture` placeholder art first; hand-placed `GridSlot[]` over tilemaps; HUD as a parallel scene; module-singleton event bus), hour-by-hour timeline with the two integration checkpoints (T+2:00, T+3:30) and T+4:30 freeze, git workflow (trunk-based on the fork, pull-rebase before push, typecheck before every push, fork + `git remote set-url` as step zero), risk list with fallbacks, stretch-goal note.

2. **`docs/plan/01-contracts.md`** — the frozen shared contracts, verbatim TypeScript ready to paste at T+0:20:
   - `src/game/td/types.ts`: `TowerType`/`EnemyType`, `TowerConfig`, `EnemyConfig`, `WaveEntry`/`WaveConfig`, `Point`/`GridSlot`/`MapDef`, cross-stream entity views `IEnemy`/`ITower`, factory signatures `SpawnEnemyFn`/`CreateTowerFn`.
   - `src/game/td/events.ts`: `bus` singleton + `Ev` event-name map with payload shapes (`enemy-killed`, `enemy-leaked`, `wave-started`, `wave-cleared`, `state-changed`, `game-won`, `game-lost`, `ui-place-tower`, `tower-placed`, `placement-rejected`) and the listener-cleanup-on-shutdown rule.
   - `src/game/td/map.ts` shape: S-path waypoints + 10–14 hand-placed slots + base at ~(950, 384).
   - The two canonical flows: placement (HUD → `ui-place-tower` → Game validates money/occupancy → `createTower` → `tower-placed`; single validation point) and kill (projectile → `takeDamage` → `enemy-killed` → GameState bounty → `state-changed` → HUD).
   - First-guess config values: shield `{cost 50, range 140, fireRateMs 400, damage 10}`, ddos tortoise `{maxHp 20, speed 90, bounty 5, hpDamage 1}`, 5 waves with rising count / falling interval, start money ~120, base HP 20.
   - Contract-phase checklist: create all stub files so imports resolve, register HUD scene in `main.ts` (once), add placeholder textures to `Preloader.ts`, typecheck, commit "contracts" — the fan-out point; interfaces frozen after.

3. **`docs/plan/02-stream-core.md`** (Dev A) — rewrite `scenes/Game.ts` as orchestrator (draw path/slots, launch HUD, own `enemies[]`/`towers[]`, update fan-out, `ui-place-tower` validation, GameOver transitions); `td/GameState.ts` (hp/money/wave, event reactions, emits `state-changed`/`game-won`/`game-lost`); `td/WaveManager.ts` (spawn scheduling via `scene.time.addEvent`, wave-clear via spawned-vs-resolved counters); `td/configs/waves.ts`. Includes what to stub while waiting on other streams, sprint-1 vs sprint-2 task breakdown, integration-lead role at checkpoints, and relevant skill packs.

4. **`docs/plan/03-stream-entities.md`** (Dev B) — `td/entities/Enemy.ts` (Sprite subclass, manual waypoint stepping in `preUpdate`, `pathProgress`, `takeDamage`/die/leak + events), `td/entities/Tower.ts` (cooldown, distance² targeting, target = max `pathProgress` in range), `td/entities/Projectile.ts` (homing dot, hit within 12px, self-destroy if target dies), `td/configs/towers.ts` + `td/configs/enemies.ts` registries; keypress test-spawn stub; sprint-2 polish (death flash, sparkle particle burst, leak feedback); skill packs.

5. **`docs/plan/04-stream-ui.md`** (Dev C) — new `scenes/HUD.ts` parallel scene (launched from Game; camera fixed so HUD coords == world coords), `td/ui/Placement.ts` (shop button, ghost highlight over slots, `ui-place-tower` emit, rejection toast, unaffordable greying), MainMenu/GameOver retheming (win = region healthy, loss = "REGION DOWN"), `Preloader.ts` ownership (placeholder `generateTexture` → real art swaps keep the same keys), sound in the polish phase; placement-UX fallback (drop ghost, click-slot-buys); skill packs.

6. **Edit `README.md`** (repo root) — add a short "Our team's plan" section near the top linking to `docs/plan/`, with the game name and one-paragraph pitch. Keep the existing kit content intact.

Content for these docs comes from the two design passes already completed (full detail is in this conversation): file-ownership table where every file is single-owner after T+0:45, the only shared moments being the contracts commit and checkpoint wire-ins.

## Key structural decisions the docs encode

- All new game code under `src/game/td/` (+ `scenes/HUD.ts`); ownership disjoint per stream after the contracts commit.
- Streams communicate only via `types.ts` + `events.ts` (frozen at T+0:45; changes require announcing + immediate pull by everyone).
- HUD as a parallel Phaser scene is the biggest merge-conflict eliminator — Stream C never edits `Game.ts`.
- Lowest-API-surface Phaser choices throughout (manual waypoints, distance checks, Graphics placeholders) to minimize Phaser-3-instinct/Phaser-4-reality bugs; lean on `.claude/skills/` packs.
- Restart hygiene: bus listeners detached on scene `shutdown`; second-run test at T+3:30; `window.location.reload()` as nuclear fallback.

## Verification

- Docs render cleanly (plain GFM, no broken links between the plan files and to repo paths).
- `README.md` edit preserves all existing kit instructions.
- No changes under `src/` — this task is documentation only; game code starts at the jam.
- Optionally commit the docs on `main` (repo is a git clone; remote currently points at upstream `staylor89/hackathon` — do NOT push; committing locally is fine, sharing happens after the fork is set up, or user pushes once the remote is re-pointed). Ask user before any push.

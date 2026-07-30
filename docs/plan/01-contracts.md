# 01: The Shared Contracts

Written together (mob on one machine, ideally Dev A's) at **T+0:20–0:45**, committed as a single "contracts" commit, then **frozen**. Any change after that requires announcing it out loud and everyone pulling immediately; additive changes (a new optional field, a new event) are fine, reshaping an existing payload is not.

Everything below is paste-ready. All new code lives under `src/game/td/` so the kit's scene files stay untouched until their owners rework them.

## `src/game/td/types.ts`

```ts
export type TowerType = 'shield';            // later: 'waf' | 'guardduty' | ...
export type EnemyType = 'ddos';              // later: 'sqli' | 'ransomware' | ...

export interface TowerConfig {
    type: TowerType;
    name: string;                 // 'AWS Shield'
    textureKey: string;           // 'tower-shield'
    cost: number;                 // 50
    range: number;                // px, e.g. 140
    fireRateMs: number;           // ms between shots, e.g. 400
    damage: number;               // 10
    projectileSpeed: number;      // px/s, e.g. 500
    projectileTextureKey: string; // 'projectile-shield'
}

export interface EnemyConfig {
    type: EnemyType;
    name: string;                 // 'DDoS Tortoise'
    textureKey: string;           // 'enemy-ddos'
    maxHp: number;                // 20 (weak; swarm feel comes from count, not HP)
    speed: number;                // px/s, e.g. 90 (fast, for a tortoise)
    bounty: number;               // 5 (money on kill)
    hpDamage: number;             // 1 (region HP lost on leak)
}

export interface WaveEntry {
    enemyType: EnemyType;
    count: number;                // 12
    spawnIntervalMs: number;      // 350 (burst feel)
    delayMs?: number;             // pause before this entry starts
}
export interface WaveConfig { entries: WaveEntry[]; }

export interface Point { x: number; y: number; }
export interface GridSlot { id: number; x: number; y: number; }   // centre, world px
export interface MapDef {
    waypoints: Point[];           // enemy path; last point = the origin server
    slots: GridSlot[];            // buildable positions flanking the path
    base: Point;                  // where the origin server stands
    slotSize: number;             // 64 (matches the kit's background grid)
}

// Minimal cross-stream entity views. Streams code against these, never
// against each other's classes.
export interface IEnemy {
    readonly cfg: EnemyConfig;
    readonly x: number;
    readonly y: number;
    readonly active: boolean;     // false once dead or leaked
    hp: number;
    pathProgress: number;         // 0..1; used for "furthest along" targeting
    takeDamage(amount: number): void;
}
export interface ITower {
    readonly cfg: TowerConfig;
    readonly slotId: number;
    update(timeMs: number, dtMs: number, enemies: readonly IEnemy[]): void;
    destroy(): void;
}

// Factory signatures: implemented by Stream B, called by Stream A.
export type SpawnEnemyFn = (scene: Phaser.Scene, cfg: EnemyConfig, waypoints: Point[]) => IEnemy;
export type CreateTowerFn = (scene: Phaser.Scene, cfg: TowerConfig, slot: GridSlot) => ITower;
```

## `src/game/td/events.ts`

```ts
import { Events } from 'phaser';
import type { EnemyType, TowerType } from './types';

// Module-singleton bus. It outlives scenes, which means every scene MUST
// detach its own listeners on shutdown or a restarted game gets duplicate
// handlers (double bounty, ghost HUD text):
//
//   this.events.once('shutdown', () => {
//       bus.off(Ev.StateChanged, this.onState, this);
//       // ...every listener this scene added
//   });
export const bus = new Events.EventEmitter();

export const Ev = {
    // entities -> world (Stream B emits, A consumes)
    EnemyKilled:   'enemy-killed',
    EnemyLeaked:   'enemy-leaked',
    // engine -> UI (Stream A emits, C consumes)
    WaveStarted:   'wave-started',
    WaveCleared:   'wave-cleared',
    StateChanged:  'state-changed',
    GameWon:       'game-won',
    GameLost:      'game-lost',
    // UI -> engine (Stream C emits, A consumes)
    PlaceTower:    'ui-place-tower',
    // engine -> UI (placement outcome; A emits, C consumes)
    TowerPlaced:   'tower-placed',
    PlaceRejected: 'placement-rejected',
} as const;

// Payload shapes. Both emitter and listener import these; payload drift is
// a typecheck error, not a runtime mystery.
export interface EnemyKilledPayload  { type: EnemyType; bounty: number; x: number; y: number; }
export interface EnemyLeakedPayload  { type: EnemyType; hpDamage: number; }
export interface WaveStartedPayload  { wave: number; totalWaves: number; }
export interface WaveClearedPayload  { wave: number; }
export interface StateChangedPayload { hp: number; money: number; wave: number; totalWaves: number; }
export interface GameResultPayload   { wavesSurvived: number; }
export interface PlaceTowerPayload   { slotId: number; towerType: TowerType; }
export interface TowerPlacedPayload  { slotId: number; towerType: TowerType; cost: number; }
export interface PlaceRejectedPayload { slotId: number; reason: 'no-money' | 'occupied'; }
```

## `src/game/td/map.ts`

Owned by Stream A after the contracts commit, but written now so B and C have real coordinates. The numbers below are a first guess at an S-path on the 1024x768 canvas, aligned to the kit's 64px background grid; **Stream A's first job in sprint 1 is to draw the path and slots and eyeball them**, then adjust these constants (nobody else needs to care; everything reads from `MAP`).

```ts
import type { MapDef } from './types';

export const MAP: MapDef = {
    slotSize: 64,
    // Enter off the left edge, three bends, end at the origin server.
    waypoints: [
        { x: -32, y: 128 },
        { x: 704, y: 128 },
        { x: 704, y: 320 },
        { x: 192, y: 320 },
        { x: 192, y: 544 },
        { x: 832, y: 544 },
        { x: 832, y: 384 },
        { x: 950, y: 384 },
    ],
    base: { x: 950, y: 384 },
    // 12 hand-placed build slots flanking the path.
    slots: [
        { id: 0,  x: 256, y: 208 },
        { id: 1,  x: 384, y: 208 },
        { id: 2,  x: 512, y: 208 },
        { id: 3,  x: 640, y: 208 },
        { id: 4,  x: 288, y: 432 },
        { id: 5,  x: 416, y: 432 },
        { id: 6,  x: 544, y: 432 },
        { id: 7,  x: 672, y: 432 },
        { id: 8,  x: 896, y: 480 },
        { id: 9,  x: 736, y: 656 },
        { id: 10, x: 608, y: 656 },
        { id: 11, x: 896, y: 256 },
    ],
};
```

## First-guess configs

These live in stream-owned files but we agree the starting numbers now. Balance target: wave 1 comfortable with 2 towers, wave 5 needs ~6 well-placed towers.

```ts
// src/game/td/configs/towers.ts        [owned by Stream B]
import type { TowerConfig, TowerType } from '../types';

export const TOWERS: Record<TowerType, TowerConfig> = {
    shield: {
        type: 'shield', name: 'AWS Shield',
        textureKey: 'tower-shield', projectileTextureKey: 'projectile-shield',
        cost: 50, range: 140, fireRateMs: 400, damage: 10, projectileSpeed: 500,
    },
};
```

```ts
// src/game/td/configs/enemies.ts       [owned by Stream B]
import type { EnemyConfig, EnemyType } from '../types';

export const ENEMIES: Record<EnemyType, EnemyConfig> = {
    ddos: {
        type: 'ddos', name: 'DDoS Tortoise', textureKey: 'enemy-ddos',
        maxHp: 20, speed: 90, bounty: 5, hpDamage: 1,
    },
};
```

```ts
// src/game/td/configs/waves.ts         [owned by Stream A]
import type { WaveConfig } from '../types';

// Swarm feel = rising count + falling interval, NOT rising HP.
export const WAVES: WaveConfig[] = [
    { entries: [{ enemyType: 'ddos', count: 8,  spawnIntervalMs: 600 }] },
    { entries: [{ enemyType: 'ddos', count: 14, spawnIntervalMs: 500 }] },
    { entries: [{ enemyType: 'ddos', count: 20, spawnIntervalMs: 420 }] },
    { entries: [{ enemyType: 'ddos', count: 28, spawnIntervalMs: 340 }] },
    { entries: [{ enemyType: 'ddos', count: 40, spawnIntervalMs: 260 }] },
];
```

Economy start values (live in `GameState.ts`, Stream A): **region HP 20, starting money 120** (two towers up front, with change).

## The two canonical flows

Memorize these; they define who owns what.

**Placement** (single validation point, UI never mutates state):

1. HUD shop button selected, player clicks slot → C emits `Ev.PlaceTower { slotId, towerType }`
2. Game.ts validates: money (via GameState) and slot occupancy (its own `Map<slotId, ITower>`)
3. Valid → calls Stream B's `createTower(...)`, emits `Ev.TowerPlaced`; GameState deducts cost and emits `Ev.StateChanged`; HUD clears the ghost
4. Invalid → emits `Ev.PlaceRejected { slotId, reason }`; HUD shows a toast

**Kill:**

1. Projectile reaches enemy → `enemy.takeDamage(damage)`
2. HP ≤ 0 → Enemy emits `Ev.EnemyKilled { type, bounty, x, y }` and destroys itself
3. GameState adds bounty → emits `Ev.StateChanged` → HUD re-renders
4. (Leak variant: enemy reaches the last waypoint → `Ev.EnemyLeaked { type, hpDamage }` → GameState subtracts HP, emits `Ev.StateChanged`, and `Ev.GameLost` at 0)

## Contract-phase checklist (T+0:20–0:45, one machine)

- [ ] `src/game/td/types.ts`, `events.ts`, `map.ts` typed in verbatim
- [ ] `configs/towers.ts`, `configs/enemies.ts`, `configs/waves.ts` with the first-guess data
- [ ] **Stub files** for every module in the stream briefs (class skeleton + `// TODO`), so all imports resolve and later work is edits-to-owned-files, not conflicting file-adds: `td/GameState.ts`, `td/WaveManager.ts`, `td/entities/Enemy.ts`, `td/entities/Tower.ts`, `td/entities/Projectile.ts`, `td/ui/Placement.ts`, `scenes/HUD.ts`
- [ ] `scenes/HUD.ts` registered in `src/game/main.ts` (the `/new-scene HUD` slash command does both steps). ⚠️ This is the only `main.ts` edit all day
- [ ] Placeholder textures in `Preloader.create()` for every `textureKey` referenced by the configs, following the existing `sparkle` example in that method: `tower-shield` (hexagon, kit-orange `0xff9900`), `enemy-ddos` (green circle ~24px), `projectile-shield` (white 6px dot), and `origin-server` (a small server-rack rectangle for the base). Keep them before the `scene.start('MainMenu')` line
- [ ] `npm run typecheck` clean
- [ ] Commit `contracts: types, events, map, config skeletons` and everyone pulls

From here the three of you fan out; open your stream doc and go.

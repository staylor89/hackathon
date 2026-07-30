# 03: Stream B, Entities & Combat (Dev B)

You own everything that moves and shoots: enemies, towers, projectiles, and their config registries. Your code is consumed exclusively through the `IEnemy`/`ITower` interfaces and the two factory functions in [01-contracts.md](./01-contracts.md); nobody imports your classes directly, which means you can restructure internals freely as long as the factories and interfaces hold.

## Files you own

| File | What it is |
|---|---|
| `src/game/td/entities/Enemy.ts` | Tortoise: waypoint walking, damage, death, leak |
| `src/game/td/entities/Tower.ts` | AWS Shield: targeting and firing |
| `src/game/td/entities/Projectile.ts` | Homing dot |
| `src/game/td/configs/towers.ts` | Tower stat registry (created at contract time; you tune) |
| `src/game/td/configs/enemies.ts` | Enemy stat registry (same) |

## `entities/Enemy.ts`

`class Enemy extends Phaser.GameObjects.Sprite implements IEnemy`, plus the exported factory:

```ts
export const spawnEnemy: SpawnEnemyFn = (scene, cfg, waypoints) =>
    new Enemy(scene, cfg, waypoints);
```

Constructor: `super(scene, waypoints[0].x, waypoints[0].y, cfg.textureKey)`, `scene.add.existing(this)`, init `hp = cfg.maxHp`, `nextIdx = 1`.

**Manual waypoint stepping** in `preUpdate` (this is the whole movement system; resist the urge to reach for `Curves.Path`):

```ts
preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta);
    if (!this.alive) return;
    const target = this.waypoints[this.nextIdx];
    const step = this.cfg.speed * (delta / 1000);
    const dist = Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y);
    if (dist <= step) {
        this.setPosition(target.x, target.y);
        this.nextIdx++;
        if (this.nextIdx >= this.waypoints.length) { this.leak(); return; }
    } else {
        const angle = Math.atan2(target.y - this.y, target.x - this.x);
        this.x += Math.cos(angle) * step;
        this.y += Math.sin(angle) * step;
    }
    // 0..1 along the whole path; towers target the highest value in range.
    const segs = this.waypoints.length - 1;
    const segFrac = 1 - Math.min(dist / this.segmentLength(this.nextIdx), 1);
    this.pathProgress = (this.nextIdx - 1 + segFrac) / segs;
}
```

(Per-segment fraction can be approximate; it only breaks ties between enemies, so "close enough" is genuinely fine. Precompute segment lengths in the constructor if you bother at all.)

- `takeDamage(amount)`: `hp -= amount`; at `hp <= 0` → `die()`
- `die()`: set `active = false`, `bus.emit(Ev.EnemyKilled, { type, bounty, x, y })`, death feedback (sprint 2), `this.destroy()`
- `leak()`: set `active = false`, `bus.emit(Ev.EnemyLeaked, { type, hpDamage })`, quick fade, `this.destroy()`
- `active` must be `false` from the first line of `die()`/`leak()` so towers and in-flight projectiles stop considering it this same frame

## `entities/Tower.ts`

`class Tower extends Phaser.GameObjects.Sprite implements ITower` (or a Container if you want a base + turret; Sprite is fine for MVP), plus:

```ts
export const createTower: CreateTowerFn = (scene, cfg, slot) =>
    new Tower(scene, cfg, slot);
```

No physics, no `preUpdate` timing games; Game.ts drives you explicitly every frame:

```ts
update(_time: number, dtMs: number, enemies: readonly IEnemy[]) {
    this.cooldown -= dtMs;
    if (this.cooldown > 0) return;
    const r2 = this.cfg.range * this.cfg.range;
    let best: IEnemy | null = null;
    for (const e of enemies) {
        if (!e.active) continue;
        const dx = e.x - this.x, dy = e.y - this.y;
        if (dx * dx + dy * dy > r2) continue;
        if (!best || e.pathProgress > best.pathProgress) best = e;
    }
    if (best) {
        new Projectile(this.scene, this.x, this.y, best, this.cfg);
        this.cooldown = this.cfg.fireRateMs;
    }
}
```

Target selection is **furthest along the path**, i.e. max `pathProgress`; it's the standard TD default and it's why `IEnemy` carries that field.

## `entities/Projectile.ts`

Homing point-mover, guaranteed hit; deliberately no physics and no miss case:

- Each `preUpdate`: if `!target.active`, `this.destroy()` (target died to someone else's shot mid-flight). Otherwise steer toward the target's current position at `cfg.projectileSpeed`; within **12px** → `target.takeDamage(cfg.damage)`, small impact flash, `destroy()`.
- That's it. No pooling (creation churn at our scale is irrelevant), no lead calculation, no collider.

## Self-testing before integration (sprint 1)

You don't need A's WaveManager or C's HUD. Coordinate with A to paste a temporary debug block into `Game.ts`'s `create()` (their file; they may prefer to add it themselves, and it dies at checkpoint 1):

```ts
// TEMP (Stream B, delete at checkpoint 1)
this.input.keyboard!.on('keydown-E', () => {
    this.enemies.push(spawnEnemy(this, ENEMIES.ddos, MAP.waypoints));
});
this.input.keyboard!.on('keydown-T', () => {
    const t = createTower(this, TOWERS.shield, MAP.slots[4]);
    this.towers.set(4, t);
});
```

Definition of done for sprint 1: press E five times, tortoises walk the S-path and leak at the origin server; press T, the tower kills them and `enemy-killed` events appear (log them).

## Sprint 2 (T+2:20–3:30): polish

- Death: flash white (`setTintFill` + `delayedCall`, or a 100ms tween) then a **sparkle particle burst** (the `sparkle` texture already exists in `Preloader.create()`; the `particles` skill pack has the one-shot emitter recipe)
- Leak: red flash on the whole screen edge or a quick shake (`cameras` pack) to make leaks *felt*
- Hit feedback: tiny scale-pop on the enemy when a projectile lands
- HP bars only if cheap: a 2-rect Container above each enemy; skip if it fights you, the swarm dies fast enough that bars barely read

## Balancing pass (T+3:50–4:30)

You own `towers.ts`/`enemies.ts` numbers; A owns `waves.ts`. Iterate live: `npm run dev` hot-reloads config edits instantly. Target: wave 1 trivial with 2 towers, wave 5 tense with ~6.

If we're ahead: **a second tower type is a config entry + a texture** (e.g. WAF, slower/harder-hitting vs a tougher SQLi tortoise). It proves the whole data-driven pitch in the demo; mention it to the team before building.

## Skill packs to lean on

`sprites-and-images`, `geometry-and-math` (distance/angle), `tweens` (flashes, pops), `particles` (death burst), `groups-and-containers` (only if you do HP bars), `curves-and-paths` (ONLY if abandoning manual waypoints; you shouldn't need it).

## Gotchas

- ⚠️ `npm run typecheck` before every push.
- Emit events with the payload interfaces from `events.ts` (`satisfies EnemyKilledPayload` is a cheap guard).
- Set `active = false` before emitting death/leak events, not after; listeners may re-enter your code in the same tick.
- Phaser 4, not 3: if an API fights you, check the skill pack before guessing from memory.
- Palette: tortoises should contrast with the dark console theme (green reads well); towers can take the kit orange `0xff9900`.

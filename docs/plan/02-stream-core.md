# 02: Stream A, Core Engine (Dev A)

You own the spine of the game: the orchestrating scene, game state, and wave scheduling. You are also the **integration lead**: at the two checkpoints you arbitrate seams and may hot-patch across ownership lines (during checkpoints only). Read [01-contracts.md](./01-contracts.md) first; everything here codes against those interfaces.

## Files you own

| File | What it is |
|---|---|
| `src/game/scenes/Game.ts` | Rework of the kit's stub gameplay scene. The orchestrator |
| `src/game/td/GameState.ts` | HP / money / wave state; the only place money and HP mutate |
| `src/game/td/WaveManager.ts` | Wave scheduling and wave-clear detection |
| `src/game/td/configs/waves.ts` | Wave schedule data (created at contract time; you tune it) |
| `src/game/td/map.ts` | Path/slot constants (created at contract time; you adjust after eyeballing) |

## `scenes/Game.ts`: the orchestrator

The kit's `Game.ts` is a stub: dark backdrop, a 64px grid, "gameplay goes here" text, and two debug key bindings (ESC → menu, ENTER → GameOver). **Keep the backdrop and grid** (they're the game's look); delete the placeholder text and the ENTER binding (ESC → menu is worth keeping). Then build, in `create()` order:

1. **Draw the world**: path as a thick polyline through `MAP.waypoints` (`this.add.graphics()`, `strokePoints`; kit-orange or a lighter grid tone so it reads against the backdrop), build slots as rounded-rect outlines at each `MAP.slots` entry, the origin server sprite at `MAP.base` (placeholder texture `origin-server` from the contracts phase).
2. **Construct collaborators**: `new GameState(...)`, `new WaveManager(this, WAVES, spawnEnemy)` where `spawnEnemy` is Stream B's factory imported from `td/entities/Enemy.ts`.
3. **Launch the HUD scene in parallel**: `this.scene.launch('HUD')`.
4. **Own the entity collections**: `private enemies: IEnemy[] = []` and `private towers = new Map<number, ITower>()`. WaveManager pushes spawned enemies into `enemies` (pass a callback or let it return the enemy; your call, it's all your code).
5. **Handle placement requests** (`Ev.PlaceTower`): validate money via GameState and occupancy via `towers.has(slotId)`; on success call Stream B's `createTower(...)`, store it, emit `Ev.TowerPlaced`; on failure emit `Ev.PlaceRejected` with the right `reason`. This is the game's single validation point; guard it jealously.
6. **Game over transitions**: on `Ev.GameWon` / `Ev.GameLost` → `this.scene.stop('HUD')` then `this.scene.start('GameOver', { won, wavesSurvived })`. Guard with a `scene.isActive()` check or a once-flag so a flood of leaks can't double-trigger the transition. (Note the kit's GameOver currently expects `{ score }`; Stream C reworks it to take `{ won, wavesSurvived }`, per their brief.)
7. **Listener hygiene**: detach every `bus.on` in a `this.events.once('shutdown', ...)` block. You set the example here; the restart test at checkpoint 2 is unforgiving.

`update(time, delta)`:

```ts
update(time: number, delta: number) {
    for (const tower of this.towers.values()) {
        tower.update(time, delta, this.enemies);
    }
    // prune dead/leaked enemies so towers stop targeting them
    this.enemies = this.enemies.filter(e => e.active);
    this.waveManager.update(time, delta);
}
```

## `td/GameState.ts`

Plain class, not a scene. Constructor takes starting values (`hp: 20`, `money: 120`). Subscribes to:

- `Ev.EnemyKilled` → `money += p.bounty`, emit state
- `Ev.EnemyLeaked` → `hp -= p.hpDamage`, emit state; at `hp <= 0` emit `Ev.GameLost { wavesSurvived: wave - 1 }` exactly once (guard with a `finished` flag so a flood of leaks can't emit twice)
- `Ev.TowerPlaced` → `money -= p.cost`, emit state
- `Ev.WaveStarted` → `wave = p.wave`, emit state
- `Ev.WaveCleared` on the LAST wave → emit `Ev.GameWon { wavesSurvived: totalWaves }` (also once)

"Emit state" means `bus.emit(Ev.StateChanged, { hp, money, wave, totalWaves } satisfies StateChangedPayload)`. Emit it once in the constructor too, so the HUD renders correct initial values.

Expose `get money()` for Game.ts's placement validation. Provide a `destroy()` that detaches its bus listeners; Game.ts calls it on shutdown.

## `td/WaveManager.ts`

Iterates `WAVES`. For each wave:

1. Emit `Ev.WaveStarted { wave, totalWaves }`
2. For each `WaveEntry`, schedule `count` spawns `spawnIntervalMs` apart using `this.scene.time.addEvent({ delay, repeat, callback })` (the `time-and-timers` skill pack covers the API)
3. Each spawn: `const e = spawnEnemy(scene, ENEMIES[entry.enemyType], MAP.waypoints)`, hand it to Game.ts's `enemies` array, `spawned++`

**Wave-clear detection**: count `spawned` vs `resolved` per wave, where resolved = killed + leaked (subscribe to both events). When all entries have finished spawning AND `resolved === spawned`, emit `Ev.WaveCleared { wave }`, then start an inter-wave countdown (5s `time.delayedCall`, or a "start next wave" button via C if they get to it) and begin the next wave. Do NOT scan display lists or the enemies array for emptiness; the counter pair has no edge cases around the last enemy leaking vs dying.

After the final wave's `WaveCleared`, do nothing; GameState turns it into `GameWon`.

## Sprint 1 (T+0:45–2:00): definition of done

- Path and slots drawn, eyeballed, `map.ts` constants adjusted; the origin server standing at the base
- GameState wired and emitting; placement validation path works end to end against a **fake** `Ev.PlaceTower` you emit from a debug keypress
- WaveManager spawns real enemies (B's `spawnEnemy` lands early in sprint 1; until then, log spawns to console with a fake factory that returns a dummy `IEnemy`)
- Typecheck clean, pushed

## Sprint 2 (T+2:20–3:30)

- Full 5-wave progression with inter-wave countdown displayed via `Ev.WaveStarted` timing
- Win and lose both reachable and transitioning to GameOver with the right payload
- Remove every fake/stub left from sprint 1
- Support checkpoint 2's second-run test: play, game over, play again; watch for doubled money ticks (that's a leaked listener, usually yours or C's)

## Your stubs while you wait

- **B's factories not landed**: `const fakeSpawn: SpawnEnemyFn = () => ({ cfg: ENEMIES.ddos, x: 0, y: 0, active: false, hp: 0, pathProgress: 0, takeDamage() {} });`
- **C's HUD not landed**: nothing needed; `StateChanged` just has no listener yet. Emit away.

## Skill packs to lean on

`scenes` (parallel scenes, passing data to GameOver), `time-and-timers` (wave scheduling), `events-system` (bus patterns, cleanup), `graphics-and-shapes` (path/slot rendering), `geometry-and-math`, `game-setup-and-config`.

## Gotchas

- ⚠️ `npm run typecheck` before every push; Vite will happily serve broken TS.
- Don't touch `main.ts` after the contracts commit (HUD is already registered there).
- Keep the kit's palette (`BG 0x0b1120`, `GRID 0x1c2a3a`, accent `0xff9900`); the grid-drawing code already in the stub is the reference.

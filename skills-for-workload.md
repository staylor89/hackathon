# Skill Packs by Workstream — EU-Tort-3

Which of the 26 Phaser skill packs in `.claude/skills/` each stream needs, and which to stay out of.

Skill names below are the directory names under `.claude/skills/`. A teammate can name one directly ("use the time-and-timers skill") or just describe the task and let Claude pull it.

Nobody should read these end to end. They are 350 to 500 lines each and load automatically when relevant. The value of this document is knowing which pack to name when the automatic pick is wrong, and knowing which four to stay out of.

## Everyone reads these at T+0, before the contracts commit

| Skill | Why all three need it |
|---|---|
| scenes | Lifecycle order, `this.scene.launch` for the parallel HUD, and the `shutdown` cleanup pattern the event bus depends on. Gotcha #10 (shutdown vs destroy) and the `this.events.once('shutdown', ...)` example at line 360 are the restart-hygiene rule in the plan. |
| events-system | The bus is the only cross-stream channel. Everyone emits and listens; nobody should be learning this at the first integration checkpoint. |

## Stream A — Core

Owns Game.ts as orchestrator, td/GameState.ts, td/WaveManager.ts, td/configs/waves.ts.

| Skill | Used for |
|---|---|
| time-and-timers | Primary. Wave spawn scheduling with `this.time.addEvent({ delay, repeat, callback })`, inter-wave gaps with `delayedCall`, and `timeScale` if a pause or fast-forward gets added. |
| scenes | Primary. Launching HUD in parallel, `scene.start('GameOver', data)` on win or loss, render order of parallel scenes. |
| events-system | Primary. The `ui-place-tower` handler, emitting `state-changed`, detaching listeners on shutdown. |
| graphics-and-shapes | Drawing the S-path polyline and the grid slots. Gotcha #8: Graphics rebuilds geometry every frame, so bake the static path with `generateTexture` rather than redrawing it. |
| geometry-and-math | Slot hit-testing with `Phaser.Geom.Rectangle.Contains` during placement validation, and `Vector2` for waypoints. |
| groups-and-containers | Only if the plain `enemies[]` / `towers[]` arrays start hurting. Read the object-pool pattern before rewriting anything. |
| text-and-bitmaptext | Debug overlay only (wave number, enemy count). The real HUD belongs to Stream C. |

## Stream B — Entities

Owns td/entities/Enemy.ts, td/entities/Tower.ts, td/entities/Projectile.ts, td/configs/towers.ts, td/configs/enemies.ts.

| Skill | Used for |
|---|---|
| sprites-and-images | Primary. The Image vs Sprite table at line 54: `preUpdate` only runs on Sprite. Since Enemy does its waypoint stepping in `preUpdate`, it must extend Sprite, not Image. That single line will save an hour. |
| game-object-components | Primary. Line 353 has a working `extends Phaser.GameObjects.Sprite` subclass, and the "Factory Registration and Display List" section covers `this.add.existing(...)`, which custom classes need or they never render. |
| geometry-and-math | Primary. `Phaser.Math.Distance.BetweenPointsSquared` for range checks without a sqrt, `Phaser.Math.Angle.Between` to aim, `Clamp` and `Linear` for movement stepping. |
| time-and-timers | Tower fire cooldowns. Delta accumulation in `preUpdate` is simpler than a TimerEvent per tower; the skill shows both. |
| tweens | Sprint 2 polish. Death flash and hit reaction via `yoyo: true` plus `onComplete` to destroy. |
| particles | Sprint 2 polish. `emitter.explode(20, x, y)` for the kill sparkle, and `duration` so the emitter self-stops. |
| events-system | Emitting `enemy-killed` and `enemy-leaked` with the payloads frozen in the contracts. |

Explicitly not Stream B's, despite looking relevant: physics-arcade, physics-matter, curves-and-paths. The plan chose manual waypoint stepping and squared-distance checks over a physics body and `Curves.Path`. Opening those packs will pull you toward an API the rest of the code does not use.

## Stream C — UI

Owns scenes/HUD.ts, td/ui/Placement.ts, MainMenu.ts, GameOver.ts, Preloader.ts.

| Skill | Used for |
|---|---|
| scenes | Primary. HUD as a parallel scene, receiving init data from Game, cross-scene event listening. The UIScene example at line 287 is this exact setup. |
| input-keyboard-mouse-touch | Primary. `setInteractive()` on shop buttons and slots, `pointerover` and `pointerout` for the ghost highlight, custom hit areas via `Phaser.Geom.Rectangle.Contains`, and the drag section if the ghost follows the pointer. |
| text-and-bitmaptext | Primary. Money, base HP, wave counter, button labels, rejection toast. |
| graphics-and-shapes | Primary. All placeholder art via `generateTexture` in Preloader, plus slot highlight rectangles and button backgrounds. Gotcha #7: gradient fills do not survive `generateTexture`, so keep placeholders flat. |
| cameras | The HUD-coords-equal-world-coords requirement. Line 200 onward has the two-camera setup, `main.ignore(hudGroup)` and `hudCam.ignore(worldGroup)`, which is the mechanism the plan assumes. Also camera shake on a leak. |
| loading-assets | Preloader ownership: the `progress` event for a load bar, and key-naming discipline so real art swaps in later without touching another stream's code. |
| tweens | Toast fade in and out, button hover pulse, GameOver title entrance. |
| audio-and-sound | Polish phase only, after the second integration checkpoint. Place, kill and leak sounds. |
| render-textures | Fallback if `generateTexture` proves awkward for a specific placeholder. Not needed by default. |

## Unassigned, on purpose

| Skill | Why not |
|---|---|
| tilemaps | Slots are hand-placed as a `GridSlot[]`. |
| physics-arcade | No physics bodies in the design. |
| physics-matter | Same, and heavier still. |
| curves-and-paths | Manual waypoints were chosen over `Curves.Path`. |
| animations | No spritesheets in the MVP. |
| scale-and-responsive | Canvas is fixed at 1024x768. |
| filters-and-postfx | Well past the T+4:30 freeze. |
| actions-and-utilities | Nothing in the MVP operates on sets of objects in bulk. |
| data-manager | The event bus plus GameState replaces registry-based state. |
| game-setup-and-config | Only relevant for the one-time HUD scene registration in main.ts during the contracts commit. |

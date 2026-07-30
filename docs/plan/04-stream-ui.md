# 04: Stream C, UI/UX (Dev C)

You own everything the player reads and clicks, plus the game's look: HUD, tower placement interaction, menu/game-over screens, assets, and sound. Structurally you have the best isolation of the three streams: your HUD is a **separate Phaser scene** running in parallel over the Game scene, so you never edit `Game.ts` at all.

One load-bearing fact: the camera never scrolls, so **HUD-scene coordinates == world coordinates**. That's what lets slot highlighting and placement clicks live entirely in your scene while the slots themselves are drawn by Stream A.

The kit already establishes the visual identity (dark console `0x0b1120`, faint 64px grid `0x1c2a3a`, AWS orange `0xff9900`, text `#e6edf3` / muted `#8ea3b8`; see `MainMenu.ts` for the reference implementation). Everything you build should stay inside that palette.

## Files you own

| File | What it is |
|---|---|
| `src/game/scenes/HUD.ts` | New parallel scene: readouts, shop, banners, toasts |
| `src/game/td/ui/Placement.ts` | Placement controller used by HUD |
| `src/game/scenes/MainMenu.ts` | Already themed by the kit; copy tweaks only |
| `src/game/scenes/GameOver.ts` | Add the win variant |
| `src/game/scenes/Preloader.ts` | Asset loading + placeholder textures (shared once at contract time, yours after) |
| `public/assets/` | Any art/audio you add (adding files here never conflicts) |

## `scenes/HUD.ts`

Registered in `main.ts` at contract time (via `/new-scene HUD`); Stream A launches it with `this.scene.launch('HUD')`. It renders from events only; it holds no game state of its own.

- **Readouts** (top bar): region HP, money, `wave X / Y`. Subscribe to `Ev.StateChanged` and re-render from the `StateChangedPayload`; that one event drives everything, including initial values (GameState emits it on construction).
- **Shop panel** (bottom): one button for AWS Shield showing name + cost (pull both from `TOWERS.shield`; never hardcode). Grey it out when `money < cost` (you know money from the last `StateChanged`).
- **Wave banner**: on `Ev.WaveStarted`, tween a big "Wave 3 / 5, DDoS inbound!" banner in and out (~1.5s).
- **Rejection toast**: on `Ev.PlaceRejected`, brief toast ("Not enough budget" / "Slot occupied") near the clicked slot.
- **Listener hygiene** (critical): the bus outlives scenes. Detach every listener in `this.events.once('shutdown', ...)` or run #2 gets ghost HUD text and double toasts. Checkpoint 2 tests a restart explicitly.

## `td/ui/Placement.ts`

Plain class instantiated by HUD, handling the select-then-place loop:

1. Shop button click → enter placement mode for `towerType` (button highlights; cursor hint if trivial)
2. While in placement mode, on pointer move: find the nearest `MAP.slots` entry within `MAP.slotSize / 2` of the pointer (import `MAP`; a linear scan over 12 slots is fine) and draw a **ghost highlight** rect over it (green; you can't see occupancy or afford-ability authoritatively, and that's fine; the engine is the validator, your ghost is a hint)
3. Slot click → `bus.emit(Ev.PlaceTower, { slotId, towerType } satisfies PlaceTowerPayload)`, stay in placement mode (fast multi-build feels good); right-click or ESC exits placement mode
4. On `Ev.TowerPlaced`: brief success blip on that slot. On `Ev.PlaceRejected`: toast (HUD listens for this; keep the split however feels natural, it's all your code)

You never check money, never check occupancy, never create towers. Emit the request; render the outcome.

**Fallback if placement UX rat-holes** (pre-agreed, no discussion needed): delete the ghost/hover entirely; shop button arms placement, clicking any slot emits `PlaceTower`, engine rejects invalid ones silently. Ugly but demos fine.

## `scenes/Preloader.ts`

The kit already themes the loading screen (EU-TORT-3 title, orange progress bar) and generates the `sparkle` texture in `create()`. The contract phase adds the game's placeholder textures alongside it, same pattern, before the `scene.start('MainMenu')` line:

- `tower-shield`: hexagon (~48px, kit orange `0xff9900`)
- `enemy-ddos`: green circle (~24px), maybe two darker arcs for a shell
- `projectile-shield`: white 6px dot
- `origin-server`: small server-rack rectangle (~56px, dark fill + orange stroke and a couple of "LED" dots)

After that the file is yours. Real art later **must reuse the same texture keys**; swapping a `generateTexture` call for `this.load.image('enemy-ddos', 'assets/tortoise.png')` in `preload()` is invisible to Streams A and B (the commented example in `preload()` shows the intended pattern).

## `scenes/MainMenu.ts` and `scenes/GameOver.ts`

- **MainMenu**: already done by the kit (title, "Europe (Tortoise) · Cloud Defence" subtitle, START button with hover states, SPACE/ENTER bindings). Yours to tweak: add a one-line controls hint ("Click a tower, click a slot") and anything the team wants on the pitch line. Don't rebuild what works.
- **GameOver**: the kit ships the lose screen ("REGION DOWN" + score + click to try again). Rework `init` to take `{ won, wavesSurvived }` instead of `{ score }` (coordinate the payload with Stream A; it's in the contracts as `GameResultPayload`). Loss → keep REGION DOWN, show waves survived. Win → new variant: "REGION HEALTHY" (or "ALL SYSTEMS OPERATIONAL") in a calmer green/orange, waves survived, same click-to-continue. The existing scene structure (backdrop, grid, big text, pulsing prompt) is exactly right; parameterize it rather than duplicating.

## Sprint 1 (T+0:45–2:00): definition of done

- HUD renders HP/money/wave from `StateChanged`; until A's GameState lands, drive it with a temp fake: `bus.emit(Ev.StateChanged, { hp: 20, money: 120, wave: 1, totalWaves: 5 })` from a keypress. Delete at checkpoint 1
- Shop button + placement mode + slot click emitting `PlaceTower` (log it), ghost highlight working
- MainMenu copy tweaks done
- Typecheck clean, pushed

## Sprint 2 (T+2:20–3:30)

- GameOver win/lose variants wired to real payloads
- Wave banner + rejection toast + "can't afford" greying
- Restart path verified: menu → game → game over → menu → game with no ghost text (your listeners are the usual suspect)

## Polish phase (T+3:50–4:30)

- Art: generated/found tortoise + shield sprites swapped in via Preloader (same keys). Keep placeholder shapes if art costs more than 15 minutes; a coherent placeholder look beats three mismatched art styles, and the console theme carries it
- Sound (`audio-and-sound` pack): shot blip, death pop, leak thud, wave-start sting. Four sounds max; skip music
- Juice if cheap: camera shake on leak, tween pops on money changes

## Skill packs to lean on

`input-keyboard-mouse-touch` (pointer, slot hit-testing, interactive buttons), `text-and-bitmaptext`, `scenes` (parallel scenes, `init` data), `graphics-and-shapes` (panels, ghost), `tweens` (banners), `loading-assets`, `audio-and-sound` (polish).

## Gotchas

- ⚠️ `npm run typecheck` before every push.
- HUD must set itself transparent over the game (don't paint a full-screen background rect).
- Pull tower cost/name from `TOWERS.shield`, never literals; B tunes those numbers late in the day and your shop must follow.
- Phaser 4, not 3: check skill packs before guessing APIs from memory.

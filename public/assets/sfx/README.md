# EU-Tort-3 sound effects

Every file here is synthesised by `tools/make-sfx.mjs`. Nothing is sampled or
sourced, so there is no licence to track and the whole set is tunable in one
place. Regenerate with:

    node tools/make-sfx.mjs

The script is seeded, so regenerating produces byte-identical files. Edit a
recipe in the `SOUNDS` map and re-run; keys and filenames stay put, so audio can
be re-tuned at any point without touching TypeScript.

## Format

    44.1 kHz, mono, 16-bit PCM WAV

Phaser 4 defaults to `WebAudioSoundManager`, which decodes each file into an
`AudioBuffer` at preload, so compression only saves download size. WAV is worth
the bytes here: MP3 and AAC both prepend 10-30ms of encoder silence and Phaser
has no per-sound offset trim, which on a tower firing every 120ms is a quarter
of the interval. The loaded set is ~570 KB uncompressed, which is invisible on a
local dev server.

Every file starts and ends at a zero sample (1ms in-ramp, 4ms out-ramp) so
playback never ticks. The in-ramp lands on the transient for the shortest
sounds, which is why `ui-click` and `tower-shield-fire` measure about 2dB under
their stated target.

## Playing them

Nothing calls `this.sound.play()` directly. Everything goes through `Game.sfx()`:

    this.sfx('sfx-tower-build');
    this.sfx('sfx-enemy-hit', { volume: 0.55, minGap: 75 });

`minGap` is the important one. It drops a play outright if the same key sounded
within that many ms. By mid-game there are 50+ shots a second on the board and
Web Audio will happily mix all of them into mush; the surplus is dropped because
nobody can pick out individual shots at that rate. Firing gaps live on the tower
spec as `fireGap`, so tower audio is tuned next to tower balance.

`sfx()` also detunes every play by up to ±6%. Without that, identical samples
stack phase-coherently and read as one smeared tone rather than many shots.

**M** toggles mute, and the state shows in the HUD hint line. The
`AudioContext` starts suspended until a user gesture, but the MainMenu click
satisfies that, so no manual unlock handling is needed.

## Loaded set

| Key | File | Length | Peak | Fires on |
|-----|------|--------|------|----------|
| `sfx-iam-fire` | `tower-iam-fire.wav` | 95ms | -17 dBFS | IAM shot. Clinical two-tone verify, deliberately unlike a projectile |
| `sfx-shield-fire` | `tower-shield-fire.wav` | 70ms | -18 dBFS | Shield shot. Square blip sweeping 1900 to 430 Hz with a noise transient |
| `sfx-waf-fire` | `tower-waf-fire.wav` | 110ms | -14 dBFS | WAF shot. Hard click into a saturated low thunk; a stamp, not a shot |
| `sfx-tower-build` | `tower-build.wav` | 320ms | -12 dBFS | Tower placed. Rising 440 to 660 Hz over a mechanical knock |
| `sfx-tower-sell` | `tower-sell.wav` | 240ms | -14 dBFS | Tower sold. Falling two-tone plus a coin tick |
| `sfx-tower-unlock` | `tower-unlock.wav` | 440ms | -11 dBFS | Tower unlocked. Three-note rise; happens at most twice a run |
| `sfx-tower-offline` | `tower-offline.wav` | 520ms | -14 dBFS | Brownout. Power-down glide with 60 Hz mains hum |
| `sfx-enemy-hit` | `enemy-hit.wav` | 38ms | -23 dBFS | Non-fatal hit. The most frequent event in the game; hardest throttled |
| `sfx-enemy-death` | `enemy-death.wav` | 210ms | -16 dBFS | Mob killed. Noise collapsing 5200 to 420 Hz plus a body thump |
| `sfx-boss-death` | `boss-death.wav` | 760ms | -11 dBFS | Leatherback down. Shell collapse into a low boom |
| `sfx-ninja-dash` | `ninja-dash.wav` | 190ms | -22 dBFS | Both ends of a shinobi smoke dash |
| `sfx-breach` | `breach.wav` | 240ms | -13 dBFS | Flood or shinobi reaches the origin. Dull, close, small |
| `sfx-breach-heavy` | `breach-heavy.wav` | 560ms | -9 dBFS | Flyer or tank lands. Paired with the 320ms camera shake |
| `sfx-wave-start` | `wave-start.wav` | 740ms | -12 dBFS | Wave inbound. Two-beat console alert |
| `sfx-wave-boss` | `wave-boss.wav` | 980ms | -11 dBFS | Boss wave. Same shape an octave and a half down, with rumble |
| `sfx-region-down` | `region-down.wav` | 1700ms | -10 dBFS | Integrity zero. Detuned saw pair falling 330 to 44 Hz |
| `sfx-ui-click` | `ui-click.wav` | 28ms | -20 dBFS | Arming a build button |
| `sfx-place-denied` | `place-denied.wav` | 170ms | -16 dBFS | Cannot afford a build or an unlock |

Levels are deliberately uneven. Firing and hit sounds sit low because dozens
overlap; the once-per-wave and once-per-run events get the headroom.

## Generated but not loaded

`make-sfx.mjs` also emits firing sounds for towers that do not exist yet:

    tower-glacier-fire.wav      300ms   -16 dBFS
    tower-lambda-fire.wav       290ms   -16 dBFS
    tower-guardduty-ping.wav    650ms   -18 dBFS
    tower-snowmobile-fire.wav   720ms    -8 dBFS

These are not in `Preloader` on purpose, since Web Audio decodes everything
loaded there up front. If one of those towers lands, add a `load.audio` line and
set `fireSfx` on its spec.

Note that `public/assets/tower-snowmobile.png` is likewise present but unloaded
and unreferenced; there is no `snowmobile` entry in `TowerKind`.

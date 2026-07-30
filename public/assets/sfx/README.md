# EU-Tort-3 audio

Three generators, all writing here:

    npm run sfx      # tools/make-sfx.mjs   — 19 synthesised one-shots
    npm run music    # tools/make-music.mjs — 2 synthesised loops
    npm run clips    # tools/make-clips.mjs — 3 cuts of sourced recordings

Shared DSP lives in `tools/dsp.mjs`. The two synth scripts are seeded, so
regenerating produces byte-identical files. Edit a recipe in `SOUNDS` (one-shots)
or a `core()` / `boss()` arrangement (music) and re-run; keys and filenames stay
put, so audio can be re-tuned at any point without touching TypeScript.

**The three generators must not fight over a filename.** Each output name is
owned by exactly one script, which is why the sourced clips kept their own names
(`i-like-turtles.wav`) rather than overwriting the synth files they replaced
(`wave-start.wav`, since deleted). Keys are what the game binds to, so
repointing a key at a different file is a one-line Preloader change.

## Format

    44.1 kHz, mono, 16-bit PCM WAV

Phaser 4 defaults to `WebAudioSoundManager`, which decodes each file into an
`AudioBuffer` at preload, so compression only saves download size. WAV is worth
the bytes here: MP3 and AAC both prepend 10-30ms of encoder silence and Phaser
has no per-sound offset trim. On a tower firing every 120ms that is a quarter of
the interval, and on a loop it is an audible hiccup on every single pass. The
loaded set is ~570 KB of effects plus 2.5 MB of music, which is invisible on a
local dev server. If the deployed bundle ever matters, halving the music sample
rate to 22.05 kHz is the cheapest win; do not reach for MP3.

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
| `sfx-snowmobile-fire` | `tower-snowmobile-fire.wav` | 980ms | -6 dBFS | Snowmobile beam. 200ms charge, a crack, then a cryo tail |
| `sfx-tower-build` | `tower-build.wav` | 320ms | -12 dBFS | Tower placed. Rising 440 to 660 Hz over a mechanical knock |
| `sfx-tower-sell` | `tower-sell.wav` | 240ms | -14 dBFS | Tower sold. Falling two-tone plus a coin tick |
| `sfx-tower-unlock` | `tower-unlock.wav` | 440ms | -11 dBFS | Tower unlocked. Three-note rise; happens at most twice a run |
| `sfx-tower-offline` | `tower-offline.wav` | 520ms | -14 dBFS | Brownout. Power-down glide with 60 Hz mains hum |
| `sfx-enemy-hit` | `enemy-hit.wav` | 38ms | -23 dBFS | Non-fatal hit. The most frequent event in the game; hardest throttled |
| `sfx-enemy-death` | `enemy-death.wav` | 210ms | -16 dBFS | Mob killed. Noise collapsing 5200 to 420 Hz plus a body thump |
| `sfx-boss-death` | `boss-death.wav` | 760ms | -11 dBFS | Leatherback down. Shell collapse into a low boom |
| `sfx-ninja-dash` | `ninja-dash.wav` | 190ms | -22 dBFS | Both ends of a shinobi smoke dash |
| `sfx-breach` | `turtle-mating-short.wav` | 340ms | -14 dBFS | Flood or shinobi reaches the origin. **Sourced clip** |
| `sfx-breach-heavy` | `turtle-mating.wav` | 936ms | -9 dBFS | Flyer or tank lands. **Sourced clip**, full length |
| `sfx-wave-start` | `i-like-turtles.wav` | 895ms | -5 dBFS | Wave inbound. **Sourced clip** |
| `sfx-wave-boss` | `wave-boss.wav` | 980ms | -11 dBFS | Boss wave. Still synth — the boss alert was never the harsh beep |
| `sfx-region-down` | `region-down.wav` | 1700ms | -10 dBFS | Integrity zero. Detuned saw pair falling 330 to 44 Hz |
| `sfx-ui-click` | `ui-click.wav` | 28ms | -20 dBFS | Arming a build button |
| `sfx-place-denied` | `place-denied.wav` | 170ms | -16 dBFS | Cannot afford a build or an unlock |

Levels are deliberately uneven. Firing and hit sounds sit low because dozens
overlap; the once-per-wave and once-per-run events get the headroom.

## Sourced clips

Three of the entries above are real recordings rather than synthesis. Sources
are committed at `tools/source-audio/*.mp3` so the pipeline stays reproducible;
`npm run clips` decodes, downmixes to mono, trims, levels and fades them into the
same format as everything else.

    i-like-turtles.mp3   -> i-like-turtles.wav          (whole clip, -5 dBFS)
    turtle-mating.mp3    -> turtle-mating.wav           (whole clip, -9 dBFS)
                         -> turtle-mating-short.wav     (first 0.34s, -14 dBFS)

Two things differ from the synth one-shots when playing these back:

**Throttles are longer than the clip.** A light breach fires per arriving packet
and the flood spawns 260ms apart, so `sfx-breach` uses a 400ms gap against a
340ms clip. Two overlapping thuds read as one bigger thud; two overlapping
voice-like clips read as mush.

**Pitch jitter is off or minimal.** `sfx-wave-start` uses `jitter: 0`, because
detuning a recognisable line makes it sound like a warped tape rather than like
variation. The breach clips take a reduced `0.03`.

Decoding needs `afconvert`, which ships with macOS. There is no pure-Node MP3
decoder in the toolchain and a dependency for three clips is not worth it; swap
the `decode()` line for ffmpeg if this ever has to run on Linux.

Licensing: both are found audio. Fine for an internal demo, not cleared for
public distribution, so worth a thought before this is hosted anywhere.

## Music

| Key | File | Length | Peak | Plays during |
|-----|------|--------|------|--------------|
| `music-core` | `music-core.wav` | 8 bars / 20.00s | -14 dBFS | Normal play. Am-F-C-G, half-time kick, offbeat hats, sparse arp |
| `music-boss` | `music-boss.wav` | 4 bars / 10.00s | -14 dBFS | Boss waves. Four-on-the-floor, 16th bass, timpani, Bb over the A root |

Both are **A minor at 96 BPM**. That is a hard constraint, not a coincidence:
the game crossfades between them mid-wave, and the tracks are not beat-aligned
when it does, so shared key and tempo is the only thing keeping the overlap
listenable. If you retune one, retune the other.

The core loop is deliberately unmemorable. It plays for an entire run, so
anything with a real hook would be intolerable by wave 12; the job is to imply a
machine room, not to be liked. The boss loop earns its contrast structurally
(double-time drums, a semitone clash) rather than by getting louder.

Loops are made seamless by `fold()` in `dsp.mjs`: render the loop plus a tail,
then add the overhang back over the start, so decays that run past the end are
already ringing at the beginning. `declick()` must never be used on a loop, since
a fade at either end is a hole at the seam.

Verified after generation: both files are an exact whole number of bars
(882000 and 441000 samples), and the RMS across the loop seam matches the RMS
across every internal bar line to within about 1dB, so the loop point is not
audible as an event.

### How the game switches

`Game.playMusic(key, fade)` crossfades and no-ops if the track is already
playing. Boss music starts on the **wave announcement** rather than on the first
tank spawn, because the spawn is still on a timer at that point. It then holds
for as long as any boss is alive, which routinely outlasts its own wave: a
leatherback crawls for nearly a minute and the wave gap is ten seconds, so the
next wave usually starts while the boss is still inbound. `refreshMusic()` is
what returns to the bed, called from `killEnemy` so it covers a boss both dying
and reaching the origin.

`killMusic()` on scene shutdown goes via `sound.removeByKey()` rather than
destroying `this.music`, because a shutdown landing mid-crossfade leaves an
outgoing track that nothing holds a reference to; its fade tween dies with the
scene and it would otherwise loop forever under the main menu.

## Generated but not loaded

`make-sfx.mjs` also emits firing sounds for towers that do not exist yet:

    tower-glacier-fire.wav      300ms   -16 dBFS
    tower-lambda-fire.wav       290ms   -16 dBFS
    tower-guardduty-ping.wav    650ms   -18 dBFS

These are not in `Preloader` on purpose, since Web Audio decodes everything
loaded there up front. If one of those towers lands, add a `load.audio` line and
set `fireSfx` on its spec — which is exactly what happened to the snowmobile.

Its sound was originally a heavy artillery thud, written speculatively when the
plan had it as a slow-firing cannon. It shipped as a **beam** tower instead
(instant hit, 4s cooldown, icy cyan), so the recipe was rewritten as a charge and
discharge. Worth remembering that a tower's sound encodes its mechanic, not just
its name.

# EU-Tort-3 sprite drop

Unzip at the root of ~/primer/hackathon. It writes one file:

    public/assets/tortoise-default.png   64x64, transparent

Then add one line to Preloader.preload():

    this.load.image('tortoise-default', 'assets/tortoise-default.png');

## Default mob tortoise

The generic intruder, kitted out like a shinobi: red mask band across the eyes with
two tails streaming behind, a sash over the shell, cloth wraps on all four
feet. Every wave spawns this unless the wave config names
another key, so the enemy registry's fallback entry points at the key string
'tortoise-default'. Art can be regenerated and overwritten at any point
without touching TypeScript, as long as the filename and key stay put.

- 64 x 64 transparent PNG, body ~48 x 48 centred, 8px margin on every side.
- Rotation pivot is the canvas centre; nothing in the art implies "up".
- Head faces right (0 degrees).
- Top margin left clear for the health bar.
- Readable at 48px on screen and when eight of them overlap.

Palette:

| Role    | Hex     |
|---------|---------|
| Shell   | #4ade80 |
| Cells   | #15803d |
| Mask    | #e5484d |
| Cloth   | #dceaf0 |
| Lit     | #bbf7d0 |
| Limbs   | #37b866 |
| Outline | #062b16 |

No orange or amber anywhere - orange is reserved for towers and UI. Shell is
mid-to-light so multiplicative damage tinting reads; near-black is outline
only.

Regenerating: the sprite is drawn in code, supersampled 8x and downscaled to
64. Edit the draw script in the design project and re-export.

## DDoS swarm tortoise

A flood of traffic, not a single attacker. Small, fragile, fast, and it never
arrives alone: wave 1 spawns 8 at 180ms apart, +2 every wave after, all
following the same trench in single file. Individually harmless at 3% integrity
per breach; the threat is the count.

The build is the volumetric opposite of the default mob: no mask, no sash, no
cloth. Shell is a rounded hexagon packed with a honeycomb of hexagonal packet
cells, three or four cells lit brighter than the rest to read as traffic moving
through the mesh. Head is blunt, low and pushed forward; four short stubby feet
splayed at the shell corners.

- Key: tortoise-ddos
- 64 x 64 transparent PNG, body ~48 x 48 centred, 8px margin on every side.
- Rotation pivot is the canvas centre; nothing in the art implies "up".
- Head faces right (0 degrees). The spawner uses `rotateToPath: true` with no
  angle offset, so a head drawn at any other angle points sideways all game.
- Top margin left clear for the health bar, which is drawn 20 x 4 above the
  sprite regardless of scale.
- Drawn at `DDOS_SCALE = 0.34`, so it renders at roughly 22px on screen, not
  the 48px the default mob gets. Detail budget is about half: anything under
  6px in the source disappears entirely at play size. Silhouette and outline
  carry the whole read.
- A permanent scuttle tween pulses scale by ±12%, so the shape has to hold up
  breathing in and out.
- Must stay legible with a dozen overlapping nose to tail. Keep the outer
  hexagon edge simple and unbroken; internal cell dividers can go if they turn
  to mush at 22px.

Palette:

| Role    | Hex     |
|---------|---------|
| Shell   | #3ee0c8 |
| Cells   | #0d9488 |
| Lit     | #c9fff2 |
| Limbs   | #22c9b4 |
| Outline | #062522 |

No orange or amber anywhere - orange is reserved for towers and UI. Shell is
mid-to-light so multiplicative damage tinting reads; near-black is outline
only.

Regenerating: the sprite is drawn in code, supersampled 8x and downscaled to
64. Edit the draw script in the design project and re-export.

## Injection tortoise (flying)

SQL / prompt injection, airborne. Same build as the default mob - hexagonal
packet mesh, one head, four feet - recoloured fuchsia, with a pair of scalloped
membrane wings and a single flat cyan seam across the shell where the payload
went in. Treat it as a flyer: it ignores ground routing. Same canvas, margin
and centre pivot as the default mob, so it drops into the same spawn code.

- Key: tortoise-injection
- Asymmetric silhouette, but centre of mass still at canvas centre.
- One wing per side, single unbroken outline with three scalloped feather tips;
  wingtips stay inside the 8px margin.
- Symmetric across the axis of travel; centre of mass at the canvas centre.

Palette:

| Role    | Hex     |
|---------|---------|
| Shell   | #e879f9 |
| Cells   | #a21caf |
| Wing    | #f7c4ff |
| Seam    | #22d3ee |
| Limbs   | #c95ae0 |
| Outline | #2b0a2e |

## Enterprise Customer tank

Slow and very tanky. Leathery carapace with no scutes: seven longitudinal keels
converging on a pointed tail, pale speckles across the hide, huge front
flippers sweeping forward and a stubby rear pair.

- Key: tortoise-tank
- Canvas is 96 x 96 (not 64) with the body about 80 x 80 centred, 8px margin.
  Draw it at about 80px in game so it outweighs the 48px mobs.
- Outline 4px, scaled up for the larger canvas. Centre of mass at canvas centre.
- The converging keels fix the facing; nothing in the art implies up.

Palette:

| Role    | Hex     |
|---------|---------|
| Hide    | #8fa2c9 |
| Keels   | #43567f |
| Spots   | #d8e2f5 |
| Flipper | #7c90bd |
| Outline | #1e2740 |

## Towers

Four 64 x 64 top-down emplacements, each a service device on a 50 x 50 slate
baseplate with corner bolts. Towers do not rotate, so the layouts are symmetric
and imply no facing. AWS orange #ff9900 is reserved for towers and UI - no mob
uses it.

| Key              | Service    | Counters                        | Motif |
|------------------|------------|---------------------------------|-------|
| tower-iam        | IAM        | default mob / swarms            | keyhole turret |
| tower-waf        | WAF        | flyers, injection tortoise      | wall courses + scanning emitter |
| tower-shield     | Shield     | fast movers, default mob        | pulse plate + shield boss |
| tower-snowmobile | Snowmobile | tanks, slow mobs                | 45ft container rig, orange cab |

Palette:

| Role      | Hex     |
|-----------|---------|
| Baseplate | #3b4a63 |
| Inner pad | #2a374d |
| Metal     | #8fa0b8 |
| Orange    | #ff9900 |
| Orange dk | #c86f00 |
| Outline   | #0a1120 |

Snowmobile is the only non-round silhouette, deliberately - it should read as
hardware, not a turret, at a glance.

## Firing lanes

Making the projectile path legible takes three things beyond the tower art.

| Key             | Size    | Use |
|-----------------|---------|-----|
| shot-range      | 128x128 | Dashed footprint. Scale to the tower's real radius; show on place / select / hover. |
| shot-tracer          | 48x8    | The lane. Stretch (don't tile) from muzzle to impact, rotate to the firing angle, fade over ~120ms. |
| shot-muzzle    | 20x20   | Bloom at the bore on each shot, rotated to the firing angle. |
| shot-iam        | 16x16   | Key bolt. Fast, point-first. |
| shot-waf        | 20x20   | Flak burst. Radial, no facing - use for the airburst too. |
| shot-shield     | 24x24   | Pulse ring. Scale up from 0 as it expands rather than translating. |
| shot-snowmobile | 24x12   | Heavy slug. Slow, large, one at a time. |

Every lane piece shares the shot- prefix, so the firing system groups together
in the asset list and in the Preloader.

All directional pieces are drawn pointing RIGHT (0 degrees), same as the mobs,
so setRotation to the firing angle works without offsets. Orange stays the
tower/UI colour throughout - the lanes read as the player's own fire.

## Map backdrop (bg.png)

1024 x 768, matching the canvas. Console-inspired: squid-ink nav band in the top
64px (exactly the HUD band), dashed VPC boundary, three availability-zone panels
snapped to the 64px grid with subnet CIDRs, column 00-15 / row A-K references,
and plates for the internet gateway and the origin server.

Already wired in Boot.ts as 'background'. Draw it first in Game.create():

    this.add.image(512, 384, 'background');

It replaces the flat 0x0b1120 rectangle. The faint grid baked in lines up with
the grid the scene strokes, so keeping both is harmless. No orange anywhere -
that stays with towers and UI.

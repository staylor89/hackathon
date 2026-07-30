# EU-Tort-3 sprite drop

Unzip at the root of ~/primer/hackathon. It writes one file:

    public/assets/tortoise-default.png   64x64, transparent

Then add one line to Preloader.preload():

    this.load.image('tortoise-default', 'assets/tortoise-default.png');

## Default mob tortoise

The generic intruder. Every wave spawns this unless the wave config names
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

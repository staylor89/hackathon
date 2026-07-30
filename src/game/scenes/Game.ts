import { Scene, GameObjects, Math as PhaserMath } from 'phaser';

//  ── Layout ───────────────────────────────────────────────────────────────
//  1024x768 canvas. Top 64px is the HUD band, the rest is a 16 x 11 grid of
//  64px raised-floor tiles. Grid coords are (col 0-15, row 0-10).
const TILE = 64;
const COLS = 16;
const ROWS = 11;
const FLOOR_Y = 64;

//  ── Palette ──────────────────────────────────────────────────────────────
const BG = 0x0b1120;
const FLOOR = 0x142033;
const FLOOR_ALT = 0x17273d;
const SEAM = 0x0b1120;
const PERF = 0x24364e;
const TRENCH = 0x0a121f;
const TRENCH_LIP = 0x22405e;
const ACCENT = 0xff9900;
const GREEN = 0x22c55e;
const CYAN = 0x38bdf8;
const PAD_LINE = 0x2a3f5a;
const RACK = 0x0f1a2b;
const RACK_LIP = 0x27384f;

//  Cable route: enemies walk from off-screen left to the origin server.
const WAYPOINTS: [number, number][] = [
    [-1, 1], [4, 1], [4, 4], [1, 4], [1, 8], [6, 8], [6, 3], [10, 3], [10, 7], [13, 7]
];

//  Cells taken up by decorative hardware — never buildable.
const RACK_CELLS: [number, number][] = [
    [12, 0], [13, 0], [14, 0], [15, 0],
    [8, 10], [9, 10], [10, 10], [11, 10], [12, 10],
    [14, 6], [15, 6], [14, 7], [15, 7], [14, 8], [15, 8]
];

const TOWER_NAMES = ['WAF', 'SHLD', 'NACL', 'IAM', 'GUARD'];

export class Game extends Scene
{
    budget = 500;
    budgetText: GameObjects.Text;
    slotText: GameObjects.Text;
    built = 0;

    constructor ()
    {
        super('Game');
    }

    //  Grid cell centre in pixels.
    cx (col: number) { return col * TILE + TILE / 2; }
    cy (row: number) { return FLOOR_Y + row * TILE + TILE / 2; }

    create ()
    {
        this.add.rectangle(512, 384, 1024, 768, BG);

        this.drawFloor();
        const path = this.drawRoute();
        this.drawIngress();
        this.drawOrigin();
        this.drawDecor();
        this.drawPads();
        this.spawnPackets(path);
        this.drawHud();

        this.input.keyboard?.once('keydown-ESC', () => {
            this.scene.start('MainMenu');
        });

        this.input.keyboard?.once('keydown-ENTER', () => {
            this.scene.start('GameOver', { score: 0 });
        });
    }

    //  Raised floor: panels with seams, a few perforated for cold air.
    drawFloor ()
    {
        const g = this.add.graphics();

        for (let col = 0; col < COLS; col++)
        {
            for (let row = 0; row < ROWS; row++)
            {
                const x = col * TILE;
                const y = FLOOR_Y + row * TILE;

                g.fillStyle((col + row) % 2 === 0 ? FLOOR : FLOOR_ALT, 1);
                g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);

                //  Deterministic "random" so the layout is stable across reloads.
                if ((col * 31 + row * 17) % 7 === 0)
                {
                    g.fillStyle(PERF, 0.5);
                    for (let dx = 16; dx < TILE - 8; dx += 12)
                    {
                        for (let dy = 16; dy < TILE - 8; dy += 12)
                        {
                            g.fillRect(x + dx, y + dy, 3, 3);
                        }
                    }
                }
            }
        }

        g.lineStyle(1, SEAM, 1);
        for (let col = 0; col <= COLS; col++) g.lineBetween(col * TILE, FLOOR_Y, col * TILE, 768);
        for (let row = 0; row <= ROWS; row++) g.lineBetween(0, FLOOR_Y + row * TILE, 1024, FLOOR_Y + row * TILE);
    }

    //  The cable trench the intruders follow. Returns the Path for followers.
    drawRoute (): Phaser.Curves.Path
    {
        const pts = WAYPOINTS.map(([c, r]) => new PhaserMath.Vector2(this.cx(c), this.cy(r)));
        const g = this.add.graphics();

        const stroke = (width: number, colour: number, alpha = 1) => {
            g.lineStyle(width, colour, alpha);
            g.beginPath();
            g.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.strokePath();

            //  Square off the corners so the joins don't notch.
            g.fillStyle(colour, alpha);
            for (const p of pts) g.fillRect(p.x - width / 2, p.y - width / 2, width, width);
        };

        stroke(52, TRENCH_LIP, 1);
        stroke(46, TRENCH, 1);

        const path = this.add.path(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);

        //  Fibre runs laid along the bottom of the trench.
        const marks = path.getSpacedPoints(Math.floor(path.getLength() / 22));
        g.fillStyle(ACCENT, 0.35);
        for (const p of marks) g.fillCircle(p.x, p.y, 2.5);

        return path;
    }

    //  Left edge: where the traffic comes in from.
    drawIngress ()
    {
        const y = this.cy(1);

        this.add.rectangle(10, y, 20, 56, RACK).setStrokeStyle(2, CYAN);

        const led = this.add.circle(10, y, 4, CYAN);
        this.tweens.add({
            targets: led, alpha: 0.2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut'
        });

        this.add.text(36, y - 34, 'INGRESS  ·  0.0.0.0/0', {
            fontFamily: 'Arial', fontSize: 14, color: '#38bdf8'
        });
    }

    //  Right edge: the base you're defending.
    drawOrigin ()
    {
        const x = 960;
        const y = this.cy(7);

        this.add.rectangle(x, y, 112, 176, RACK).setStrokeStyle(2, GREEN);

        //  Rack units.
        const leds: GameObjects.Rectangle[] = [];
        for (let i = 0; i < 7; i++)
        {
            const uy = y - 72 + i * 24;
            this.add.rectangle(x, uy, 92, 18, 0x16243a).setStrokeStyle(1, RACK_LIP);
            leds.push(this.add.rectangle(x + 36, uy, 5, 5, GREEN));
        }

        this.tweens.add({
            targets: leds,
            alpha: 0.15,
            duration: 600,
            yoyo: true,
            repeat: -1,
            delay: this.tweens.stagger(140),
            ease: 'Sine.InOut'
        });

        this.add.text(x, y - 104, 'ORIGIN', {
            fontFamily: 'Arial Black', fontSize: 16, color: '#22c55e'
        }).setOrigin(0.5);
    }

    //  Cold-aisle racks and cooling plant. Pure decoration.
    drawDecor ()
    {
        const g = this.add.graphics();
        const leds: GameObjects.Rectangle[] = [];

        const rack = (col: number, row: number, w: number, h: number) => {
            const x = col * TILE + 4;
            const y = FLOOR_Y + row * TILE + 8;

            g.fillStyle(RACK, 1);
            g.fillRect(x, y, w, h);
            g.lineStyle(1, RACK_LIP, 1);
            g.strokeRect(x, y, w, h);

            for (let uy = y + 8; uy < y + h - 6; uy += 12)
            {
                g.lineStyle(1, RACK_LIP, 0.6);
                g.lineBetween(x + 6, uy, x + w - 6, uy);
                leds.push(this.add.rectangle(x + w - 12, uy, 4, 4, (uy % 24 === 0) ? CYAN : GREEN));
            }
        };

        rack(12, 0, 248, 48);   // top-right row
        rack(8, 10, 312, 48);   // bottom row

        this.add.text(12 * TILE + 6, FLOOR_Y + 2, 'RACK A1-A4', {
            fontFamily: 'Arial', fontSize: 11, color: '#5c728a'
        });

        this.add.text(8 * TILE + 6, FLOOR_Y + 10 * TILE - 12, 'RACK B1-B5', {
            fontFamily: 'Arial', fontSize: 11, color: '#5c728a'
        });

        this.tweens.add({
            targets: leds,
            alpha: 0.15,
            duration: 900,
            yoyo: true,
            repeat: -1,
            delay: this.tweens.stagger(90),
            ease: 'Sine.InOut'
        });
    }

    //  Buildable slots = free tiles that touch the cable trench.
    drawPads ()
    {
        const occupied = new Set<string>();
        const onPath = new Set<string>();

        //  Walk each straight segment and mark every cell it crosses.
        for (let i = 0; i < WAYPOINTS.length - 1; i++)
        {
            const [c1, r1] = WAYPOINTS[i];
            const [c2, r2] = WAYPOINTS[i + 1];
            const steps = Math.max(Math.abs(c2 - c1), Math.abs(r2 - r1));
            const dc = Math.sign(c2 - c1);
            const dr = Math.sign(r2 - r1);

            for (let s = 0; s <= steps; s++)
            {
                const key = `${c1 + dc * s},${r1 + dr * s}`;
                onPath.add(key);
                occupied.add(key);
            }
        }

        for (const [c, r] of RACK_CELLS) occupied.add(`${c},${r}`);

        let slots = 0;

        for (let col = 0; col < COLS; col++)
        {
            for (let row = 0; row < ROWS; row++)
            {
                if (occupied.has(`${col},${row}`)) continue;

                const touchesPath = onPath.has(`${col - 1},${row}`) || onPath.has(`${col + 1},${row}`)
                    || onPath.has(`${col},${row - 1}`) || onPath.has(`${col},${row + 1}`);

                if (!touchesPath) continue;

                slots++;
                this.makePad(col, row);
            }
        }

        this.slotText = this.add.text(1014, 40, `BUILD SLOTS  ${slots}`, {
            fontFamily: 'Arial', fontSize: 14, color: '#5c728a'
        }).setOrigin(1, 0.5).setDepth(10);
    }

    //  One buildable slot: hover to highlight, click to drop a placeholder tower.
    makePad (col: number, row: number)
    {
        const x = this.cx(col);
        const y = this.cy(row);

        const pad = this.add.rectangle(x, y, 46, 46)
            .setStrokeStyle(1, PAD_LINE, 0.9)
            .setInteractive({ useHandCursor: true });

        pad.on('pointerover', () => pad.setFillStyle(ACCENT, 0.16).setStrokeStyle(1, ACCENT, 0.9));
        pad.on('pointerout', () => pad.setFillStyle(BG, 0).setStrokeStyle(1, PAD_LINE, 0.9));

        pad.on('pointerdown', () => {
            if (this.budget < 100) return;

            this.budget -= 100;
            this.budgetText.setText(`$${this.budget}`);
            pad.disableInteractive();
            pad.setFillStyle(BG, 0).setStrokeStyle(1, ACCENT, 0.5);

            const name = TOWER_NAMES[this.built % TOWER_NAMES.length];
            this.built++;

            const box = this.add.rectangle(x, y, 40, 40, 0x16243a).setStrokeStyle(2, ACCENT);
            const label = this.add.text(x, y, name, {
                fontFamily: 'Arial Black', fontSize: 11, color: '#ff9900'
            }).setOrigin(0.5);

            box.setScale(0.4);
            label.setScale(0.4);
            this.tweens.add({ targets: [box, label], scale: 1, duration: 180, ease: 'Back.Out' });
        });
    }

    //  Data packets streaming down the trench, so the route reads as live.
    spawnPackets (path: Phaser.Curves.Path)
    {
        for (let i = 0; i < 6; i++)
        {
            const packet = this.add.follower(path, 0, 0, 'sparkle');
            packet.setTint(CYAN).setScale(1.6).setAlpha(0.7);
            packet.startFollow({
                duration: 9000,
                positionOnPath: true,
                repeat: -1,
                startAt: i / 6
            });
        }
    }

    drawHud ()
    {
        this.add.rectangle(512, 32, 1024, 64, 0x0d1727).setDepth(10);
        this.add.rectangle(512, 63, 1024, 2, ACCENT, 0.4).setDepth(10);

        this.add.text(16, 16, 'eu-tort-3', {
            fontFamily: 'Arial Black', fontSize: 20, color: '#e6edf3'
        }).setDepth(10);

        this.add.text(16, 40, 'DATA HALL 1  ·  AZ-C  ·  not on the status page', {
            fontFamily: 'Arial', fontSize: 12, color: '#5c728a'
        }).setDepth(10);

        this.budgetText = this.add.text(1014, 14, `$${this.budget}`, {
            fontFamily: 'Arial Black', fontSize: 22, color: '#ff9900'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(512, 22, 'WAVE 0  ·  INTEGRITY 100%', {
            fontFamily: 'Arial', fontSize: 16, color: '#8ea3b8'
        }).setOrigin(0.5, 0).setDepth(10);

        this.add.text(512, 44, 'click a slot to place  ·  ESC menu  ·  ENTER game over', {
            fontFamily: 'Arial', fontSize: 12, color: '#5c728a'
        }).setOrigin(0.5, 0).setDepth(10);
    }
}

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
const RED = 0xef4444;
const CYAN = 0x38bdf8;
const PAD_LINE = 0x2a3f5a;
const RACK = 0x0f1a2b;
const RACK_LIP = 0x27384f;
const VIOLET = 0xa855f7;

//  ── Towers ───────────────────────────────────────────────────────────────
//  SHIELD: rapid fire, tiny per-shot damage. Built to shred swarms, poor
//  against anything with real HP.
//  WAF: slow, expensive, huge per-shot damage. The answer to injection
//  flyers; wasted on the DDoS swarm because most of each shot is overkill.
type TowerKind = 'shield' | 'waf';

interface TowerSpec {
    kind: TowerKind;
    label: string;            // drawn on the tower box
    name: string;             // shown in the HUD picker
    cost: number;
    range: number;
    rate: number;             // ms between shots
    damage: number;
    bulletSpeed: number;      // px/sec — must outpace the fire rate
    bulletRadius: number;
    colour: number;
    hex: string;
}

const TOWER_SPECS: Record<TowerKind, TowerSpec> = {
    shield: {
        kind: 'shield', label: 'SHLD', name: 'SHIELD',
        cost: 100, range: 130, rate: 120, damage: 4,
        bulletSpeed: 780, bulletRadius: 2.5, colour: ACCENT, hex: '#ff9900'
    },
    waf: {
        kind: 'waf', label: 'WAF', name: 'WAF',
        cost: 175, range: 155, rate: 850, damage: 30,
        bulletSpeed: 620, bulletRadius: 5, colour: VIOLET, hex: '#a855f7'
    }
};

//  Selling a tower hands back half of what it cost.
const SELL_RATE = 0.5;
const refund = (spec: TowerSpec) => Math.floor(spec.cost * SELL_RATE);

//  ── Enemies ──────────────────────────────────────────────────────────────
//  DDoS: small, fragile, arrives in a flood. Individually harmless.
const DDOS_SPEED = 115;       // px/sec along the trench
const DDOS_HP = 12;           // +3 per wave
const DDOS_DAMAGE = 3;        // integrity lost if it reaches the origin
const DDOS_SCALE = 0.34;      // tortoise-ddos.png is 64x64 → ~22px on screen
const DDOS_BOUNTY = 8;

//  SQL injection: airborne, so it ignores the cable trench entirely and
//  wanders straight at the origin. Fat HP pool, hurts a lot on arrival.
const INJECT_SPEED = 100;     // px/sec through the air
const INJECT_HP = 90;         // +18 per wave
const INJECT_DAMAGE = 9;
const INJECT_SCALE = 0.52;
const INJECT_BOUNTY_MULT = 4; // paid as bounty x this
const INJECT_SPREAD = 78;     // degrees of random heading either side of "toward origin"
const INJECT_TURN_MIN = 220;  // ms before it picks a new heading
const INJECT_TURN_MAX = 640;
const INJECT_FIRST_WAVE = 2;  // no flyers in wave 1
const INJECT_SPACING = 1600;  // ms between flyers inside a wave

const SWARM_BASE = 8;         // mobs in wave 1
const SWARM_GROWTH = 2;       // extra mobs per wave
const SWARM_SPACING = 180;    // ms between mobs inside a wave
const WAVE_GAP = 6000;        // ms of quiet between waves

//  Where the flyers are headed — the front face of the origin rack.
const ORIGIN_X = 960;
const ORIGIN_ROW = 7;

//  ── Degradation ──────────────────────────────────────────────────────────
//  Every breach causes a temporary latency spike; each 10% of integrity lost
//  also trips a permanent tier below. See TIERS in applyTier().
const BASE_LATENCY = 38;      // ms shown in the HUD when healthy
const LATENCY_PENALTY = 1.7;  // tower cooldown multiplier while spiking
const SPIKE_MS = 1500;        // how long a spike lasts, grows with damage
const BROWNOUT_EVERY = 4000;  // ms between brownouts once they start
const BROWNOUT_MS = 900;      // how long a browned-out tower stays dark
const OFFLINE = 0x475569;

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

interface Enemy {
    //  PathFollower extends Sprite, so ground and air mobs share this field.
    obj: GameObjects.Sprite;
    follower?: GameObjects.PathFollower;   // only set for trench walkers
    flying: boolean;
    hp: number;
    maxHp: number;
    damage: number;                        // integrity cost of a breach
    bountyMult: number;
    barBg: GameObjects.Rectangle;
    bar: GameObjects.Rectangle;
    barW: number;
    shadow?: GameObjects.Ellipse;          // ground shadow, sells the flight
    vx: number;
    vy: number;
    turnAt: number;                        // scene time to pick a new heading
    alive: boolean;
}

interface Tower {
    x: number;
    y: number;
    spec: TowerSpec;
    cooldown: number;
    offline: boolean;
    sold: boolean;                      // stops queued brownouts touching it
    box: GameObjects.Rectangle;
    label: GameObjects.Text;
    pad: GameObjects.Rectangle;         // slot underneath, re-armed on sell
    ring: GameObjects.Arc;
}

interface Bullet {
    obj: GameObjects.Arc;
    target: Enemy;
    damage: number;
    speed: number;
}

export class Game extends Scene
{
    //  Run state
    budget = 500;
    integrity = 100;
    wave = 0;
    score = 0;
    over = false;

    //  Degradation state — all of this worsens as the origin takes damage.
    bounty = DDOS_BOUNTY;
    fireRateMult = 1;         // >1 means slower shots
    waveGap = WAVE_GAP;
    spikeMs = SPIKE_MS;
    spikeUntil = 0;           // scene time the current latency spike ends
    latency = BASE_LATENCY;   // displayed p99, tweened back down after a spike
    tiersHit = 0;

    //  Which tower the next click builds.
    selected: TowerKind = 'shield';

    //  Live objects
    enemies: Enemy[] = [];
    towers: Tower[] = [];
    bullets: Bullet[] = [];

    route: Phaser.Curves.Path;
    spawner: Phaser.Time.TimerEvent;
    brownoutTimer?: Phaser.Time.TimerEvent;
    spikeTween?: Phaser.Tweens.Tween;

    //  HUD
    budgetText: GameObjects.Text;
    waveText: GameObjects.Text;
    integrityText: GameObjects.Text;
    integrityBar: GameObjects.Rectangle;
    latencyText: GameObjects.Text;
    statusText: GameObjects.Text;
    vignette: GameObjects.Rectangle;
    pickers: Partial<Record<TowerKind, { box: GameObjects.Rectangle, text: GameObjects.Text }>> = {};

    constructor ()
    {
        super('Game');
    }

    //  Grid cell centre in pixels.
    cx (col: number) { return col * TILE + TILE / 2; }
    cy (row: number) { return FLOOR_Y + row * TILE + TILE / 2; }

    create ()
    {
        //  Scene restarts re-run create(), so reset everything by hand.
        this.budget = 500;
        this.integrity = 100;
        this.wave = 0;
        this.score = 0;
        this.over = false;
        this.enemies = [];
        this.towers = [];
        this.bullets = [];
        this.bounty = DDOS_BOUNTY;
        this.fireRateMult = 1;
        this.waveGap = WAVE_GAP;
        this.spikeMs = SPIKE_MS;
        this.spikeUntil = 0;
        this.latency = BASE_LATENCY;
        this.tiersHit = 0;
        this.brownoutTimer = undefined;
        this.selected = 'shield';
        this.pickers = {};

        this.add.rectangle(512, 384, 1024, 768, BG);

        this.drawFloor();
        this.route = this.drawRoute();
        this.drawIngress();
        this.drawOrigin();
        this.drawDecor();
        this.drawPads();
        this.drawHud();

        this.startWave();

        this.input.keyboard?.once('keydown-ESC', () => {
            this.scene.start('MainMenu');
        });

        this.input.keyboard?.on('keydown-ONE', () => this.select('shield'));
        this.input.keyboard?.on('keydown-TWO', () => this.select('waf'));
    }

    // ── Map ──────────────────────────────────────────────────────────────

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

        //  Integrity bar strapped to the front of the rack.
        this.add.rectangle(x, y + 102, 104, 10, 0x16243a).setStrokeStyle(1, RACK_LIP);
        this.integrityBar = this.add.rectangle(x - 50, y + 102, 100, 6, GREEN).setOrigin(0, 0.5);
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

        for (let col = 0; col < COLS; col++)
        {
            for (let row = 0; row < ROWS; row++)
            {
                if (occupied.has(`${col},${row}`)) continue;

                const touchesPath = onPath.has(`${col - 1},${row}`) || onPath.has(`${col + 1},${row}`)
                    || onPath.has(`${col},${row - 1}`) || onPath.has(`${col},${row + 1}`);

                if (touchesPath) this.makePad(col, row);
            }
        }
    }

    //  One buildable slot: hover shows the selected tower's range ring, click
    //  builds it.
    makePad (col: number, row: number)
    {
        const x = this.cx(col);
        const y = this.cy(row);

        const pad = this.add.rectangle(x, y, 46, 46)
            .setStrokeStyle(1, PAD_LINE, 0.9)
            .setInteractive({ useHandCursor: true });

        const ring = this.add.circle(x, y, TOWER_SPECS.shield.range, ACCENT, 0.07)
            .setStrokeStyle(1, ACCENT, 0.35)
            .setVisible(false);

        pad.on('pointerover', () => {
            //  Ring is re-styled on every hover because the pick can change
            //  between one hover and the next.
            const spec = TOWER_SPECS[this.selected];
            pad.setFillStyle(spec.colour, 0.16).setStrokeStyle(1, spec.colour, 0.9);
            ring.setRadius(spec.range);
            ring.setFillStyle(spec.colour, 0.07).setStrokeStyle(1, spec.colour, 0.35);
            ring.setVisible(true);
        });

        pad.on('pointerout', () => {
            pad.setFillStyle(BG, 0).setStrokeStyle(1, PAD_LINE, 0.9);
            ring.setVisible(false);
        });

        pad.on('pointerdown', () => {
            if (this.over) return;

            const spec = TOWER_SPECS[this.selected];

            if (this.budget < spec.cost)
            {
                //  Can't afford it — flash the budget red.
                this.budgetText.setColor('#ef4444');
                this.time.delayedCall(250, () => this.budgetText.setColor('#ff9900'));
                return;
            }

            this.budget -= spec.cost;
            this.budgetText.setText(`$${this.budget}`);

            pad.disableInteractive();
            pad.setFillStyle(BG, 0).setStrokeStyle(1, spec.colour, 0.4);
            ring.setVisible(false);

            //  The pad stays around underneath, disabled, so selling can hand
            //  the slot straight back.
            this.buildTower(x, y, spec, pad, ring);
        });
    }

    buildTower (x: number, y: number, spec: TowerSpec, pad: GameObjects.Rectangle, ring: GameObjects.Arc)
    {
        const box = this.add.rectangle(x, y, 40, 40, 0x16243a)
            .setStrokeStyle(2, spec.colour)
            .setDepth(4)
            .setInteractive({ useHandCursor: true });

        const label = this.add.text(x, y, spec.label, {
            fontFamily: 'Arial Black', fontSize: 11, color: spec.hex
        }).setOrigin(0.5).setDepth(4);

        box.setScale(0.4);
        label.setScale(0.4);
        this.tweens.add({ targets: [box, label], scale: 1, duration: 180, ease: 'Back.Out' });

        const tower: Tower = {
            x, y, spec, cooldown: 0, offline: false, sold: false, box, label, pad, ring
        };

        //  Hovering a built tower shows its real range and what it sells for.
        const tag = this.add.text(x, y - 32, `SELL +$${refund(spec)}`, {
            fontFamily: 'Arial Black', fontSize: 11, color: '#22c55e',
            backgroundColor: '#0b1120', padding: { x: 4, y: 2 }
        }).setOrigin(0.5).setDepth(11).setVisible(false);

        box.on('pointerover', () => {
            ring.setRadius(spec.range);
            ring.setFillStyle(spec.colour, 0.07).setStrokeStyle(1, spec.colour, 0.35);
            ring.setVisible(true);
            box.setStrokeStyle(2, GREEN);
            tag.setVisible(true);
        });

        box.on('pointerout', () => {
            ring.setVisible(false);
            box.setStrokeStyle(2, tower.offline ? OFFLINE : spec.colour);
            tag.setVisible(false);
        });

        box.on('pointerdown', () => {
            if (this.over || tower.sold) return;
            tag.destroy();
            this.sellTower(tower);
        });

        this.towers.push(tower);
    }

    //  Refund half the build cost and re-arm the pad underneath.
    sellTower (tower: Tower)
    {
        tower.sold = true;
        this.towers = this.towers.filter(t => t !== tower);

        this.budget += refund(tower.spec);
        this.budgetText.setText(`$${this.budget}`);

        //  Any bullet already in flight keeps going — it's paid for.
        const { x, y } = tower;
        tower.ring.setVisible(false);
        tower.box.destroy();
        tower.label.destroy();

        tower.pad.setInteractive({ useHandCursor: true });
        tower.pad.setFillStyle(BG, 0).setStrokeStyle(1, PAD_LINE, 0.9);

        const refundText = this.add.text(x, y - 24, `+$${refund(tower.spec)}`, {
            fontFamily: 'Arial Black', fontSize: 13, color: '#22c55e'
        }).setOrigin(0.5).setDepth(11);

        this.tweens.add({
            targets: refundText, y: y - 56, alpha: 0, duration: 700,
            onComplete: () => refundText.destroy()
        });
    }

    //  Change which tower the next click builds.
    select (kind: TowerKind)
    {
        this.selected = kind;

        for (const k of Object.keys(TOWER_SPECS) as TowerKind[])
        {
            const picker = this.pickers[k];
            if (!picker) continue;

            const spec = TOWER_SPECS[k];
            const on = k === kind;

            picker.box.setStrokeStyle(on ? 2 : 1, spec.colour, on ? 1 : 0.35);
            picker.box.setFillStyle(spec.colour, on ? 0.18 : 0);
            picker.text.setColor(on ? spec.hex : '#5c728a');
        }
    }

    // ── Combat ───────────────────────────────────────────────────────────

    //  Waves arrive as a burst of closely-spaced mobs, then a quiet gap.
    startWave ()
    {
        if (this.over) return;

        this.wave++;

        const count = SWARM_BASE + (this.wave - 1) * SWARM_GROWTH;
        const flyers = this.wave < INJECT_FIRST_WAVE
            ? 0
            : 1 + Math.floor((this.wave - INJECT_FIRST_WAVE) / 2);

        this.waveText.setText(flyers > 0
            ? `WAVE ${this.wave}  ·  DDoS x${count}  ·  SQLi x${flyers}`
            : `WAVE ${this.wave}  ·  DDoS FLOOD  x${count}`);

        this.time.addEvent({
            delay: SWARM_SPACING,
            repeat: count - 1,
            callback: () => this.spawnDdos()
        });

        if (flyers > 0)
        {
            this.time.addEvent({
                delay: INJECT_SPACING,
                repeat: flyers - 1,
                callback: () => this.spawnInjection()
            });
        }

        //  Next wave starts once the longer of the two bursts has landed, plus
        //  the current gap, which the degradation tiers shorten as the origin
        //  takes damage.
        const burst = Math.max(count * SWARM_SPACING, flyers * INJECT_SPACING);

        this.spawner = this.time.delayedCall(burst + this.waveGap, () => this.startWave());
    }

    //  Register a mob and hand it back, so callers can wire up callbacks that
    //  close over it.
    addEnemy (enemy: Enemy)
    {
        this.enemies.push(enemy);
        return enemy;
    }

    spawnDdos ()
    {
        if (this.over) return;

        const maxHp = DDOS_HP + (this.wave - 1) * 3;
        const start = this.route.getStartPoint();
        const obj = this.add.follower(this.route, start.x, start.y, 'tortoise-ddos')
            .setDepth(5)
            .setScale(DDOS_SCALE);

        const barBg = this.add.rectangle(0, 0, 20, 4, 0x000000, 0.6).setDepth(6);
        const bar = this.add.rectangle(0, 0, 18, 2, RED).setOrigin(0, 0.5).setDepth(6);

        const enemy = this.addEnemy({
            obj, follower: obj, flying: false,
            hp: maxHp, maxHp, damage: DDOS_DAMAGE, bountyMult: 1,
            barBg, bar, barW: 18,
            vx: 0, vy: 0, turnAt: 0, alive: true
        });

        obj.startFollow({
            duration: (this.route.getLength() / DDOS_SPEED) * 1000,
            positionOnPath: true,
            //  The art faces right, which matches 0 degrees, so no offset needed.
            rotateToPath: true,
            onComplete: () => this.breach(enemy)
        });

        //  Scuttle: a small pulse around the base scale, not an absolute one.
        this.tweens.add({
            targets: obj,
            scale: DDOS_SCALE * 1.12,
            duration: 380,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
    }

    //  SQL injection flyer. No path — it enters anywhere down the left edge
    //  and wanders toward the origin, re-rolling its heading every few hundred
    //  ms, so no fixed set of pads can cover it. update() drives it.
    spawnInjection ()
    {
        if (this.over) return;

        const maxHp = INJECT_HP + (this.wave - 1) * 18;
        const y = PhaserMath.Between(FLOOR_Y + 60, 768 - 60);

        const obj = this.add.sprite(-40, y, 'tortoise-injection')
            .setDepth(8)
            .setScale(INJECT_SCALE);

        const shadow = this.add.ellipse(-40, y + 22, 34, 12, 0x000000, 0.3).setDepth(7);

        const barBg = this.add.rectangle(0, 0, 34, 5, 0x000000, 0.6).setDepth(9);
        const bar = this.add.rectangle(0, 0, 32, 3, VIOLET).setOrigin(0, 0.5).setDepth(9);

        this.addEnemy({
            obj, flying: true,
            hp: maxHp, maxHp, damage: INJECT_DAMAGE, bountyMult: INJECT_BOUNTY_MULT,
            barBg, bar, barW: 32, shadow,
            vx: INJECT_SPEED, vy: 0, turnAt: 0, alive: true
        });

        //  Wing-beat wobble. Flyers do not scuttle.
        this.tweens.add({
            targets: obj,
            scaleY: INJECT_SCALE * 0.84,
            duration: 220,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });

        this.tweens.add({
            targets: shadow,
            scaleX: 0.75,
            alpha: 0.18,
            duration: 220,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
    }

    //  Re-roll a flyer's heading: biased at the origin, but with enough random
    //  spread that the actual route is never the same twice.
    steer (enemy: Enemy)
    {
        const toOrigin = PhaserMath.Angle.Between(
            enemy.obj.x, enemy.obj.y, ORIGIN_X, this.cy(ORIGIN_ROW)
        );

        const spread = PhaserMath.DegToRad(INJECT_SPREAD);
        const angle = toOrigin + PhaserMath.FloatBetween(-spread, spread);

        enemy.vx = Math.cos(angle) * INJECT_SPEED;
        enemy.vy = Math.sin(angle) * INJECT_SPEED;
        enemy.turnAt = this.time.now + PhaserMath.Between(INJECT_TURN_MIN, INJECT_TURN_MAX);
    }

    //  Enemy reached the origin server.
    breach (enemy: Enemy)
    {
        if (!enemy.alive || this.over) return;

        const { x, y } = enemy.obj;
        const damage = enemy.damage;
        this.killEnemy(enemy, false);

        this.integrity = Math.max(0, this.integrity - damage);
        this.integrityText.setText(`INTEGRITY ${this.integrity}%`);
        this.integrityText.setColor(this.integrity <= 30 ? '#ef4444' : '#8ea3b8');
        this.integrityBar.width = this.integrity;
        this.integrityBar.setFillStyle(this.integrity <= 30 ? RED : this.integrity <= 60 ? ACCENT : GREEN);

        //  A flyer landing on the origin is a much bigger event than one more
        //  packet in the flood.
        const heavy = damage >= INJECT_DAMAGE;
        this.cameras.main.shake(heavy ? 320 : 180, heavy ? 0.012 : 0.006);
        this.cameras.main.flash(120, 239, 68, 68);

        //  Floating damage readout.
        const hit = this.add.text(x, y - 30, `-${damage}% INTEGRITY`, {
            fontFamily: 'Arial Black', fontSize: 13, color: '#ef4444'
        }).setOrigin(0.5).setDepth(9);

        this.tweens.add({
            targets: hit, y: y - 70, alpha: 0, duration: 900, onComplete: () => hit.destroy()
        });

        if (this.integrity <= 0)
        {
            this.fail();
            return;
        }

        this.latencySpike();
        this.applyTiers();
    }

    // ── Damage side effects ──────────────────────────────────────────────

    //  Every breach: the region gets slow for a moment. Towers fire late and
    //  the p99 readout jumps, then eases back to the new baseline.
    latencySpike ()
    {
        const peak = 180 + (100 - this.integrity) * 6;

        //  A second breach mid-spike would otherwise fight over the readout.
        this.spikeTween?.remove();

        this.spikeUntil = this.time.now + this.spikeMs;
        this.latency = peak;
        this.latencyText.setColor('#ef4444');
        this.latencyText.setText(`p99 ${Math.round(peak)}ms  ·  SPIKE`);

        //  Ease the number back down over the life of the spike.
        this.spikeTween = this.tweens.addCounter({
            from: peak,
            to: BASE_LATENCY + (100 - this.integrity) * 1.5,
            duration: this.spikeMs,
            ease: 'Cubic.Out',
            onUpdate: tween => {
                this.latency = tween.getValue() ?? BASE_LATENCY;
                this.latencyText.setText(`p99 ${Math.round(this.latency)}ms  ·  SPIKE`);
            },
            onComplete: () => {
                this.latencyText.setColor('#5c728a');
                this.latencyText.setText(`p99 ${Math.round(this.latency)}ms`);
            }
        });
    }

    //  One permanent tier per 10% of integrity lost.
    applyTiers ()
    {
        const tiers: { at: number, run: () => void }[] = [
            { at: 90, run: () => { this.setStatus('DEGRADED', '#ff9900'); this.spikeMs = 2500; } },
            { at: 80, run: () => this.killPowerDomain(12, 0, 4, 3, 'PWR-A') },
            { at: 70, run: () => { this.bounty = 6; this.flashHud('BILLING THROTTLED  ·  BOUNTY $6'); } },
            { at: 60, run: () => { this.setStatus('IMPAIRED', '#f97316'); this.setWaveGap(4500); } },
            { at: 50, run: () => { this.fireRateMult = 1.1; this.flashHud('COOLING LOSS  ·  TOWERS -10% RATE'); } },
            { at: 40, run: () => { this.killPowerDomain(0, 8, 4, 3, 'PWR-B'); this.spikeMs = 4000; } },
            { at: 30, run: () => { this.setStatus('CRITICAL', '#ef4444'); this.startVignette(); this.setWaveGap(3000); } },
            { at: 20, run: () => { this.startBrownouts(); this.flashHud('BROWNOUTS  ·  TOWERS DROPPING'); } },
            { at: 10, run: () => { this.fireRateMult = 1.2; this.setWaveGap(1500); this.flashHud('REGION FAILING'); } }
        ];

        //  tiersHit counts how many have fired, so each one runs exactly once
        //  even if a future enemy deals more than 10% in a single breach.
        while (this.tiersHit < tiers.length && this.integrity <= tiers[this.tiersHit].at)
        {
            tiers[this.tiersHit].run();
            this.tiersHit++;
        }
    }

    setStatus (label: string, colour: string)
    {
        this.statusText.setText(label);
        this.statusText.setColor(colour);

        this.tweens.add({
            targets: this.statusText, alpha: 0.2, duration: 160, yoyo: true, repeat: 3
        });
    }

    //  A rack region loses power: dimmed tiles and an offline label.
    killPowerDomain (col: number, row: number, w: number, h: number, name: string)
    {
        const x = col * TILE;
        const y = FLOOR_Y + row * TILE;

        const shroud = this.add.rectangle(x, y, w * TILE, h * TILE, 0x000000, 0)
            .setOrigin(0, 0)
            .setDepth(3);

        const label = this.add.text(x + w * TILE / 2, y + h * TILE / 2, `${name}\nOFFLINE`, {
            fontFamily: 'Arial Black', fontSize: 14, color: '#ef4444', align: 'center'
        }).setOrigin(0.5).setDepth(3).setAlpha(0);

        this.tweens.add({ targets: shroud, fillAlpha: 0.62, duration: 500 });
        this.tweens.add({ targets: label, alpha: 0.75, duration: 500, delay: 200 });
    }

    //  Red edge pulse once the region is critical.
    startVignette ()
    {
        this.vignette = this.add.rectangle(512, 384, 1016, 760)
            .setStrokeStyle(10, RED, 0.5)
            .setDepth(9);

        this.tweens.add({
            targets: this.vignette, alpha: 0.25, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut'
        });
    }

    //  Random towers drop offline for a moment.
    startBrownouts ()
    {
        this.brownoutTimer = this.time.addEvent({
            delay: BROWNOUT_EVERY,
            loop: true,
            callback: () => {
                if (this.over || this.towers.length === 0) return;

                const live = this.towers.filter(t => !t.offline);
                if (live.length === 0) return;

                const t = PhaserMath.RND.pick(live);
                t.offline = true;
                t.box.setStrokeStyle(2, OFFLINE);
                t.label.setColor('#475569');

                this.time.delayedCall(BROWNOUT_MS, () => {
                    //  It may have been sold out from under us mid-brownout.
                    if (t.sold) return;

                    t.offline = false;
                    t.box.setStrokeStyle(2, t.spec.colour);
                    t.label.setColor(t.spec.hex);
                });
            }
        });
    }

    //  Only affects the next gap — it never interrupts a wave in flight.
    setWaveGap (ms: number)
    {
        this.waveGap = ms;
    }

    //  Brief banner under the HUD when a tier trips.
    flashHud (message: string)
    {
        const banner = this.add.text(512, 92, message, {
            fontFamily: 'Arial Black', fontSize: 16, color: '#ef4444',
            backgroundColor: '#1a0d0d', padding: { x: 12, y: 6 }
        }).setOrigin(0.5).setDepth(11);

        this.tweens.add({
            targets: banner, alpha: 0, delay: 1600, duration: 500, onComplete: () => banner.destroy()
        });
    }

    killEnemy (enemy: Enemy, reward: boolean)
    {
        enemy.alive = false;
        enemy.follower?.stopFollow();
        this.tweens.killTweensOf(enemy.obj);
        enemy.obj.destroy();
        enemy.barBg.destroy();
        enemy.bar.destroy();

        if (enemy.shadow)
        {
            this.tweens.killTweensOf(enemy.shadow);
            enemy.shadow.destroy();
        }

        if (!reward) return;

        this.score += 10 * enemy.bountyMult;
        this.budget += this.bounty * enemy.bountyMult;
        this.budgetText.setText(`$${this.budget}`);
    }

    fire (tower: Tower, target: Enemy)
    {
        const spec = tower.spec;
        const bullet = this.add.circle(tower.x, tower.y, spec.bulletRadius, spec.colour).setDepth(6);

        //  The WAF slug is slow and fat, so give it a muzzle flash to read as a
        //  heavy shot rather than a laggy one.
        if (spec.kind === 'waf')
        {
            const flash = this.add.circle(tower.x, tower.y, 12, spec.colour, 0.5).setDepth(5);
            this.tweens.add({
                targets: flash, scale: 1.8, alpha: 0, duration: 180, onComplete: () => flash.destroy()
            });
        }

        this.bullets.push({ obj: bullet, target, damage: spec.damage, speed: spec.bulletSpeed });
    }

    nearestEnemy (x: number, y: number, range: number): Enemy | null
    {
        let best: Enemy | null = null;
        let bestDist = range;

        for (const e of this.enemies)
        {
            if (!e.alive) continue;

            const d = PhaserMath.Distance.Between(x, y, e.obj.x, e.obj.y);
            if (d <= bestDist)
            {
                bestDist = d;
                best = e;
            }
        }

        return best;
    }

    //  Origin integrity hit zero.
    fail ()
    {
        this.over = true;
        this.spawner.remove();

        for (const e of this.enemies) if (e.alive) e.follower?.pauseFollow();

        this.cameras.main.shake(400, 0.012);
        this.time.delayedCall(600, () => this.scene.start('GameOver', { score: this.score }));
    }

    update (_time: number, delta: number)
    {
        if (this.over) return;

        const dt = delta / 1000;

        //  Flyers move themselves — no path, so this is their whole AI.
        for (const e of this.enemies)
        {
            if (!e.alive || !e.flying) continue;

            if (this.time.now >= e.turnAt) this.steer(e);

            e.obj.x += e.vx * dt;
            e.obj.y += e.vy * dt;

            //  Keep them inside the data hall, bouncing off the floor edges.
            if (e.obj.y < FLOOR_Y + 24) { e.obj.y = FLOOR_Y + 24; e.vy = Math.abs(e.vy); }
            if (e.obj.y > 768 - 24) { e.obj.y = 768 - 24; e.vy = -Math.abs(e.vy); }
            if (e.obj.x < 8 && e.vx < 0) { e.obj.x = 8; e.vx = Math.abs(e.vx); }

            //  Art faces right, so heading maps straight onto rotation.
            e.obj.rotation = Math.atan2(e.vy, e.vx);
            e.shadow?.setPosition(e.obj.x, e.obj.y + 22);

            if (e.obj.x >= ORIGIN_X - 56) this.breach(e);
        }

        //  Health bars ride along above each enemy.
        for (const e of this.enemies)
        {
            if (!e.alive) continue;

            const by = e.obj.y - (e.flying ? 26 : 18);
            e.barBg.setPosition(e.obj.x, by);
            e.bar.setPosition(e.obj.x - e.barW / 2, by);
            e.bar.width = e.barW * (e.hp / e.maxHp);
        }

        //  Towers acquire the closest target in range and shoot on cooldown.
        //  Cooldown is stretched by cooling loss and by any active latency spike.
        const spiking = this.time.now < this.spikeUntil;
        const penalty = this.fireRateMult * (spiking ? LATENCY_PENALTY : 1);

        for (const t of this.towers)
        {
            if (t.offline) continue;

            t.cooldown -= delta;
            if (t.cooldown > 0) continue;

            const target = this.nearestEnemy(t.x, t.y, t.spec.range);
            if (!target) continue;

            t.cooldown = t.spec.rate * penalty;
            this.fire(t, target);
        }

        //  Homing bullets.
        for (const b of this.bullets)
        {
            if (!b.target.alive)
            {
                b.obj.destroy();
                continue;
            }

            const step = b.speed * dt;
            const tx = b.target.obj.x;
            const ty = b.target.obj.y;
            const d = PhaserMath.Distance.Between(b.obj.x, b.obj.y, tx, ty);

            if (d <= step + 6)
            {
                this.hit(b.target, b.damage);
                b.obj.destroy();
                continue;
            }

            const angle = PhaserMath.Angle.Between(b.obj.x, b.obj.y, tx, ty);
            b.obj.x += Math.cos(angle) * step;
            b.obj.y += Math.sin(angle) * step;
        }

        this.bullets = this.bullets.filter(b => b.obj.active);
        this.enemies = this.enemies.filter(e => e.alive);
    }

    hit (enemy: Enemy, damage: number)
    {
        if (!enemy.alive) return;

        enemy.hp -= damage;

        if (enemy.hp <= 0)
        {
            const { x, y } = enemy.obj;
            const flying = enemy.flying;
            this.killEnemy(enemy, true);

            const pop = this.add.circle(x, y, flying ? 12 : 6, flying ? VIOLET : ACCENT).setDepth(6);
            this.tweens.add({
                targets: pop, scale: 3, alpha: 0, duration: flying ? 340 : 220,
                onComplete: () => pop.destroy()
            });
            return;
        }

        //  A spark per hit rather than a tint flash — at this fire rate a flash
        //  would leave the mob white for most of its short life.
        const spark = this.add.circle(enemy.obj.x, enemy.obj.y, 3, 0xffffff, 0.9).setDepth(7);
        this.tweens.add({
            targets: spark, alpha: 0, scale: 0.4, duration: 110, onComplete: () => spark.destroy()
        });
    }

    // ── HUD ──────────────────────────────────────────────────────────────

    drawHud ()
    {
        this.add.rectangle(512, 32, 1024, 64, 0x0d1727).setDepth(10);
        this.add.rectangle(512, 63, 1024, 2, ACCENT, 0.4).setDepth(10);

        this.add.text(16, 16, 'eu-tort-3', {
            fontFamily: 'Arial Black', fontSize: 20, color: '#e6edf3'
        }).setDepth(10);

        this.add.text(16, 40, 'DATA HALL 1  ·  AZ-C', {
            fontFamily: 'Arial', fontSize: 12, color: '#5c728a'
        }).setDepth(10);

        this.budgetText = this.add.text(1014, 12, `$${this.budget}`, {
            fontFamily: 'Arial Black', fontSize: 22, color: '#ff9900'
        }).setOrigin(1, 0).setDepth(10);

        this.makePicker('shield', 728, '1');
        this.makePicker('waf', 872, '2');
        this.select('shield');

        this.waveText = this.add.text(512, 12, 'WAVE 1  ·  DDoS FLOOD', {
            fontFamily: 'Arial', fontSize: 16, color: '#8ea3b8'
        }).setOrigin(0.5, 0).setDepth(10);

        this.integrityText = this.add.text(512, 34, 'INTEGRITY 100%', {
            fontFamily: 'Arial Black', fontSize: 14, color: '#8ea3b8'
        }).setOrigin(0.5, 0).setDepth(10);

        this.add.text(512, 52, 'click a slot to build  ·  click a tower to sell  ·  ESC menu', {
            fontFamily: 'Arial', fontSize: 11, color: '#5c728a'
        }).setOrigin(0.5, 0).setDepth(10);

        this.statusText = this.add.text(300, 14, 'HEALTHY', {
            fontFamily: 'Arial Black', fontSize: 16, color: '#22c55e'
        }).setOrigin(0.5, 0).setDepth(10);

        this.latencyText = this.add.text(300, 40, `p99 ${BASE_LATENCY}ms`, {
            fontFamily: 'Arial', fontSize: 12, color: '#5c728a'
        }).setOrigin(0.5, 0).setDepth(10);
    }

    //  One HUD build button. Clicking it, or pressing its number, arms that
    //  tower for the next pad click.
    makePicker (kind: TowerKind, x: number, key: string)
    {
        const spec = TOWER_SPECS[kind];

        const box = this.add.rectangle(x, 32, 132, 40)
            .setStrokeStyle(1, spec.colour, 0.35)
            .setDepth(10)
            .setInteractive({ useHandCursor: true });

        const text = this.add.text(x, 25, `${key}  ${spec.name}  $${spec.cost}`, {
            fontFamily: 'Arial Black', fontSize: 12, color: '#5c728a'
        }).setOrigin(0.5).setDepth(11);

        this.add.text(x, 41, `${spec.damage} dmg  ·  ${(1000 / spec.rate).toFixed(1)}/s`, {
            fontFamily: 'Arial', fontSize: 10, color: '#5c728a'
        }).setOrigin(0.5).setDepth(11);

        box.on('pointerdown', () => this.select(kind));

        this.pickers[kind] = { box, text };
    }
}

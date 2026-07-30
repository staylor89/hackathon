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
const ICE = 0x67e8f9;

//  ── Towers ───────────────────────────────────────────────────────────────
//  IAM: the starter. Cheap, middling everything, and the only tower that can
//  target a cloaked shinobi — identity checks see through the disguise.
//  SHIELD: rapid fire, tiny per-shot damage. Built to shred swarms, poor
//  against anything with real HP.
//  WAF: slow, expensive, huge per-shot damage. The answer to injection
//  flyers; wasted on the DDoS swarm because most of each shot is overkill.
//  SNOWMOBILE: the late-game money sink. Fires an instant ice lance instead
//  of a bullet — enormous damage, once every few seconds, and it punches
//  through everything standing in the line, so it pays off best aimed down a
//  long straight of the trench. Terrible value against anything it one-shots.
//
//  unlock is a one-off purchase per run before the tower can be built at all.
//  IAM starts unlocked so wave 1 is always playable.
type TowerKind = 'iam' | 'shield' | 'waf' | 'snowmobile';

interface TowerSpec {
    kind: TowerKind;
    texture: string;          // 64x64 emplacement art, drawn at scale 1
    name: string;             // shown in the HUD picker
    unlock: number;           // one-off cost to make it buildable
    cost: number;             // per-tower build cost
    range: number;
    rate: number;             // ms between shots
    damage: number;
    bulletSpeed: number;      // px/sec — must outpace the fire rate
    bulletRadius: number;
    seesCloaked: boolean;
    beam?: boolean;           // hits instantly along a line instead of firing a bullet
    colour: number;
    hex: string;
    fireSfx: string;
    fireGap: number;          // ms floor between plays of fireSfx, across all
                              // towers of this kind — see sfx()
    fireVolume: number;
}

const TOWER_SPECS: Record<TowerKind, TowerSpec> = {
    iam: {
        kind: 'iam', texture: 'tower-iam', name: 'IAM',
        unlock: 0, cost: 70, range: 120, rate: 340, damage: 9,
        bulletSpeed: 700, bulletRadius: 3, seesCloaked: true,
        colour: CYAN, hex: '#38bdf8',
        fireSfx: 'sfx-iam-fire', fireGap: 70, fireVolume: 0.85
    },
    shield: {
        kind: 'shield', texture: 'tower-shield', name: 'SHIELD',
        unlock: 200, cost: 120, range: 130, rate: 120, damage: 4,
        bulletSpeed: 780, bulletRadius: 2.5, seesCloaked: false,
        colour: ACCENT, hex: '#ff9900',
        //  Fires every 120ms per tower and there can be a dozen of them, so the
        //  gap is most of the fire rate: at full board only about 1 shot in 6
        //  is actually audible, which is the difference between a weapon and
        //  white noise.
        fireSfx: 'sfx-shield-fire', fireGap: 100, fireVolume: 0.7
    },
    waf: {
        kind: 'waf', texture: 'tower-waf', name: 'WAF',
        unlock: 350, cost: 200, range: 155, rate: 850, damage: 30,
        bulletSpeed: 620, bulletRadius: 5, seesCloaked: false,
        colour: VIOLET, hex: '#a855f7',
        fireSfx: 'sfx-waf-fire', fireGap: 60, fireVolume: 1
    },
    snowmobile: {
        kind: 'snowmobile', texture: 'tower-snowmobile', name: 'SNOWMOBILE',
        unlock: 750, cost: 420, range: 200, rate: 4000, damage: 300,
        //  Beam towers hit instantly, so the bullet fields go unused.
        bulletSpeed: 0, bulletRadius: 0, seesCloaked: false, beam: true,
        colour: ICE, hex: '#67e8f9',
        //  720ms of discharge every 2.8s, so nothing needs throttling and it
        //  can sit loud — one of these firing should be the loudest thing on
        //  the board.
        fireSfx: 'sfx-snowmobile-fire', fireGap: 0, fireVolume: 1
    }
};

const TOWER_ORDER: TowerKind[] = ['iam', 'shield', 'waf', 'snowmobile'];

//  Half the width of the ice lance: anything within this of the line takes the
//  full hit, and the beam carries on past its target to the edge of range.
const BEAM_HALF_WIDTH = 16;
const BEAM_OVERSHOOT = 44;

//  Text budget inside a HUD build button, and for the wave composition line.
//  Both are fitText()'d because their content varies — see fitText().
const PICKER_TEXT_W = 80;
const WAVE_TEXT_W = 250;

//  Selling a tower hands back half of what it cost.
const SELL_RATE = 0.5;
const refund = (spec: TowerSpec) => Math.floor(spec.cost * SELL_RATE);

//  ── Enemies ──────────────────────────────────────────────────────────────
//  Shinobi (the default mob): walks the trench, but every couple of seconds it
//  throws smoke and dashes — cloaked, so only IAM can shoot it, and moving at
//  several times its normal speed. Present in every wave from wave 1.
const NINJA_SPEED = 88;       // px/sec along the trench
const NINJA_HP = 26;          // +7 per wave
const NINJA_DAMAGE = 4;
const NINJA_SCALE = 0.72;     // README asks for ~48px on screen
const NINJA_BOUNTY_MULT = 2;
const NINJA_CLOAK_EVERY = 2400;   // ms between dashes
const NINJA_CLOAK_MS = 700;       // how long each dash lasts
const NINJA_DASH_MULT = 2.4;      // path speed multiplier while dashing
const NINJA_CLOAK_ALPHA = 0.28;

const NINJA_BASE = 4;         // shinobi in wave 1
const NINJA_GROWTH = 1;       // extra per wave
const NINJA_SPACING = 1500;   // ms between shinobi inside a wave

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
const INJECT_FIRST_WAVE = 3;  // flyers join in wave 3
const INJECT_SPACING = 2200;  // ms between flyers inside a wave

//  Leatherback tank: the boss. Crawls, soaks an enormous amount of damage, and
//  takes a quarter of the origin with it if it lands. Every fifth wave only.
const TANK_EVERY = 5;         // boss wave cadence
const TANK_SPEED = 30;        // px/sec — a crawl; nearly a minute end to end
const TANK_HP = 420;          // +140 per wave
const TANK_DAMAGE = 25;       // integrity lost if it reaches the origin
const TANK_SCALE = 0.84;      // 96x96 art → ~80px on screen, per the README
const TANK_BOUNTY_MULT = 12;
const TANK_SPACING = 3200;    // ms between tanks once there is more than one

const DDOS_FIRST_WAVE = 2;    // the flood joins in wave 2
const SWARM_BASE = 6;         // mobs in the first flood wave
const SWARM_GROWTH = 2;       // extra mobs per wave
const SWARM_SPACING = 260;    // ms between mobs inside a wave
const WAVE_GAP = 10000;       // ms of quiet between waves
const PREP_MS = 15000;        // build phase before wave 1 lands

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

//  Second HUD line. Rewritten on mute so the state is visible while presenting.
const HINT = 'DATA HALL 1  ·  AZ-C  ·  CLICK PAD BUILD  ·  CLICK TOWER SELL  ·  ESC MENU  ·  M MUTE  ·  ` DEBUG';
const HINT_W = 500;          // fitText() budget — it must not reach the build buttons

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
    boss: boolean;
    hp: number;
    maxHp: number;
    damage: number;                        // integrity cost of a breach
    bountyMult: number;
    barBg: GameObjects.Rectangle;
    bar: GameObjects.Rectangle;
    barW: number;
    barOffset: number;                     // px above the sprite, scales with art
    shadow?: GameObjects.Ellipse;          // ground shadow, sells the flight
    vx: number;
    vy: number;
    turnAt: number;                        // scene time to pick a new heading
    cloaked: boolean;                      // only IAM can target it right now
    cloakAt: number;                       // scene time of the next smoke dash
    uncloakAt: number;                     // scene time the current dash ends
    alive: boolean;
}

interface Tower {
    x: number;
    y: number;
    spec: TowerSpec;
    cooldown: number;
    offline: boolean;
    sold: boolean;                      // stops queued brownouts touching it
    sprite: GameObjects.Image;          // state is expressed by tinting this
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

    //  Which tower the next click builds, and which are bought at all.
    selected: TowerKind = 'iam';
    unlocked: Record<TowerKind, boolean> = { iam: true, shield: false, waf: false, snowmobile: false };

    //  Live objects
    enemies: Enemy[] = [];
    towers: Tower[] = [];
    bullets: Bullet[] = [];

    //  Wave clock. burstEndsAt is when the last mob of the current wave has
    //  spawned; between that and nextWaveAt the HUD counts down instead of
    //  listing the composition.
    waveLabel = '';
    burstEndsAt = 0;
    nextWaveAt = 0;
    lastWaveText = '';

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
    hintText: GameObjects.Text;
    vignette: GameObjects.Rectangle;
    debugPanel?: GameObjects.Container;
    pickers: Partial<Record<TowerKind, {
        box: GameObjects.Rectangle,
        icon: GameObjects.Image,
        text: GameObjects.Text,
        sub: GameObjects.Text,      // stat line, or the unlock price while locked
        stats: string
    }>> = {};

    constructor ()
    {
        super('Game');
    }

    //  Grid cell centre in pixels.
    cx (col: number) { return col * TILE + TILE / 2; }
    cy (row: number) { return FLOOR_Y + row * TILE + TILE / 2; }

    // ── Sound ────────────────────────────────────────────────────────────

    //  Scene time each key was last heard, so a key can refuse to retrigger.
    sfxAt: Record<string, number> = {};

    //  Every sound goes through here rather than this.sound.play() directly,
    //  for two reasons.
    //
    //  minGap drops a play outright if the same key sounded too recently. By
    //  mid-game there are 50+ shots a second on the board and Web Audio will
    //  happily mix all of them into mush; dropping the surplus costs nothing
    //  perceptually because nobody can pick out individual shots at that rate.
    //
    //  jitter detunes each play a little. Without it, identical samples stack
    //  phase-coherently and read as one smeared tone instead of many shots.
    sfx (key: string, opts: { volume?: number, minGap?: number, jitter?: number } = {})
    {
        const { volume = 1, minGap = 0, jitter = 0.06 } = opts;

        if (minGap > 0)
        {
            if (this.time.now - (this.sfxAt[key] ?? -Infinity) < minGap) return;
            this.sfxAt[key] = this.time.now;
        }

        this.sound.play(key, {
            volume,
            rate: 1 + (Math.random() * 2 - 1) * jitter
        });
    }

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
        this.selected = 'iam';
        this.unlocked = { iam: true, shield: false, waf: false, snowmobile: false };
        this.pickers = {};
        this.waveLabel = '';
        this.burstEndsAt = 0;
        this.nextWaveAt = 0;
        this.lastWaveText = '';
        this.sfxAt = {};

        this.add.image(512, 384, 'background');

        this.drawFloor();
        this.route = this.drawRoute();
        this.drawIngress();
        this.drawOrigin();
        this.drawDecor();
        this.drawPads();
        this.drawHud();
        this.buildDebugMenu();

        //  Build phase: nothing spawns until the player has had time to spend
        //  the opening budget.
        this.nextWaveAt = this.time.now + PREP_MS;
        this.spawner = this.time.delayedCall(PREP_MS, () => this.startWave());
        this.flashHud('BUILD PHASE  ·  SPEND YOUR BUDGET', '#38bdf8');

        this.input.keyboard?.once('keydown-ESC', () => {
            this.scene.start('MainMenu');
        });

        this.input.keyboard?.on('keydown-ONE', () => this.pick('iam'));
        this.input.keyboard?.on('keydown-TWO', () => this.pick('shield'));
        this.input.keyboard?.on('keydown-THREE', () => this.pick('waf'));
        this.input.keyboard?.on('keydown-FOUR', () => this.pick('snowmobile'));

        //  Demoing this in a room full of people needs a kill switch. mute is
        //  on the global SoundManager, so it survives a scene restart.
        this.input.keyboard?.on('keydown-M', () => {
            this.sound.mute = !this.sound.mute;
            this.showHint();
        });

        //  Backtick is the conventional console key, but it is awkward on some
        //  layouts, so D opens the same panel.
        this.input.keyboard?.on('keydown-BACKTICK', () => this.toggleDebug());
        this.input.keyboard?.on('keydown-D', () => this.toggleDebug());
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

                //  Partial alpha: bg.png is opaque, so solid panels would hide
                //  the VPC and availability-zone structure baked into it.
                g.fillStyle((col + row) % 2 === 0 ? FLOOR : FLOOR_ALT, 0.55);
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
                this.rejectPurchase();
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
        //  The art is a 64x64 emplacement on a 50x50 baseplate, so it drops
        //  onto a 64px grid tile at scale 1 — no fitting, no label needed.
        const sprite = this.add.image(x, y, spec.texture)
            .setDepth(4)
            .setInteractive({ useHandCursor: true });

        sprite.setScale(0.4);
        this.tweens.add({ targets: sprite, scale: 1, duration: 180, ease: 'Back.Out' });

        this.sfx('sfx-tower-build');

        const tower: Tower = {
            x, y, spec, cooldown: 0, offline: false, sold: false, sprite, pad, ring
        };

        //  Hovering a built tower shows its real range and what it sells for.
        const tag = this.add.text(x, y - 40, `SELL +$${refund(spec)}`, {
            fontFamily: 'Arial Black', fontSize: 11, color: '#22c55e',
            backgroundColor: '#0b1120', padding: { x: 4, y: 2 }
        }).setOrigin(0.5).setDepth(11).setVisible(false);

        sprite.on('pointerover', () => {
            ring.setRadius(spec.range);
            ring.setFillStyle(spec.colour, 0.07).setStrokeStyle(1, spec.colour, 0.35);
            ring.setVisible(true);
            sprite.setTint(0x86efac);
            tag.setVisible(true);
        });

        sprite.on('pointerout', () => {
            ring.setVisible(false);
            this.paintTower(tower);
            tag.setVisible(false);
        });

        sprite.on('pointerdown', () => {
            if (this.over || tower.sold) return;
            tag.destroy();
            this.sellTower(tower);
        });

        this.towers.push(tower);
    }

    //  Restore a tower's resting look: dark while browned out, plain otherwise.
    paintTower (tower: Tower)
    {
        if (tower.sold) return;

        if (tower.offline) tower.sprite.setTint(OFFLINE);
        else tower.sprite.clearTint();
    }

    //  Refund half the build cost and re-arm the pad underneath.
    sellTower (tower: Tower)
    {
        tower.sold = true;
        this.towers = this.towers.filter(t => t !== tower);

        this.sfx('sfx-tower-sell');

        this.budget += refund(tower.spec);
        this.budgetText.setText(`$${this.budget}`);

        //  Any bullet already in flight keeps going — it's paid for.
        const { x, y } = tower;
        tower.ring.setVisible(false);
        tower.sprite.destroy();

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

    //  Clicking a HUD button (or pressing its number) buys the tower if it is
    //  still locked, otherwise just arms it.
    pick (kind: TowerKind)
    {
        if (this.over) return;

        if (!this.unlocked[kind])
        {
            this.unlockTower(kind);
            return;
        }

        this.sfx('sfx-ui-click', { volume: 0.7 });
        this.select(kind);
    }

    unlockTower (kind: TowerKind)
    {
        const spec = TOWER_SPECS[kind];

        if (this.budget < spec.unlock)
        {
            this.rejectPurchase();
            return;
        }

        this.budget -= spec.unlock;
        this.budgetText.setText(`$${this.budget}`);
        this.unlocked[kind] = true;

        this.sfx('sfx-tower-unlock');
        this.flashHud(`${spec.name} UNLOCKED  ·  BUILD $${spec.cost}`, spec.hex);
        this.refreshPickers();
        this.select(kind);
    }

    //  Can't afford it — flash the budget red.
    rejectPurchase ()
    {
        this.sfx('sfx-place-denied', { minGap: 200 });
        this.budgetText.setColor('#ef4444');
        this.time.delayedCall(250, () => this.budgetText.setColor('#ff9900'));
    }

    //  Change which tower the next click builds. Locked towers can't be armed.
    select (kind: TowerKind)
    {
        if (!this.unlocked[kind]) return;

        this.selected = kind;
        this.refreshPickers();
    }

    //  Repaint every HUD button from unlock + selection state.
    refreshPickers ()
    {
        for (const k of TOWER_ORDER)
        {
            const picker = this.pickers[k];
            if (!picker) continue;

            const spec = TOWER_SPECS[k];
            const locked = !this.unlocked[k];
            const on = k === this.selected;

            if (locked)
            {
                picker.box.setStrokeStyle(1, PAD_LINE, 0.9);
                picker.box.setFillStyle(BG, 0);
                picker.icon.setAlpha(0.3).setTint(OFFLINE);
                picker.text.setColor('#5c728a');
                picker.sub.setText(`UNLOCK $${spec.unlock}`).setColor('#8ea3b8');
                this.fitText(picker.sub, PICKER_TEXT_W);
                continue;
            }

            picker.box.setStrokeStyle(on ? 2 : 1, spec.colour, on ? 1 : 0.35);
            picker.box.setFillStyle(spec.colour, on ? 0.18 : 0);
            picker.icon.setAlpha(on ? 1 : 0.6).clearTint();
            picker.text.setColor(on ? spec.hex : '#5c728a');
            picker.sub.setText(picker.stats).setColor('#5c728a');
            this.fitText(picker.sub, PICKER_TEXT_W);
        }
    }

    // ── Combat ───────────────────────────────────────────────────────────

    //  Waves arrive as a burst of closely-spaced mobs, then a quiet gap.
    startWave ()
    {
        if (this.over) return;

        this.wave++;

        //  Shinobi are the constant; the flood and the flyers layer on top as
        //  the run goes on.
        const ninjas = NINJA_BASE + (this.wave - 1) * NINJA_GROWTH;

        const flood = this.wave < DDOS_FIRST_WAVE
            ? 0
            : SWARM_BASE + (this.wave - DDOS_FIRST_WAVE) * SWARM_GROWTH;

        const flyers = this.wave < INJECT_FIRST_WAVE
            ? 0
            : 1 + Math.floor((this.wave - INJECT_FIRST_WAVE) / 2);

        //  Boss wave every fifth round; a second tank joins from wave 15.
        const tanks = this.wave % TANK_EVERY === 0
            ? 1 + Math.floor((this.wave - TANK_EVERY) / 10)
            : 0;

        const parts = [`SHINOBI x${ninjas}`];
        if (flood > 0) parts.push(`DDoS x${flood}`);
        if (flyers > 0) parts.push(`SQLi x${flyers}`);
        if (tanks > 0) parts.push(`TANK x${tanks}`);
        this.waveLabel = `WAVE ${this.wave}  ·  ${parts.join('  ·  ')}`;

        if (tanks > 0)
        {
            this.sfx('sfx-wave-boss');
            this.flashHud(`BOSS WAVE  ·  LEATHERBACK  ·  -${TANK_DAMAGE}% IF IT LANDS`);
            this.cameras.main.shake(500, 0.004);
        }
        else
        {
            this.sfx('sfx-wave-start', { volume: 0.85 });
        }

        this.time.addEvent({
            delay: NINJA_SPACING,
            repeat: ninjas - 1,
            callback: () => this.spawnNinja()
        });

        if (flood > 0)
        {
            this.time.addEvent({
                delay: SWARM_SPACING,
                repeat: flood - 1,
                callback: () => this.spawnDdos()
            });
        }

        if (flyers > 0)
        {
            this.time.addEvent({
                delay: INJECT_SPACING,
                repeat: flyers - 1,
                callback: () => this.spawnInjection()
            });
        }

        if (tanks > 0)
        {
            this.time.addEvent({
                delay: TANK_SPACING,
                repeat: tanks - 1,
                callback: () => this.spawnTank()
            });
        }

        //  Next wave starts once the longest burst has landed, plus the current
        //  gap, which the degradation tiers shorten as the origin takes damage.
        //  A tank is still crawling long after its wave is nominally over.
        const burst = Math.max(
            ninjas * NINJA_SPACING,
            flood * SWARM_SPACING,
            flyers * INJECT_SPACING,
            tanks * TANK_SPACING
        );

        this.burstEndsAt = this.time.now + burst;
        this.nextWaveAt = this.time.now + burst + this.waveGap;

        this.spawner = this.time.delayedCall(burst + this.waveGap, () => this.startWave());
    }

    //  One line that either lists what is inbound or counts down to it.
    updateWaveText ()
    {
        const quiet = this.time.now >= this.burstEndsAt;
        const secs = Math.max(0, Math.ceil((this.nextWaveAt - this.time.now) / 1000));

        const text = quiet
            ? `WAVE ${this.wave + 1} INBOUND  ·  ${secs}s`
            : this.waveLabel;

        if (text === this.lastWaveText) return;

        this.lastWaveText = text;
        this.waveText.setText(text);
        this.waveText.setColor(quiet ? '#38bdf8' : '#8ea3b8');

        //  Late waves list four mob types and would otherwise reach the build
        //  buttons; the countdown line is short and stays at full size.
        this.fitText(this.waveText, WAVE_TEXT_W);
    }

    //  The default intruder. Walks the trench like the flood does, but dashes
    //  cloaked every couple of seconds — see cloakDash() and update().
    spawnNinja ()
    {
        if (this.over) return;

        const maxHp = NINJA_HP + (this.wave - 1) * 7;
        const start = this.route.getStartPoint();
        const obj = this.add.follower(this.route, start.x, start.y, 'tortoise-default')
            .setDepth(6)
            .setScale(NINJA_SCALE);

        const barBg = this.add.rectangle(0, 0, 30, 5, 0x000000, 0.6).setDepth(7);
        const bar = this.add.rectangle(0, 0, 28, 3, RED).setOrigin(0, 0.5).setDepth(7);

        const enemy = this.addEnemy({
            obj, follower: obj, flying: false, boss: false,
            hp: maxHp, maxHp, damage: NINJA_DAMAGE, bountyMult: NINJA_BOUNTY_MULT,
            barBg, bar, barW: 28, barOffset: 30,
            vx: 0, vy: 0, turnAt: 0,
            cloaked: false,
            //  Stagger the first dash so a line of them doesn't blink in unison.
            cloakAt: this.time.now + PhaserMath.Between(600, NINJA_CLOAK_EVERY),
            uncloakAt: 0,
            alive: true
        });

        obj.startFollow({
            duration: (this.route.getLength() / NINJA_SPEED) * 1000,
            positionOnPath: true,
            rotateToPath: true,
            onComplete: () => this.breach(enemy)
        });
    }

    //  Boss. Same trench as everything else on the ground, just far bigger and
    //  far slower, and it hurts badly if it gets through.
    spawnTank ()
    {
        if (this.over) return;

        const maxHp = TANK_HP + (this.wave - 1) * 140;
        const start = this.route.getStartPoint();
        const obj = this.add.follower(this.route, start.x, start.y, 'tortoise-tank')
            .setDepth(5)
            .setScale(TANK_SCALE);

        const barBg = this.add.rectangle(0, 0, 56, 7, 0x000000, 0.7).setDepth(7);
        const bar = this.add.rectangle(0, 0, 54, 5, RED).setOrigin(0, 0.5).setDepth(7);

        const enemy = this.addEnemy({
            obj, follower: obj, flying: false, boss: true,
            hp: maxHp, maxHp, damage: TANK_DAMAGE, bountyMult: TANK_BOUNTY_MULT,
            barBg, bar, barW: 54, barOffset: 48,
            vx: 0, vy: 0, turnAt: 0,
            cloaked: false, cloakAt: 0, uncloakAt: 0, alive: true
        });

        obj.startFollow({
            duration: (this.route.getLength() / TANK_SPEED) * 1000,
            positionOnPath: true,
            rotateToPath: true,
            onComplete: () => this.breach(enemy)
        });

        //  Slow heave rather than the DDoS scuttle — it should read as heavy.
        this.tweens.add({
            targets: obj,
            scale: TANK_SCALE * 1.05,
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
    }

    //  Smoke bomb: untargetable by everything but IAM, and the path tween runs
    //  several times faster for the length of the dash.
    cloakDash (enemy: Enemy)
    {
        enemy.cloaked = true;
        enemy.cloakAt = 0;
        enemy.uncloakAt = this.time.now + NINJA_CLOAK_MS;

        enemy.obj.setAlpha(NINJA_CLOAK_ALPHA);
        enemy.barBg.setAlpha(0.25);
        enemy.bar.setAlpha(0.25);

        //  pathTween is what startFollow() drives; scaling it is the cheapest
        //  way to change speed mid-follow without restarting the follow.
        const tween = enemy.follower?.pathTween;
        if (tween) tween.timeScale = NINJA_DASH_MULT;

        this.smokePuff(enemy.obj.x, enemy.obj.y);
    }

    uncloak (enemy: Enemy)
    {
        enemy.cloaked = false;
        enemy.cloakAt = this.time.now + NINJA_CLOAK_EVERY;
        enemy.uncloakAt = 0;

        enemy.obj.setAlpha(1);
        enemy.barBg.setAlpha(1);
        enemy.bar.setAlpha(1);

        const tween = enemy.follower?.pathTween;
        if (tween) tween.timeScale = 1;

        this.smokePuff(enemy.obj.x, enemy.obj.y);
    }

    smokePuff (x: number, y: number)
    {
        //  Both ends of a dash puff, and every shinobi does it every 2.4s, so
        //  this is throttled hard and mixed low.
        this.sfx('sfx-ninja-dash', { volume: 0.6, minGap: 130 });

        const puff = this.add.circle(x, y, 10, 0x94a3b8, 0.45).setDepth(7);

        this.tweens.add({
            targets: puff, scale: 2.2, alpha: 0, duration: 320,
            onComplete: () => puff.destroy()
        });
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
            obj, follower: obj, flying: false, boss: false,
            hp: maxHp, maxHp, damage: DDOS_DAMAGE, bountyMult: 1,
            barBg, bar, barW: 18, barOffset: 18,
            vx: 0, vy: 0, turnAt: 0,
            cloaked: false, cloakAt: 0, uncloakAt: 0, alive: true
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
            obj, flying: true, boss: false,
            hp: maxHp, maxHp, damage: INJECT_DAMAGE, bountyMult: INJECT_BOUNTY_MULT,
            barBg, bar, barW: 32, barOffset: 28, shadow,
            vx: INJECT_SPEED, vy: 0, turnAt: 0,
            cloaked: false, cloakAt: 0, uncloakAt: 0, alive: true
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

    //  Push this.integrity to the HUD readout and the bar on the origin rack.
    showIntegrity ()
    {
        this.integrityText.setText(`INTEGRITY ${this.integrity}%`);
        this.integrityText.setColor(this.integrity <= 30 ? '#ef4444' : '#8ea3b8');
        this.integrityBar.width = this.integrity;
        this.integrityBar.setFillStyle(this.integrity <= 30 ? RED : this.integrity <= 60 ? ACCENT : GREEN);
    }

    //  Enemy reached the origin server.
    breach (enemy: Enemy)
    {
        if (!enemy.alive || this.over) return;

        const { x, y } = enemy.obj;
        const damage = enemy.damage;
        this.killEnemy(enemy, false);

        this.integrity = Math.max(0, this.integrity - damage);
        this.showIntegrity();

        //  A flyer landing on the origin is a much bigger event than one more
        //  packet in the flood.
        const heavy = damage >= INJECT_DAMAGE;

        //  The flood arrives 260ms apart, so a breach per packet would be a
        //  drum roll. Heavy breaches are rare enough to always land.
        if (heavy) this.sfx('sfx-breach-heavy');
        else this.sfx('sfx-breach', { volume: 0.8, minGap: 150 });

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
            { at: 60, run: () => { this.setStatus('IMPAIRED', '#f97316'); this.setWaveGap(7500); } },
            { at: 50, run: () => { this.fireRateMult = 1.1; this.flashHud('COOLING LOSS  ·  TOWERS -10% RATE'); } },
            { at: 40, run: () => { this.killPowerDomain(0, 8, 4, 3, 'PWR-B'); this.spikeMs = 4000; } },
            { at: 30, run: () => { this.setStatus('CRITICAL', '#ef4444'); this.startVignette(); this.setWaveGap(5500); } },
            { at: 20, run: () => { this.startBrownouts(); this.flashHud('BROWNOUTS  ·  TOWERS DROPPING'); } },
            { at: 10, run: () => { this.fireRateMult = 1.2; this.setWaveGap(3500); this.flashHud('REGION FAILING'); } }
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
                this.sfx('sfx-tower-offline', { volume: 0.8 });
                this.paintTower(t);

                this.time.delayedCall(BROWNOUT_MS, () => {
                    //  It may have been sold out from under us mid-brownout.
                    if (t.sold) return;

                    t.offline = false;
                    this.paintTower(t);
                });
            }
        });
    }

    //  Only affects the next gap — it never interrupts a wave in flight.
    setWaveGap (ms: number)
    {
        this.waveGap = ms;
    }

    //  Brief banner under the HUD when a tier trips, a wave escalates, or a
    //  boss goes down.
    flashHud (message: string, colour = '#ef4444')
    {
        const banner = this.add.text(512, 92, message, {
            fontFamily: 'Arial Black', fontSize: 16, color: colour,
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

        if (spec.beam)
        {
            this.fireBeam(tower, target);
            return;
        }

        const bullet = this.add.circle(tower.x, tower.y, spec.bulletRadius, spec.colour).setDepth(6);

        this.sfx(spec.fireSfx, { volume: spec.fireVolume, minGap: spec.fireGap });

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

    //  Ice lance. No projectile — everything inside the swept line takes the
    //  full hit the moment the tower fires, so the visual is pure decoration.
    fireBeam (tower: Tower, target: Enemy)
    {
        const spec = tower.spec;
        const angle = PhaserMath.Angle.Between(tower.x, tower.y, target.obj.x, target.obj.y);
        const len = spec.range + BEAM_OVERSHOOT;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        //  Project each mob onto the beam: `along` is how far down the lance it
        //  sits, `off` is how far off the centre line.
        const struck: Enemy[] = [];

        for (const e of this.enemies)
        {
            if (!e.alive) continue;
            if (e.cloaked && !spec.seesCloaked) continue;

            const dx = e.obj.x - tower.x;
            const dy = e.obj.y - tower.y;
            const along = dx * cos + dy * sin;

            if (along < 0 || along > len) continue;
            if (Math.abs(dy * cos - dx * sin) > BEAM_HALF_WIDTH) continue;

            struck.push(e);
        }

        //  hit() can kill, and killEnemy() only flips a flag, so iterating the
        //  snapshot is safe.
        for (const e of struck) this.hit(e, spec.damage);

        const glow = this.add.rectangle(tower.x, tower.y, len, BEAM_HALF_WIDTH * 2, spec.colour, 0.32)
            .setOrigin(0, 0.5)
            .setRotation(angle)
            .setDepth(6);

        const core = this.add.rectangle(tower.x, tower.y, len, 10, 0xffffff, 0.95)
            .setOrigin(0, 0.5)
            .setRotation(angle)
            .setDepth(7);

        this.tweens.add({
            targets: core, scaleY: 0.08, alpha: 0, duration: 260, ease: 'Cubic.In',
            onComplete: () => core.destroy()
        });

        this.tweens.add({
            targets: glow, scaleY: 1.8, alpha: 0, duration: 340, ease: 'Cubic.Out',
            onComplete: () => glow.destroy()
        });

        const flash = this.add.circle(tower.x, tower.y, 15, 0xffffff, 0.85).setDepth(8);
        this.tweens.add({
            targets: flash, scale: 2.4, alpha: 0, duration: 260,
            onComplete: () => flash.destroy()
        });

        //  Small kick so a discharge this expensive reads as an event.
        this.cameras.main.shake(90, 0.002);
    }

    nearestEnemy (x: number, y: number, range: number, seesCloaked: boolean): Enemy | null
    {
        let best: Enemy | null = null;
        let bestDist = range;

        for (const e of this.enemies)
        {
            if (!e.alive) continue;
            if (e.cloaked && !seesCloaked) continue;

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

        //  Every firing sound is now dead, so this has the mix to itself. The
        //  SoundManager is global, so the tail carries into the GameOver scene.
        this.sfx('sfx-region-down');

        for (const e of this.enemies) if (e.alive) e.follower?.pauseFollow();

        this.cameras.main.shake(400, 0.012);
        this.time.delayedCall(600, () => this.scene.start('GameOver', { score: this.score }));
    }

    update (_time: number, delta: number)
    {
        if (this.over) return;

        const dt = delta / 1000;

        this.updateWaveText();

        //  Shinobi cloak on their own clock. cloakAt of 0 means "already
        //  cloaked", uncloakAt of 0 means "not cloaked", so mobs that never
        //  cloak (flood, flyers) sit at 0/0 and are skipped by both branches.
        for (const e of this.enemies)
        {
            if (!e.alive) continue;

            if (e.cloakAt > 0 && this.time.now >= e.cloakAt) this.cloakDash(e);
            else if (e.uncloakAt > 0 && this.time.now >= e.uncloakAt) this.uncloak(e);
        }

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

            const by = e.obj.y - e.barOffset;
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

            const target = this.nearestEnemy(t.x, t.y, t.spec.range, t.spec.seesCloaked);
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
            const { flying, boss } = enemy;
            this.killEnemy(enemy, true);

            //  A boss dying is a one-per-five-waves event and gets its own
            //  sound; everything else shares the shell crack, throttled because
            //  a Shield battery clears the flood several mobs at a time.
            if (boss) this.sfx('sfx-boss-death');
            else this.sfx('sfx-enemy-death', { volume: flying ? 0.9 : 0.7, minGap: 45 });

            const radius = boss ? 26 : flying ? 12 : 6;
            const pop = this.add.circle(x, y, radius, flying ? VIOLET : ACCENT).setDepth(6);
            this.tweens.add({
                targets: pop, scale: 3, alpha: 0, duration: boss ? 500 : flying ? 340 : 220,
                onComplete: () => pop.destroy()
            });

            //  Killing a tank is the biggest thing that happens in a run.
            if (boss)
            {
                this.cameras.main.shake(260, 0.008);
                this.flashHud(`LEATHERBACK DOWN  ·  +$${this.bounty * TANK_BOUNTY_MULT}`, '#22c55e');
            }
            return;
        }

        //  Hardest-throttled sound in the game: at Shield's fire rate this is
        //  the single most frequent event, so most plays are dropped and the
        //  ones that land sit barely above the floor.
        this.sfx('sfx-enemy-hit', { volume: 0.55, minGap: 75 });

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

        this.hintText = this.add.text(16, 42, '', {
            fontFamily: 'Arial', fontSize: 12, color: '#5c728a'
        }).setDepth(10);
        this.showHint();

        this.budgetText = this.add.text(1014, 2, `$${this.budget}`, {
            fontFamily: 'Arial Black', fontSize: 19, color: '#ff9900'
        }).setOrigin(1, 0).setDepth(10);

        //  Four build buttons fill the right-hand 480px of the band, which is
        //  most of it — everything else is packed into three short rows on the
        //  left and fitText()'d so nothing can grow into the buttons.
        this.makePicker('iam', 591, '1');
        this.makePicker('shield', 711, '2');
        this.makePicker('waf', 831, '3');
        this.makePicker('snowmobile', 951, '4');
        this.refreshPickers();

        this.statusText = this.add.text(182, 2, 'HEALTHY', {
            fontFamily: 'Arial Black', fontSize: 15, color: '#22c55e'
        }).setOrigin(0.5, 0).setDepth(10);

        this.latencyText = this.add.text(182, 22, `p99 ${BASE_LATENCY}ms`, {
            fontFamily: 'Arial', fontSize: 12, color: '#5c728a'
        }).setOrigin(0.5, 0).setDepth(10);

        this.waveText = this.add.text(402, 4, 'WAVE 1', {
            fontFamily: 'Arial', fontSize: 13, color: '#8ea3b8'
        }).setOrigin(0.5, 0).setDepth(10);

        this.integrityText = this.add.text(402, 24, 'INTEGRITY 100%', {
            fontFamily: 'Arial Black', fontSize: 14, color: '#8ea3b8'
        }).setOrigin(0.5, 0).setDepth(10);

    }

    //  Bottom HUD line: flavour plus every key binding, rewritten on mute so
    //  the audio state is visible while presenting.
    showHint ()
    {
        this.hintText.setText(this.sound.mute ? `${HINT}  ·  MUTED` : HINT);
        this.fitText(this.hintText, HINT_W);
    }

    //  Nothing in the HUD band has anywhere to overflow to, so any text whose
    //  content varies — the wave composition, a tower name, an unlock price —
    //  is scaled down to its slot instead of running into its neighbour.
    fitText (text: GameObjects.Text, max: number)
    {
        text.setScale(Math.min(1, max / text.width));
    }

    // ── Debug menu ───────────────────────────────────────────────────────

    //  Backtick or D toggles a panel of cheats. Deliberately not behind a
    //  build flag: being able to jump to a boss wave with $50k in hand while
    //  demoing beats keeping the shipped build honest.
    buildDebugMenu ()
    {
        const actions: [string, () => void][] = [
            ['+ $1,000', () => this.grant(1000)],
            ['+ $10,000', () => this.grant(10000)],
            ['UNLOCK ALL TOWERS', () => this.unlockAll()],
            ['SPAWN NEXT WAVE NOW', () => this.forceWave()],
            ['REPAIR TO 100%', () => this.repair()],
            ['CLEAR THE BOARD', () => this.clearEnemies()]
        ];

        const W = 208;
        const ROW = 28;
        const PAD = 12;
        const TOP = 40;

        const panel = this.add.container(24, 110).setDepth(20).setVisible(false);

        //  Interactive so a click landing between two buttons is swallowed
        //  rather than building a tower on the pad hidden behind the panel.
        const bg = this.add.rectangle(0, 0, W + PAD * 2, TOP + actions.length * ROW + PAD, 0x0d1727, 0.97)
            .setOrigin(0, 0)
            .setStrokeStyle(2, ACCENT, 0.7)
            .setInteractive();

        const title = this.add.text(PAD, 12, 'DEBUG  ·  ` OR D TO CLOSE', {
            fontFamily: 'Arial Black', fontSize: 12, color: '#ff9900'
        });

        panel.add([bg, title]);

        actions.forEach(([label, run], i) => {
            const y = TOP + i * ROW;

            const box = this.add.rectangle(PAD, y, W, ROW - 4, BG, 0.6)
                .setOrigin(0, 0)
                .setStrokeStyle(1, PAD_LINE, 0.9)
                .setInteractive({ useHandCursor: true });

            const text = this.add.text(PAD + 10, y + 6, label, {
                fontFamily: 'Arial', fontSize: 12, color: '#e6edf3'
            });

            box.on('pointerover', () => box.setStrokeStyle(1, ACCENT, 1).setFillStyle(ACCENT, 0.18));
            box.on('pointerout', () => box.setStrokeStyle(1, PAD_LINE, 0.9).setFillStyle(BG, 0.6));
            box.on('pointerdown', () => {
                this.sfx('sfx-ui-click', { volume: 0.7 });
                run();
            });

            panel.add([box, text]);
        });

        this.debugPanel = panel;
    }

    toggleDebug ()
    {
        this.debugPanel?.setVisible(!this.debugPanel.visible);
    }

    grant (amount: number)
    {
        this.budget += amount;
        this.budgetText.setText(`$${this.budget}`);
    }

    unlockAll ()
    {
        for (const k of TOWER_ORDER) this.unlocked[k] = true;
        this.refreshPickers();
    }

    //  Cancel whatever the wave clock was waiting for and start the next wave.
    forceWave ()
    {
        if (this.over) return;

        this.spawner.remove();
        this.startWave();
    }

    //  Integrity only — the degradation tiers a run has already tripped are
    //  permanent, so a repaired origin keeps its brownouts and cooling loss.
    repair ()
    {
        this.integrity = 100;
        this.showIntegrity();
    }

    clearEnemies ()
    {
        for (const e of [...this.enemies]) this.killEnemy(e, false);
        this.enemies = [];
    }

    //  One HUD build button. Clicking it, or pressing its number, buys the
    //  tower if locked and otherwise arms it for the next pad click.
    makePicker (kind: TowerKind, x: number, key: string)
    {
        const spec = TOWER_SPECS[kind];

        const box = this.add.rectangle(x, 40, 116, 40)
            .setStrokeStyle(1, PAD_LINE, 0.9)
            .setDepth(10)
            .setInteractive({ useHandCursor: true });

        //  Same emplacement art as the board, shrunk to a button icon.
        const icon = this.add.image(x - 43, 40, spec.texture).setScale(0.4).setDepth(11);

        //  Text sits in the 80px right of the icon. SNOWMOBILE is wider than
        //  that, so both lines are fitted rather than trusted to fit.
        const text = this.add.text(x + 14, 31, `${key}  ${spec.name}`, {
            fontFamily: 'Arial Black', fontSize: 10, color: '#5c728a'
        }).setOrigin(0.5).setDepth(11);

        //  Cost lives on the stat line because the names no longer leave room
        //  for it above — and while locked this line shows the unlock price.
        const stats = `$${spec.cost}  ·  ${spec.damage} dmg  ·  ${(1000 / spec.rate).toFixed(1)}/s`;

        const sub = this.add.text(x + 14, 46, stats, {
            fontFamily: 'Arial', fontSize: 9, color: '#5c728a'
        }).setOrigin(0.5).setDepth(11);

        this.fitText(text, PICKER_TEXT_W);
        this.fitText(sub, PICKER_TEXT_W);

        box.on('pointerdown', () => this.pick(kind));

        this.pickers[kind] = { box, icon, text, sub, stats };
    }
}

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
//  WAF: slow, expensive, huge per-shot damage, and the only tower that can
//  engage a flyer at all — everything else is ground fire. That makes it
//  mandatory rather than optional from the first SQLi wave onward. Wasted on
//  the DDoS swarm, because most of each shot is overkill.
//  SNOWMOBILE: the late-game money sink. Fires an instant ice lance instead
//  of a bullet — enormous damage, once every few seconds, and it punches
//  through everything standing in the line, so it pays off best aimed down a
//  long straight of the trench. Terrible value against anything it one-shots.
//
//  unlock is a one-off purchase per run before the tower can be built at all.
//  IAM starts unlocked so wave 1 is always playable. Unlocks are account-wide:
//  buying SHIELD once makes it buildable in every region.
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
    shot: string;             // projectile art, drawn at scale 1
    shotFacing: boolean;      // rotate the shot to its heading, or leave radial
    seesCloaked: boolean;
    hitsFlying: boolean;      // can engage airborne mobs at all — see canEngage()
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
        bulletSpeed: 700, shot: 'shot-iam', shotFacing: true, seesCloaked: true, hitsFlying: false,
        colour: CYAN, hex: '#38bdf8',
        fireSfx: 'sfx-iam-fire', fireGap: 70, fireVolume: 0.85
    },
    shield: {
        kind: 'shield', texture: 'tower-shield', name: 'SHIELD',
        unlock: 200, cost: 120, range: 130, rate: 120, damage: 4,
        bulletSpeed: 780, shot: 'shot-shield', shotFacing: true, seesCloaked: false, hitsFlying: false,
        colour: ACCENT, hex: '#ff9900',
        //  Fires every 120ms per tower and there can be a dozen of them, so the
        //  gap is most of the fire rate: at full board only about 1 shot in 6
        //  is actually audible, which is the difference between a weapon and
        //  white noise.
        fireSfx: 'sfx-shield-fire', fireGap: 100, fireVolume: 0.7
    },
    waf: {
        kind: 'waf', texture: 'tower-waf', name: 'WAF',
        //  Unlock came down from 350 once WAF became the only counter to flyers:
        //  a mandatory tower cannot also be a luxury purchase. Range went up
        //  from 155 because the binding constraint against a crossing flyer is
        //  how long it stays in the circle, not damage per shot — and range buys
        //  that without raising DPS against the trench.
        unlock: 250, cost: 200, range: 170, rate: 850, damage: 30,
        //  The only tower that can touch a flyer. Inspecting request payloads is
        //  the one thing in the roster that does not care what carried them.
        bulletSpeed: 620, shot: 'shot-waf', shotFacing: true, seesCloaked: false, hitsFlying: true,
        colour: VIOLET, hex: '#a855f7',
        fireSfx: 'sfx-waf-fire', fireGap: 60, fireVolume: 1
    },
    snowmobile: {
        kind: 'snowmobile', texture: 'tower-snowmobile', name: 'SNOWMOBILE',
        unlock: 750, cost: 420, range: 200, rate: 4000, damage: 300,
        //  Beam towers hit instantly, so bulletSpeed goes unused and the slug is
        //  decoration thrown down the lance after the damage has landed.
        bulletSpeed: 0, shot: 'shot-snowmobile', shotFacing: true, seesCloaked: false,
        hitsFlying: false, beam: true,
        colour: ICE, hex: '#67e8f9',
        //  A 980ms cryo discharge on a 4s cooldown: 200ms of charge, a crack,
        //  then the frozen tail. Loudest thing on the board by design. The gap
        //  only exists to stop two of them landing in perfect sync, which reads
        //  as one louder tower rather than two.
        fireSfx: 'sfx-snowmobile-fire', fireGap: 300, fireVolume: 1
    }
};

const TOWER_ORDER: TowerKind[] = ['iam', 'shield', 'waf', 'snowmobile'];

//  How fast an emplacement swings onto a new target, in radians per second.
//  The art is drawn facing right, so 0 rotation points at 0 degrees and no
//  offset is needed between the sprite and the firing angle.
const TURN_RATE = 9;

//  Recoil. The emplacement slides back along its firing line and eases home.
//  RECOIL_SETTLE is a per-second rate, so the return is framerate-independent.
const RECOIL_PX = 4;
const RECOIL_BEAM_PX = 9;
const RECOIL_SETTLE = 14;

//  Half the width of the ice lance: anything within this of the line takes the
//  full hit, and the beam carries on past its target to the edge of range.
const BEAM_HALF_WIDTH = 16;
const BEAM_OVERSHOOT = 44;

//  Text budget inside a HUD build button, and for the wave composition line.
//  Both are fitText()'d because their content varies — see fitText().
const PICKER_TEXT_W = 80;
const WAVE_TEXT_W = 190;

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
const NINJA_BOUNTY = 10;      // $ per kill — the baseline mob
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
const DDOS_BOUNTY = 15;      // $ per kill

//  SQL injection: airborne, so it ignores the cable trench entirely and
//  wanders straight at the origin. Fragile but urgent, and expensive if it
//  lands.
//
//  HP is deliberately low for its arrival wave. It used to be a 90 HP pool
//  tuned for a world where all four towers could shoot it; now only WAF can, so
//  the nerf lands here rather than as a WAF damage buff. Buffing WAF would have
//  raised its DPS against the trench too, and WAF is not supposed to be the
//  answer to shinobi.
const INJECT_SPEED = 100;     // px/sec through the air
const INJECT_HP = 45;
const INJECT_HP_GROWTH = 8;   // per wave after the first
const INJECT_DAMAGE = 9;
const INJECT_SCALE = 0.52;
const INJECT_BOUNTY = 30;     // $ per kill
const INJECT_SPREAD = 78;     // degrees of random heading either side of "toward origin"
const INJECT_TURN_MIN = 220;  // ms before it picks a new heading
const INJECT_TURN_MAX = 640;

//  Flyers wait until wave 6, and the constraint is the economy rather than the
//  difficulty curve: with a realistic spend on ground defence the player cannot
//  field a WAF (unlock + build) until about here, and WAF is now the only answer
//  to a flyer. Wave 6 also sits clear of the wave-5 boss, so the two
//  introductions do not collide.
const INJECT_FIRST_WAVE = 6;
const INJECT_SPACING = 2200;  // ms between flyers inside a wave

//  Leatherback tank: the boss. Crawls, soaks an enormous amount of damage, and
//  takes a quarter of the origin with it if it lands. Every fifth wave only.
const TANK_EVERY = 5;         // boss wave cadence
const TANK_SPEED = 30;        // px/sec — a crawl; nearly a minute end to end
const TANK_HP = 420;          // +140 per wave
const TANK_DAMAGE = 25;       // integrity lost if it reaches the origin
const TANK_SCALE = 0.84;      // 96x96 art → ~80px on screen, per the README
const TANK_BOUNTY = 75;       // $ per kill
const TANK_SPACING = 3200;    // ms between tanks once there is more than one

const DDOS_FIRST_WAVE = 2;    // the flood joins in wave 2
const SWARM_BASE = 6;         // mobs in the first flood wave
const SWARM_GROWTH = 2;       // extra mobs per wave
const SWARM_SPACING = 260;    // ms between mobs inside a wave
const WAVE_GAP = 10000;       // ms of quiet between waves
const PREP_MS = 15000;        // build phase before wave 1 lands

//  Where the flyers are headed — the front face of the origin rack. Every hall
//  has its origin against the right edge; only the row changes.
const ORIGIN_X = 960;

//  ── Regions ──────────────────────────────────────────────────────────────
//  A region is a whole AWS region: its own data hall, its own trench, its own
//  pads, towers and intruders. What it does NOT have of its own is money,
//  origin integrity, score, tower unlocks or the wave clock — one account and
//  one origin server behind every region, which is the whole point of the
//  mechanic.
//
//  A new region is provisioned in the gap after every tenth wave, and from
//  then on every wave lands in full in every region at once. Only one is on
//  screen at a time (TAB, or click the tab strip); the ones you are not
//  watching keep simulating, so a breach over there costs exactly as much.
const REGION_EVERY = 10;      // waves between provisions
const REGION_PREP = 12000;    // extra ms of quiet in the gap a region opens in
const REGION_ALERT_MS = 900;  // how long a breach lights up a region's tab
const MAX_REGIONS = 4;        // one per layout, and the tab strip fits four

//  The tortoise fleet, in the order it comes online. eu-tort-3 is home; the
//  expansions are the rest of the family, none of them on the status page
//  either.
const REGION_NAMES = ['EU-TORT-3', 'US-SHELL-1', 'SA-GALAP-1', 'AP-KAME-2'];

//  Region tab strip: sits in the HUD band, above the build buttons and left of
//  the budget readout.
const TAB_X = 536;
const TAB_Y = 10;
//  Wide enough for "SA-GALAP-1" plus an intruder count at fontSize 10; the
//  strip still ends well short of the budget readout in the top-right corner.
const TAB_W = 84;
const TAB_H = 16;
const TAB_GAP = 4;

//  One feed per availability zone. Only the first two are tripped by the
//  integrity tiers, so a hall always keeps one zone on mains power.
const PWR_NAMES = ['PWR-A', 'PWR-B', 'PWR-C'];

//  Everything that makes one hall's floor plan. Halls differ only in here, so
//  a new layout is a data change and never a code change.
interface Layout {
    //  Cable route the intruders walk, off-screen left to the origin server.
    //  Must run left-to-right: the art faces right and both the walkers and the
    //  flyers are rotated to their heading, so a route that doubled back would
    //  render every tortoise upside down.
    waypoints: [number, number][];
    originRow: number;
    ingressRow: number;
}

const HALL_A: Layout = {
    waypoints: [
        [-1, 1], [4, 1], [4, 4], [1, 4], [1, 8], [6, 8], [6, 3], [10, 3], [10, 7], [13, 7]
    ],
    originRow: 7,
    ingressRow: 1
};

//  Second floor plan. Same 16x11 grid, a route of comparable length (38 tiles
//  against A's 36, so mob travel time is within a few percent) and a different
//  set of straights, which changes which towers are worth building where.
const HALL_C: Layout = {
    waypoints: [
        [-1, 4], [2, 4], [2, 1], [5, 1], [5, 6], [2, 6], [2, 9], [8, 9], [8, 4], [11, 4], [11, 2], [13, 2]
    ],
    originRow: 2,
    ingressRow: 4
};

//  Mirror a hall top to bottom. Path length, tile count and the number of pads
//  all survive the flip, so balance is untouched while the board reads as a
//  different room. Only the vertical axis is mirrored: see Layout.waypoints.
const flipRows = (l: Layout): Layout => ({
    waypoints: l.waypoints.map(([c, r]) => [c, ROWS - 1 - r] as [number, number]),
    originRow: ROWS - 1 - l.originRow,
    ingressRow: ROWS - 1 - l.ingressRow
});

//  Hall n uses LAYOUTS[n]. Two plans and their mirrors, so the first four halls
//  are all different rooms.
const LAYOUTS: Layout[] = [HALL_A, flipRows(HALL_A), HALL_C, flipRows(HALL_C)];

//  ── Powerups ─────────────────────────────────────────────────────────────
//  Incident response. Both buttons act on every region at once and are priced
//  like the last resort they are: money spent here is towers not built.
//
//  Rate limiting throttles every mob on the board to a crawl for a few
//  seconds — long enough to let the towers catch back up, short enough that
//  it can't replace them. Calling the CTO clears the board outright, and pays
//  no bounty: the CTO takes the credit.
const RATE_LIMIT_COST = 750;
const RATE_LIMIT_MS = 8000;   // how long the throttle holds
const RATE_LIMIT_SLOW = 0.35; // mob speed while it does
const CTO_COST = 2500;

//  The two buttons stack between the wave readout and the build buttons.
const PWRUP_X = 492;          // centre
const PWRUP_W = 74;
const PWRUP_H = 24;

//  ── Degradation ──────────────────────────────────────────────────────────
//  Every breach causes a temporary latency spike; each 10% of integrity lost
//  also trips a permanent tier below. See TIERS in applyTier().
const BASE_LATENCY = 38;      // ms shown in the HUD when healthy
const LATENCY_PENALTY = 1.7;  // tower cooldown multiplier while spiking
const SPIKE_MS = 1500;        // how long a spike lasts, grows with damage
const BROWNOUT_EVERY = 4000;  // ms between brownouts once they start
const BROWNOUT_MS = 900;      // how long a browned-out tower stays dark
const OFFLINE = 0x475569;

//  Every hall is divided into three availability zones: full-height bands of
//  columns, drawn on the board so the player can see them before building. An
//  AZ is the smallest thing AWS gives its own power and cooling, so a power
//  domain failing takes its whole zone's towers with it rather than one tower.
//
//  Inclusive column ranges, and they must tile 0..COLS-1 with no gap and no
//  overlap: every build slot has to land in exactly one zone.
const AZ_BANDS: [number, number][] = [[0, 5], [6, 10], [11, 15]];
const AZ_SLOW = 1.8;          // cooldown multiplier for towers in a dark zone
const AZ_DARK = 0xd08a8a;     // tint for a tower that still fires, just slower
const AZ_LINE = 0x2f4a63;     // zone box, healthy
const AZ_LINE_DARK = 0xef4444;
const AZ_TAG = '#e6edf3';     // zone label, healthy
const AZ_TAG_DARK = '#ff6b6b';

//  Second HUD line. The hall you are looking at is prepended, and the line is
//  rewritten on mute and on every region switch.
const HINT = 'CLICK PAD BUILD  ·  CLICK TOWER SELL  ·  1-4 / TAB REGION  ·  ESC MENU  ·  M MUTE  ·  ` DEBUG';
const HINT_W = 430;          // fitText() budget — it must not reach the powerup buttons

//  ── Music ────────────────────────────────────────────────────────────────
//  Music sits under the effects, but not by much any more. The tracks peak at
//  -14 dBFS in the file, so this still leaves the loudest one-shots (the
//  snowmobile beam at -6, a heavy breach at -9) clearly on top.
const MUSIC_VOL = 0.8;
const MUSIC_FADE = 900;       // ms of crossfade between tracks

interface Enemy {
    region: Region;
    //  PathFollower extends Sprite, so ground and air mobs share this field.
    obj: GameObjects.Sprite;
    follower?: GameObjects.PathFollower;   // only set for trench walkers
    flying: boolean;
    boss: boolean;
    hp: number;
    maxHp: number;
    damage: number;                        // integrity cost of a breach
    bounty: number;                        // dollars paid when killed
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

//  One of the three power feeds in a hall, covering a band of columns. Which
//  zone a slot sits in is a property of the board, fixed when the hall is
//  drawn: it does not depend on what the player builds, or when.
interface Az {
    name: string;
    from: number;                       // first column, inclusive
    to: number;                         // last column, inclusive
    dark: boolean;                      // its power domain has failed
    box: GameObjects.Rectangle;         // outline drawn on the board
    label: GameObjects.Text;
}

interface Tower {
    region: Region;
    az: Az;
    x: number;
    y: number;
    spec: TowerSpec;
    cooldown: number;
    offline: boolean;
    sold: boolean;                      // stops queued brownouts touching it
    sprite: GameObjects.Image;          // state is expressed by tinting this
    pad: GameObjects.Rectangle;         // slot underneath, re-armed on sell
}

interface Bullet {
    obj: GameObjects.Image;
    target: Enemy;
    damage: number;
    speed: number;
    facing: boolean;                    // keep the art pointed down its heading
}

interface Region {
    index: number;
    name: string;
    layout: Layout;
    //  Every display object belonging to this hall lives in here, which is what
    //  makes switching halls one setVisible() call. A Layer rather than a
    //  Container: children keep world coordinates and their own depth, so
    //  followers, hit areas and the existing depth numbers all still work.
    layer: GameObjects.Layer;
    route: Phaser.Curves.Path;
    towers: Tower[];
    azs: Az[];
    enemies: Enemy[];
    bullets: Bullet[];
    pads: GameObjects.Rectangle[];
    integrityBar: GameObjects.Rectangle;
    alertUntil: number;                 // scene time the tab stops flashing red
    tab: {
        box: GameObjects.Rectangle,
        text: GameObjects.Text,
        state: string                   // last painted state, so paintTabs() can skip
    };
}

export class Game extends Scene
{
    //  Run state — shared across every data hall.
    budget = 500;
    integrity = 100;
    wave = 0;
    score = 0;
    over = false;

    //  Degradation state — all of this worsens as the origin takes damage.
    billing = 1;              // multiplier on every payout, cut by a tier
    fireRateMult = 1;         // >1 means slower shots
    waveGap = WAVE_GAP;
    spikeMs = SPIKE_MS;
    spikeUntil = 0;           // scene time the current latency spike ends
    latency = BASE_LATENCY;   // displayed p99, tweened back down after a spike
    tiersHit = 0;
    powerLost: number[] = []; // power domains already dark, replayed into new halls

    //  Which tower the next click builds, and which are bought at all.
    selected: TowerKind = 'iam';
    unlocked: Record<TowerKind, boolean> = { iam: true, shield: false, waf: false, snowmobile: false };

    //  Data halls, and which one is on screen.
    regions: Region[] = [];
    active = 0;
    provisionAt = 0;          // scene time the next hall comes online, 0 if none due

    //  Wave clock. burstEndsAt is when the last mob of the current wave has
    //  spawned; past that the HUD counts down to the next wave instead of
    //  listing the composition. The countdown itself is read off the spawner
    //  timer rather than kept here as a timestamp — see updateWaveText().
    waveLabel = '';
    burstEndsAt = 0;
    lastWaveText = '';

    //  The "only WAF can engage" banner is shown once per run, on the first
    //  wave that actually contains flyers.
    warnedFlyers = false;

    spawner: Phaser.Time.TimerEvent;
    brownoutTimer?: Phaser.Time.TimerEvent;
    spikeTween?: Phaser.Tweens.Tween;

    //  Scene time the rate-limit throttle lifts, 0 while it is off. Movement
    //  code reads this every frame — see updateRegion().
    rateLimitUntil = 0;

    //  HUD
    budgetText: GameObjects.Text;
    waveText: GameObjects.Text;
    integrityText: GameObjects.Text;
    latencyText: GameObjects.Text;
    statusText: GameObjects.Text;
    hintText: GameObjects.Text;
    vignette: GameObjects.Rectangle;
    debugPanel?: GameObjects.Container;
    powerups: {
        box: GameObjects.Rectangle,
        name: GameObjects.Text,
        price: GameObjects.Text,
        cost: number,
        on: () => boolean,              // lights the button while its effect runs
        state: string                   // last painted state — see paintPowerups()
    }[] = [];
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

    //  The hall currently on screen. The only one that accepts clicks.
    current () { return this.regions[this.active]; }

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
    //  With several halls running at once this matters more, not less: the
    //  throttles are per key across the whole game, so four halls firing sound
    //  like a busy region rather than four times the noise.
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

    // ── Music ────────────────────────────────────────────────────────────

    music?: Phaser.Sound.BaseSound;
    musicKey = '';

    //  Crossfade to a track, or do nothing if it is already the one playing.
    //  Both loops are the same key and tempo, so the overlap in the middle of a
    //  fade is harmonically fine even though the two are not beat-aligned.
    //
    //  volume is deliberately only ever touched through a tween: it lives on
    //  the concrete WebAudioSound/HTML5AudioSound classes rather than on the
    //  BaseSound type that add() returns.
    playMusic (key: string, fade = MUSIC_FADE)
    {
        if (this.musicKey === key) return;
        this.musicKey = key;

        const outgoing = this.music;
        if (outgoing)
        {
            this.tweens.add({
                targets: outgoing, volume: 0, duration: fade,
                onComplete: () => outgoing.destroy()
            });
        }

        const incoming = this.sound.add(key, { loop: true, volume: 0 });
        incoming.play();
        this.tweens.add({ targets: incoming, volume: MUSIC_VOL, duration: fade });

        this.music = incoming;
    }

    //  Boss music holds for as long as a leatherback is on the board anywhere,
    //  which outlasts its own wave — a tank crawls for nearly a minute and the
    //  wave gap is ten seconds, so the next wave routinely starts while it is
    //  still inbound. A tank in a hall you are not watching still counts.
    bossActive ()
    {
        return this.regions.some(r => r.enemies.some(e => e.alive && e.boss));
    }

    refreshMusic ()
    {
        this.playMusic(this.bossActive() ? 'music-boss' : 'music-core');
    }

    //  Fade out and leave it stopped. Used on the way into the game over screen.
    stopMusic (fade = MUSIC_FADE)
    {
        const outgoing = this.music;
        this.music = undefined;
        this.musicKey = '';

        if (!outgoing) return;

        this.tweens.add({
            targets: outgoing, volume: 0, duration: fade,
            onComplete: () => outgoing.destroy()
        });
    }

    //  Hard stop, no tween. Scene tweens die with the scene, so a fade started
    //  on shutdown would never complete and the loop would play forever under
    //  the menu.
    //
    //  Goes by key rather than destroying this.music, because a shutdown landing
    //  mid-crossfade leaves an outgoing track that nothing else holds a
    //  reference to: its fade tween is gone with the scene, so it would sit
    //  there looping at whatever volume it had reached.
    killMusic ()
    {
        this.sound.removeByKey('music-core');
        this.sound.removeByKey('music-boss');
        this.music = undefined;
        this.musicKey = '';
    }

    create ()
    {
        //  Scene restarts re-run create(), so reset everything by hand.
        this.budget = 500;
        this.integrity = 100;
        this.wave = 0;
        this.score = 0;
        this.over = false;
        this.regions = [];
        this.active = 0;
        this.provisionAt = 0;
        this.billing = 1;
        this.fireRateMult = 1;
        this.waveGap = WAVE_GAP;
        this.spikeMs = SPIKE_MS;
        this.spikeUntil = 0;
        this.latency = BASE_LATENCY;
        this.tiersHit = 0;
        this.powerLost = [];
        this.brownoutTimer = undefined;
        this.selected = 'iam';
        this.unlocked = { iam: true, shield: false, waf: false, snowmobile: false };
        this.pickers = {};
        this.powerups = [];
        this.rateLimitUntil = 0;
        this.waveLabel = '';
        this.burstEndsAt = 0;
        this.lastWaveText = '';
        this.warnedFlyers = false;
        this.sfxAt = {};

        //  One background behind every hall — the halls only draw the floor up.
        this.add.image(512, 384, 'background');

        this.drawHud();
        this.addRegion(0);
        this.showRegion(0);
        this.buildDebugMenu();

        //  Build phase: nothing spawns until the player has had time to spend
        //  the opening budget.
        this.spawner = this.time.delayedCall(PREP_MS, () => this.startWave());
        this.flashHud('BUILD PHASE  ·  SPEND YOUR BUDGET', '#38bdf8');

        //  Fade in over the build phase rather than starting cold.
        this.playMusic('music-core', 2200);

        //  ESC and restarts both come through here. Without it the loop keeps
        //  playing under the main menu, and a second run stacks a second copy.
        this.events.once('shutdown', () => {
            this.killMusic();
            //  Capture is global, so leaving it on would swallow TAB on the menu.
            this.input.keyboard?.removeCapture('TAB');
        });

        this.input.keyboard?.once('keydown-ESC', () => {
            this.scene.start('MainMenu');
        });

        //  1-4 jump straight to a region, in tab-strip order. Towers are
        //  clicked, not keyed: mid-game the hands-on-keyboard action is
        //  hopping between regions, not re-arming the build cursor.
        this.input.keyboard?.on('keydown-ONE', () => this.jumpRegion(0));
        this.input.keyboard?.on('keydown-TWO', () => this.jumpRegion(1));
        this.input.keyboard?.on('keydown-THREE', () => this.jumpRegion(2));
        this.input.keyboard?.on('keydown-FOUR', () => this.jumpRegion(3));

        //  TAB cycles regions. Captured, or the browser moves focus off the canvas.
        this.input.keyboard?.addCapture('TAB');
        this.input.keyboard?.on('keydown-TAB', () => this.cycleRegion());

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

    // ── Regions ──────────────────────────────────────────────────────────

    //  Build a hall and everything in it. Starts hidden; showRegion() puts it
    //  on screen.
    addRegion (index: number): Region
    {
        const layout = LAYOUTS[index % LAYOUTS.length];
        const layer = this.add.layer().setDepth(1).setVisible(false);

        //  Insertion order is render order for everything at depth 0 — the
        //  layer depth-sorts with a stable sort — so the floor has to go down
        //  before the trench, the trench before the pads, and so on.
        this.drawFloor(layer, index);
        const route = this.drawRoute(layer, layout);
        this.drawIngress(layer, layout);
        const integrityBar = this.drawOrigin(layer, layout);

        const region: Region = {
            index,
            name: REGION_NAMES[index % REGION_NAMES.length],
            layout, layer, route, integrityBar,
            towers: [], azs: [], enemies: [], bullets: [], pads: [],
            alertUntil: 0,
            tab: null as unknown as Region['tab']
        };

        this.regions.push(region);

        //  Zones before pads: both sit at depth 0, so the boxes have to go into
        //  the layer first to end up underneath the slots they contain.
        this.drawAzs(region);
        this.drawPads(region);
        this.makeTab(region);

        //  A hall provisioned at 40% integrity opens already degraded: the
        //  damage is to the shared origin, not to the room it arrived in.
        for (const slot of this.powerLost)
        {
            this.darkenAz(region, this.azForDomain(region, slot));
        }

        return region;
    }

    //  Put one hall on screen and take the others off it.
    //
    //  Hidden halls keep updating, so their pads and towers are still live
    //  input targets sitting under the visible ones. Input is switched off
    //  explicitly rather than left to the renderer: with Phaser's topOnly
    //  input, one stale pad in a hidden hall is enough to swallow every build
    //  click. Free pads are tracked with a `free` data flag so re-arming a hall
    //  cannot re-arm a slot that already has a tower on it.
    showRegion (index: number)
    {
        if (index < 0 || index >= this.regions.length) return;

        this.active = index;

        for (const region of this.regions)
        {
            const on = region.index === index;

            region.layer.setVisible(on);

            for (const pad of region.pads)
            {
                if (!pad.getData('free')) continue;
                if (on) pad.setInteractive({ useHandCursor: true });
                else pad.disableInteractive();
            }

            for (const tower of region.towers)
            {
                if (on) tower.sprite.setInteractive({ useHandCursor: true });
                else tower.sprite.disableInteractive();
            }
        }

        this.showHint();
        this.paintTabs(true);
    }

    cycleRegion ()
    {
        if (this.regions.length < 2) return;

        this.sfx('sfx-ui-click', { volume: 0.7 });
        this.showRegion((this.active + 1) % this.regions.length);
    }

    //  Number keys. Silently ignores regions that are not provisioned yet.
    jumpRegion (index: number)
    {
        if (this.over || index >= this.regions.length || index === this.active) return;

        this.sfx('sfx-ui-click', { volume: 0.7 });
        this.showRegion(index);
    }

    //  A new hall comes online. Only ever called during the quiet gap after a
    //  wave, so switching the view to it abandons nothing.
    provisionRegion ()
    {
        this.provisionAt = 0;

        if (this.over || this.regions.length >= MAX_REGIONS) return;

        const region = this.addRegion(this.regions.length);

        //  Its integrity bar is a second readout of the same shared number.
        this.showIntegrity();
        this.showRegion(region.index);

        this.sfx('sfx-region-up');
        this.flashHud(`NEW REGION ONLINE  ·  ${region.name}  ·  TAB TO SWITCH`, '#38bdf8');
        this.cameras.main.flash(260, 56, 189, 248);
    }

    // ── Region tabs ──────────────────────────────────────────────────────

    //  One tab per region, hidden while there is only one. Shows the region
    //  name and how many intruders are in it, goes red for a moment on a breach.
    makeTab (region: Region)
    {
        const x = TAB_X + region.index * (TAB_W + TAB_GAP);

        const box = this.add.rectangle(x, TAB_Y, TAB_W, TAB_H)
            .setOrigin(0, 0.5)
            .setStrokeStyle(1, PAD_LINE, 0.9)
            .setDepth(10)
            .setVisible(false)
            .setInteractive({ useHandCursor: true });

        const text = this.add.text(x + TAB_W / 2, TAB_Y, region.name, {
            fontFamily: 'Arial Black', fontSize: 10, color: '#5c728a'
        }).setOrigin(0.5).setDepth(11).setVisible(false);

        box.on('pointerdown', () => {
            if (this.over) return;
            this.sfx('sfx-ui-click', { volume: 0.7 });
            this.showRegion(region.index);
        });

        region.tab = { box, text, state: '' };
    }

    //  Runs every frame, so each tab is only actually repainted when what it
    //  says changes — setColor and setText both redraw a text canvas.
    paintTabs (force = false)
    {
        const many = this.regions.length > 1;

        for (const region of this.regions)
        {
            const { box, text } = region.tab;

            box.setVisible(many);
            text.setVisible(many);

            if (!many) continue;

            const on = region.index === this.active;
            const alert = this.time.now < region.alertUntil;
            const inbound = region.enemies.length;

            const state = `${on}|${alert}|${inbound}`;
            if (!force && state === region.tab.state) continue;
            region.tab.state = state;

            const colour = alert ? RED : on ? ACCENT : inbound > 0 ? CYAN : PAD_LINE;

            box.setStrokeStyle(on ? 2 : 1, colour, on || alert ? 1 : 0.7);
            box.setFillStyle(colour, alert ? 0.4 : on ? 0.18 : 0);

            text.setText(inbound > 0 ? `${region.name}  ${inbound}` : region.name);
            text.setColor(alert ? '#ef4444' : on ? '#ff9900' : inbound > 0 ? '#38bdf8' : '#5c728a');
            this.fitText(text, TAB_W - 8);
        }
    }

    // ── Map ──────────────────────────────────────────────────────────────

    //  Raised floor: panels with seams, a few perforated for cold air. The
    //  perforation pattern is seeded off the hall index, so no two rooms have
    //  their cold aisles in the same place.
    drawFloor (layer: GameObjects.Layer, seed: number)
    {
        const g = this.add.graphics();
        layer.add(g);

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
                if ((col * 31 + row * 17 + seed * 5) % 7 === 0)
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
    drawRoute (layer: GameObjects.Layer, layout: Layout): Phaser.Curves.Path
    {
        const pts = layout.waypoints.map(([c, r]) => new PhaserMath.Vector2(this.cx(c), this.cy(r)));
        const g = this.add.graphics();
        layer.add(g);

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

        //  Not a display object, so it is not added to the layer.
        const path = this.add.path(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);

        //  Fibre runs laid along the bottom of the trench.
        const marks = path.getSpacedPoints(Math.floor(path.getLength() / 22));
        g.fillStyle(ACCENT, 0.35);
        for (const p of marks) g.fillCircle(p.x, p.y, 2.5);

        return path;
    }

    //  Left edge: where the traffic comes in from.
    drawIngress (layer: GameObjects.Layer, layout: Layout)
    {
        const y = this.cy(layout.ingressRow);

        const box = this.add.rectangle(10, y, 20, 56, RACK).setStrokeStyle(2, CYAN);

        const led = this.add.circle(10, y, 4, CYAN);
        this.tweens.add({
            targets: led, alpha: 0.2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut'
        });

        const label = this.add.text(36, y - 34, 'INGRESS  ·  0.0.0.0/0', {
            fontFamily: 'Arial', fontSize: 14, color: '#38bdf8'
        });

        layer.add([box, led, label]);
    }

    //  Right edge: the base you're defending. Every hall draws one, and every
    //  one of them is a readout of the same shared integrity — there is a
    //  single origin server behind all of them.
    drawOrigin (layer: GameObjects.Layer, layout: Layout): GameObjects.Rectangle
    {
        const x = ORIGIN_X;
        const y = this.cy(layout.originRow);

        const parts: GameObjects.GameObject[] = [];

        parts.push(this.add.rectangle(x, y, 112, 176, RACK).setStrokeStyle(2, GREEN));

        const leds: GameObjects.Rectangle[] = [];
        for (let i = 0; i < 7; i++)
        {
            const uy = y - 72 + i * 24;
            parts.push(this.add.rectangle(x, uy, 92, 18, 0x16243a).setStrokeStyle(1, RACK_LIP));
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

        parts.push(...leds);

        parts.push(this.add.text(x, y - 104, 'ORIGIN', {
            fontFamily: 'Arial Black', fontSize: 16, color: '#22c55e'
        }).setOrigin(0.5));

        //  Integrity bar strapped to the front of the rack.
        parts.push(this.add.rectangle(x, y + 102, 104, 10, 0x16243a).setStrokeStyle(1, RACK_LIP));

        const bar = this.add.rectangle(x - 50, y + 102, 100, 6, GREEN).setOrigin(0, 0.5);
        parts.push(bar);

        layer.add(parts);

        return bar;
    }

    //  Buildable slots = free tiles that touch the cable trench.
    drawPads (region: Region)
    {
        const layout = region.layout;
        const occupied = new Set<string>();
        const onPath = new Set<string>();

        //  Walk each straight segment and mark every cell it crosses.
        for (let i = 0; i < layout.waypoints.length - 1; i++)
        {
            const [c1, r1] = layout.waypoints[i];
            const [c2, r2] = layout.waypoints[i + 1];
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

        //  The origin server, derived from the row it sits on so a mirrored
        //  layout can't forget to move it.
        for (let r = layout.originRow - 1; r <= layout.originRow + 1; r++)
        {
            occupied.add(`14,${r}`);
            occupied.add(`15,${r}`);
        }

        for (let col = 0; col < COLS; col++)
        {
            for (let row = 0; row < ROWS; row++)
            {
                if (occupied.has(`${col},${row}`)) continue;

                const touchesPath = onPath.has(`${col - 1},${row}`) || onPath.has(`${col + 1},${row}`)
                    || onPath.has(`${col},${row - 1}`) || onPath.has(`${col},${row + 1}`);

                if (touchesPath) this.makePad(region, col, row, this.azAt(region, col));
            }
        }
    }

    //  The three zone boxes. Drawn as outlines with no fill so the floor, the
    //  trench and the pads all still read through them.
    drawAzs (region: Region)
    {
        AZ_BANDS.forEach(([from, to], i) => {
            const x = from * TILE;
            const w = (to - from + 1) * TILE;
            const h = ROWS * TILE;

            const box = this.add.rectangle(x, FLOOR_Y, w, h)
                .setOrigin(0, 0)
                .setStrokeStyle(2, AZ_LINE, 0.85);

            const label = this.add.text(x + 6, FLOOR_Y + 4, `AZ-${String.fromCharCode(65 + i)}`, {
                fontFamily: 'Arial Black', fontSize: 11, color: AZ_TAG,
                backgroundColor: 'rgba(11, 17, 32, 0.88)', padding: { x: 4, y: 1 }
            });

            region.layer.add([box, label]);

            region.azs.push({
                name: `AZ-${String.fromCharCode(65 + i)}`,
                from, to, dark: false, box, label
            });
        });
    }

    //  Which zone owns a column. AZ_BANDS tiles the whole grid, so the fallback
    //  only fires if that invariant is ever broken.
    azAt (region: Region, col: number): Az
    {
        for (const az of region.azs)
        {
            if (col >= az.from && col <= az.to) return az;
        }

        return region.azs[region.azs.length - 1];
    }

    //  One feed per zone, in order: PWR_NAMES[n] powers region.azs[n]. The two
    //  lists are the same length by construction, so a slot always resolves.
    azForDomain (region: Region, slot: number): Az
    {
        return region.azs[slot];
    }

    //  One buildable slot: hover tints it in the armed tower's colour, click
    //  builds it.
    makePad (region: Region, col: number, row: number, az: Az)
    {
        const x = this.cx(col);
        const y = this.cy(row);

        const pad = this.add.rectangle(x, y, 46, 46)
            .setStrokeStyle(1, PAD_LINE, 0.9)
            .setInteractive({ useHandCursor: true });

        //  showRegion() re-arms every free pad in the hall it switches to, and
        //  this is how it knows which ones are free.
        pad.setData('free', true);

        //  The slot owns its zone; whatever gets built here inherits it.
        pad.setData('az', az);

        region.layer.add(pad);
        region.pads.push(pad);

        pad.on('pointerover', () => {
            if (region !== this.current()) return;

            //  Restyled on every hover because the pick can change between one
            //  hover and the next.
            const spec = TOWER_SPECS[this.selected];
            pad.setFillStyle(spec.colour, 0.16).setStrokeStyle(1, spec.colour, 0.9);
        });

        //  Deliberately not guarded on the active hall: this only ever resets
        //  styles, and it is what clears a hover left behind by a switch.
        pad.on('pointerout', () => {
            pad.setFillStyle(BG, 0).setStrokeStyle(1, PAD_LINE, 0.9);
        });

        pad.on('pointerdown', () => {
            if (this.over || region !== this.current()) return;

            const spec = TOWER_SPECS[this.selected];

            if (this.budget < spec.cost)
            {
                this.rejectPurchase();
                return;
            }

            this.budget -= spec.cost;
            this.budgetText.setText(`$${this.budget}`);

            pad.setData('free', false);
            pad.disableInteractive();
            pad.setFillStyle(BG, 0).setStrokeStyle(1, spec.colour, 0.4);

            //  The pad stays around underneath, disabled, so selling can hand
            //  the slot straight back.
            this.buildTower(region, x, y, spec, pad);
        });
    }

    buildTower (region: Region, x: number, y: number, spec: TowerSpec, pad: GameObjects.Rectangle)
    {
        //  The art is a 64x64 emplacement on a 50x50 baseplate, so it drops
        //  onto a 64px grid tile at scale 1 — no fitting, no label needed.
        const sprite = this.add.image(x, y, spec.texture)
            .setDepth(4)
            .setInteractive({ useHandCursor: true });

        sprite.setScale(0.4);
        this.tweens.add({ targets: sprite, scale: 1, duration: 180, ease: 'Back.Out' });

        this.sfx('sfx-tower-build');

        //  The slot decides the zone, so the same pad always yields the same
        //  feed no matter what is built on it or in what order.
        const az = pad.getData('az') as Az;

        const tower: Tower = {
            region, az, x, y, spec, cooldown: 0, offline: false, sold: false,
            sprite, pad
        };

        //  Hovering a built tower shows what it sells for.
        const tag = this.add.text(x, y - 40, `SELL +$${refund(spec)}`, {
            fontFamily: 'Arial Black', fontSize: 11, color: '#22c55e',
            backgroundColor: '#0b1120', padding: { x: 4, y: 2 }
        }).setOrigin(0.5).setDepth(11).setVisible(false);

        region.layer.add([sprite, tag]);

        sprite.on('pointerover', () => {
            if (region !== this.current()) return;

            sprite.setTint(0x86efac);
            tag.setVisible(true);
        });

        sprite.on('pointerout', () => {
            this.paintTower(tower);
            tag.setVisible(false);
        });

        sprite.on('pointerdown', () => {
            if (this.over || tower.sold || region !== this.current()) return;
            tag.destroy();
            this.sellTower(tower);
        });

        region.towers.push(tower);
        this.paintTower(tower);
    }

    //  Restore a tower's resting look. Three states, most severe first: browned
    //  out entirely, powered by a dark zone, or healthy.
    paintTower (tower: Tower)
    {
        if (tower.sold) return;

        if (tower.offline) tower.sprite.setTint(OFFLINE);
        else if (tower.az.dark) tower.sprite.setTint(AZ_DARK);
        else tower.sprite.clearTint();

    }

    //  Refund half the build cost and re-arm the pad underneath.
    sellTower (tower: Tower)
    {
        const region = tower.region;

        tower.sold = true;
        region.towers = region.towers.filter(t => t !== tower);

        this.sfx('sfx-tower-sell');

        this.budget += refund(tower.spec);
        this.budgetText.setText(`$${this.budget}`);

        //  Any bullet already in flight keeps going — it's paid for.
        const { x, y } = tower;
        tower.sprite.destroy();

        tower.pad.setData('free', true);
        tower.pad.setInteractive({ useHandCursor: true });
        tower.pad.setFillStyle(BG, 0).setStrokeStyle(1, PAD_LINE, 0.9);

        const refundText = this.add.text(x, y - 24, `+$${refund(tower.spec)}`, {
            fontFamily: 'Arial Black', fontSize: 13, color: '#22c55e'
        }).setOrigin(0.5).setDepth(11);

        region.layer.add(refundText);

        this.tweens.add({
            targets: refundText, y: y - 56, alpha: 0, duration: 700,
            onComplete: () => refundText.destroy()
        });
    }

    //  Clicking a HUD button buys the tower if it is still locked, otherwise
    //  just arms it. Unlocks apply to every region.
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

    //  Waves arrive as a burst of closely-spaced mobs, then a quiet gap. Every
    //  hall gets the whole wave: one spawn timer, and each tick drops a mob in
    //  every hall at once.
    startWave ()
    {
        if (this.over) return;

        //  A forced wave (debug) can skip the gap the next hall was due to open
        //  in, so make sure it exists before the wave that has to defend it.
        if (this.provisionAt > 0) this.provisionRegion();

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
        if (this.regions.length > 1) parts.push(`IN ${this.regions.length} REGIONS`);
        this.waveLabel = `WAVE ${this.wave}  ·  ${parts.join('  ·  ')}`;

        //  Flyers can only be engaged by WAF, which is not something a player
        //  can deduce from watching their towers do nothing. Announce it once,
        //  on the wave it starts mattering.
        //
        //  Today the first flyer wave is 3 and boss waves are multiples of 5, so
        //  the two banners cannot collide. That is a coincidence of the current
        //  constants rather than a guarantee, and flashHud() draws every banner
        //  in the same slot, so hold back if a boss announcement already has it.
        if (flyers > 0 && !this.warnedFlyers)
        {
            this.warnedFlyers = true;

            const say = () => this.flashHud('SQLi INBOUND  ·  AIRBORNE  ·  ONLY WAF CAN ENGAGE', '#a855f7');
            if (tanks > 0) this.time.delayedCall(2300, say);
            else say();
        }

        if (tanks > 0)
        {
            //  Switch on the announcement, not on the spawn: the first tank is
            //  still on a timer at this point, so bossActive() is false and
            //  refreshMusic() would put the bed back on.
            this.playMusic('music-boss', 600);
            this.sfx('sfx-wave-boss');
            this.flashHud(`BOSS WAVE  ·  LEATHERBACK  ·  -${TANK_DAMAGE}% IF IT LANDS`);
            this.cameras.main.shake(500, 0.004);
        }
        else
        {
            //  Not a plain playMusic('music-core') — a tank from the last boss
            //  wave may well still be crawling, and it keeps its music.
            this.refreshMusic();

            //  Sourced voice clip. jitter 0 because detuning a recognisable
            //  line makes it sound like a warped tape, not like variation.
            this.sfx('sfx-wave-start', { volume: 1, jitter: 0 });
        }

        this.time.addEvent({
            delay: NINJA_SPACING,
            repeat: ninjas - 1,
            callback: () => { for (const r of this.regions) this.spawnNinja(r); }
        });

        if (flood > 0)
        {
            this.time.addEvent({
                delay: SWARM_SPACING,
                repeat: flood - 1,
                callback: () => { for (const r of this.regions) this.spawnDdos(r); }
            });
        }

        if (flyers > 0)
        {
            this.time.addEvent({
                delay: INJECT_SPACING,
                repeat: flyers - 1,
                callback: () => { for (const r of this.regions) this.spawnInjection(r); }
            });
        }

        if (tanks > 0)
        {
            this.time.addEvent({
                delay: TANK_SPACING,
                repeat: tanks - 1,
                callback: () => { for (const r of this.regions) this.spawnTank(r); }
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

        //  Every tenth wave is the last one before a new hall, so that gap runs
        //  long: the hall opens empty, and building it out of the shared wallet
        //  is the whole cost of the expansion.
        const expanding = this.wave % REGION_EVERY === 0 && this.regions.length < MAX_REGIONS;
        const gap = this.waveGap + (expanding ? REGION_PREP : 0);

        this.burstEndsAt = this.time.now + burst;

        //  Provisioned just after the burst lands rather than at the start of
        //  the gap, so the reveal is not competing with the wave that is still
        //  spawning.
        this.provisionAt = expanding ? this.time.now + burst + 400 : 0;

        this.spawner = this.time.delayedCall(burst + gap, () => this.startWave());
    }

    //  One line that either lists what is inbound or counts down to it.
    updateWaveText ()
    {
        const quiet = this.time.now >= this.burstEndsAt;

        //  Read the countdown straight off the timer that starts the wave.
        //
        //  It used to be `nextWaveAt - this.time.now`, with nextWaveAt set in
        //  create(). That is broken: every scene is registered in the game
        //  config up front, so this scene's Clock boots at game start and then
        //  sits at ~0 until the scene becomes active — Clock.update() only runs
        //  on its own scene's UPDATE event, and Clock.start() does not re-sync
        //  now. So during create() this.time.now is still ~0, and nextWaveAt
        //  became 0 + PREP_MS. By the first frame the clock had jumped to real
        //  loop time, which is already past PREP_MS once Preloader has decoded
        //  the audio and the player has spent a moment on the menu, so the
        //  countdown clamped to 0 and sat there for the whole build phase.
        //
        //  The TimerEvent tracks its own elapsed time and was always correct,
        //  which is why the wave still landed on schedule. Asking it directly
        //  removes the parallel bookkeeping instead of just re-basing it.
        const secs = Math.max(0, Math.ceil(this.spawner.getRemaining() / 1000));

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
    //  cloaked every couple of seconds — see cloakDash() and updateRegion().
    spawnNinja (region: Region)
    {
        if (this.over) return;

        const maxHp = NINJA_HP + (this.wave - 1) * 7;
        const start = region.route.getStartPoint();
        const obj = this.add.follower(region.route, start.x, start.y, 'tortoise-default')
            .setDepth(6)
            .setScale(NINJA_SCALE);

        const barBg = this.add.rectangle(0, 0, 30, 5, 0x000000, 0.6).setDepth(7);
        const bar = this.add.rectangle(0, 0, 28, 3, RED).setOrigin(0, 0.5).setDepth(7);

        const enemy = this.addEnemy(region, {
            region,
            obj, follower: obj, flying: false, boss: false,
            hp: maxHp, maxHp, damage: NINJA_DAMAGE, bounty: NINJA_BOUNTY,
            barBg, bar, barW: 28, barOffset: 30,
            vx: 0, vy: 0, turnAt: 0,
            cloaked: false,
            //  Stagger the first dash so a line of them doesn't blink in unison.
            cloakAt: this.time.now + PhaserMath.Between(600, NINJA_CLOAK_EVERY),
            uncloakAt: 0,
            alive: true
        });

        obj.startFollow({
            duration: (region.route.getLength() / NINJA_SPEED) * 1000,
            positionOnPath: true,
            rotateToPath: true,
            onComplete: () => this.breach(enemy)
        });
    }

    //  Boss. Same trench as everything else on the ground, just far bigger and
    //  far slower, and it hurts badly if it gets through.
    spawnTank (region: Region)
    {
        if (this.over) return;

        const maxHp = TANK_HP + (this.wave - 1) * 140;
        const start = region.route.getStartPoint();
        const obj = this.add.follower(region.route, start.x, start.y, 'tortoise-tank')
            .setDepth(5)
            .setScale(TANK_SCALE);

        const barBg = this.add.rectangle(0, 0, 56, 7, 0x000000, 0.7).setDepth(7);
        const bar = this.add.rectangle(0, 0, 54, 5, RED).setOrigin(0, 0.5).setDepth(7);

        const enemy = this.addEnemy(region, {
            region,
            obj, follower: obj, flying: false, boss: true,
            hp: maxHp, maxHp, damage: TANK_DAMAGE, bounty: TANK_BOUNTY,
            barBg, bar, barW: 54, barOffset: 48,
            vx: 0, vy: 0, turnAt: 0,
            cloaked: false, cloakAt: 0, uncloakAt: 0, alive: true
        });

        obj.startFollow({
            duration: (region.route.getLength() / TANK_SPEED) * 1000,
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

        //  The dash speed itself lands in updateRegion(), which re-derives
        //  every walker's speed each frame from cloak state and rate limiting.
        this.smokePuff(enemy);
    }

    uncloak (enemy: Enemy)
    {
        enemy.cloaked = false;
        enemy.cloakAt = this.time.now + NINJA_CLOAK_EVERY;
        enemy.uncloakAt = 0;

        enemy.obj.setAlpha(1);
        enemy.barBg.setAlpha(1);
        enemy.bar.setAlpha(1);

        this.smokePuff(enemy);
    }

    smokePuff (enemy: Enemy)
    {
        //  Both ends of a dash puff, and every shinobi does it every 2.4s, so
        //  this is throttled hard and mixed low.
        this.sfx('sfx-ninja-dash', { volume: 0.6, minGap: 130 });

        const puff = this.add.circle(enemy.obj.x, enemy.obj.y, 10, 0x94a3b8, 0.45).setDepth(7);
        enemy.region.layer.add(puff);

        this.tweens.add({
            targets: puff, scale: 2.2, alpha: 0, duration: 320,
            onComplete: () => puff.destroy()
        });
    }

    //  Register a mob in its hall and hand it back, so callers can wire up
    //  callbacks that close over it.
    addEnemy (region: Region, enemy: Enemy)
    {
        region.enemies.push(enemy);
        region.layer.add([enemy.obj, enemy.barBg, enemy.bar]);
        if (enemy.shadow) region.layer.add(enemy.shadow);

        return enemy;
    }

    spawnDdos (region: Region)
    {
        if (this.over) return;

        const maxHp = DDOS_HP + (this.wave - 1) * 3;
        const start = region.route.getStartPoint();
        const obj = this.add.follower(region.route, start.x, start.y, 'tortoise-ddos')
            .setDepth(5)
            .setScale(DDOS_SCALE);

        const barBg = this.add.rectangle(0, 0, 20, 4, 0x000000, 0.6).setDepth(6);
        const bar = this.add.rectangle(0, 0, 18, 2, RED).setOrigin(0, 0.5).setDepth(6);

        const enemy = this.addEnemy(region, {
            region,
            obj, follower: obj, flying: false, boss: false,
            hp: maxHp, maxHp, damage: DDOS_DAMAGE, bounty: DDOS_BOUNTY,
            barBg, bar, barW: 18, barOffset: 18,
            vx: 0, vy: 0, turnAt: 0,
            cloaked: false, cloakAt: 0, uncloakAt: 0, alive: true
        });

        obj.startFollow({
            duration: (region.route.getLength() / DDOS_SPEED) * 1000,
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
    //  ms, so no fixed set of pads can cover it. updateRegion() drives it.
    spawnInjection (region: Region)
    {
        if (this.over) return;

        const maxHp = INJECT_HP + (this.wave - 1) * INJECT_HP_GROWTH;
        const y = PhaserMath.Between(FLOOR_Y + 60, 768 - 60);

        const obj = this.add.sprite(-40, y, 'tortoise-injection')
            .setDepth(8)
            .setScale(INJECT_SCALE);

        const shadow = this.add.ellipse(-40, y + 22, 34, 12, 0x000000, 0.3).setDepth(7);

        const barBg = this.add.rectangle(0, 0, 34, 5, 0x000000, 0.6).setDepth(9);
        const bar = this.add.rectangle(0, 0, 32, 3, VIOLET).setOrigin(0, 0.5).setDepth(9);

        this.addEnemy(region, {
            region,
            obj, flying: true, boss: false,
            hp: maxHp, maxHp, damage: INJECT_DAMAGE, bounty: INJECT_BOUNTY,
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
            enemy.obj.x, enemy.obj.y, ORIGIN_X, this.cy(enemy.region.layout.originRow)
        );

        const spread = PhaserMath.DegToRad(INJECT_SPREAD);
        const angle = toOrigin + PhaserMath.FloatBetween(-spread, spread);

        enemy.vx = Math.cos(angle) * INJECT_SPEED;
        enemy.vy = Math.sin(angle) * INJECT_SPEED;
        enemy.turnAt = this.time.now + PhaserMath.Between(INJECT_TURN_MIN, INJECT_TURN_MAX);
    }

    //  Push this.integrity to the HUD readout and to the bar on every hall's
    //  origin rack — one origin server, several views of it.
    showIntegrity ()
    {
        this.integrityText.setText(`INTEGRITY ${this.integrity}%`);
        this.integrityText.setColor(this.integrity <= 30 ? '#ef4444' : '#8ea3b8');

        const colour = this.integrity <= 30 ? RED : this.integrity <= 60 ? ACCENT : GREEN;

        for (const region of this.regions)
        {
            region.integrityBar.width = this.integrity;
            region.integrityBar.setFillStyle(colour);
        }
    }

    //  Enemy reached the origin server. Which hall it did that in makes no
    //  difference to the damage — the origin is shared.
    breach (enemy: Enemy)
    {
        if (!enemy.alive || this.over) return;

        const region = enemy.region;
        const { x, y } = enemy.obj;
        const damage = enemy.damage;
        this.killEnemy(enemy, false);

        this.integrity = Math.max(0, this.integrity - damage);
        this.showIntegrity();

        //  Light the hall's tab up so a breach you cannot see still tells you
        //  where it happened.
        region.alertUntil = this.time.now + REGION_ALERT_MS;

        //  A flyer landing on the origin is a much bigger event than one more
        //  packet in the flood.
        const heavy = damage >= INJECT_DAMAGE;

        //  Heavy breaches stack on purpose: several flyers landing together
        //  should pile up into a chorus rather than collapse into one call. No
        //  minGap, and the jitter goes up so overlapping copies are audibly
        //  separate turtles instead of one phase-aligned turtle. Volume comes
        //  down to leave room for three or four at once without the master
        //  clipping.
        //
        //  The light version keeps its throttle. It fires per arriving packet
        //  and the flood spawns 260ms apart, which is a pile-up of a different
        //  and much less funny kind.
        if (heavy) this.sfx('sfx-breach-heavy', { volume: 0.75, jitter: 0.09 });
        else this.sfx('sfx-breach', { volume: 0.85, minGap: 400, jitter: 0.03 });

        this.cameras.main.shake(heavy ? 320 : 180, heavy ? 0.012 : 0.006);
        this.cameras.main.flash(120, 239, 68, 68);

        //  Floating damage readout. It lives in the hall it happened in, so a
        //  breach off screen gets a banner instead — but only for the heavy
        //  ones, or the flood would fill the HUD with them.
        const hit = this.add.text(x, y - 30, `-${damage}% INTEGRITY`, {
            fontFamily: 'Arial Black', fontSize: 13, color: '#ef4444'
        }).setOrigin(0.5).setDepth(9);

        region.layer.add(hit);

        this.tweens.add({
            targets: hit, y: y - 70, alpha: 0, duration: 900, onComplete: () => hit.destroy()
        });

        if (heavy && region !== this.current())
        {
            this.flashHud(`BREACH IN ${region.name}  ·  -${damage}% INTEGRITY`);
        }

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
    //  the p99 readout jumps, then eases back to the new baseline. Every hall
    //  slows down together — it is one control plane.
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
            { at: 80, run: () => this.killPowerDomain(0) },
            { at: 70, run: () => { this.billing = 0.6; this.flashHud('BILLING THROTTLED  ·  BOUNTY -40%'); } },
            { at: 60, run: () => { this.setStatus('IMPAIRED', '#f97316'); this.setWaveGap(7500); } },
            { at: 50, run: () => { this.fireRateMult = 1.1; this.flashHud('COOLING LOSS  ·  TOWERS -10% RATE'); } },
            { at: 40, run: () => { this.killPowerDomain(1); this.spikeMs = 4000; } },
            { at: 30, run: () => { this.setStatus('CRITICAL', '#ef4444'); this.startVignette(); this.setWaveGap(5500); } },
            { at: 20, run: () => { this.startBrownouts(); this.flashHud('BROWNOUTS  ·  TOWERS DROPPING'); } },
            { at: 10, run: () => { this.fireRateMult = 1.2; this.setWaveGap(3500); this.flashHud('ORIGIN FAILING'); } }
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

    //  A power domain fails. One grid feeds every hall, so it goes dark in all
    //  of them — and is remembered, so a hall provisioned later opens dark too.
    killPowerDomain (slot: number)
    {
        this.powerLost.push(slot);

        for (const region of this.regions)
        {
            //  Which zone goes with it depends on where that hall's rack sits,
            //  so the same domain can take AZ-C in one hall and AZ-A in another.
            this.darkenAz(region, this.azForDomain(region, slot));
        }

        const az = this.azForDomain(this.current(), slot);

        this.flashHud(`${PWR_NAMES[slot]} OFFLINE  ·  ${az.name} TOWERS SLOWED`);
    }

    //  A zone loses its feed. Its towers keep firing and keep their range, they
    //  just reload AZ_SLOW times slower — see the tower loop in update().
    darkenAz (region: Region, az: Az)
    {
        az.dark = true;

        az.box.setStrokeStyle(2, AZ_LINE_DARK, 0.9);
        az.label.setColor(AZ_TAG_DARK);
        az.label.setText(`${az.name}  OFFLINE`);

        for (const tower of region.towers)
        {
            if (tower.az === az) this.paintTower(tower);
        }
    }

    //  Red edge pulse once the region is critical. Screen furniture, not board
    //  furniture, so it is not inside a hall's layer.
    startVignette ()
    {
        this.vignette = this.add.rectangle(512, 384, 1016, 760)
            .setStrokeStyle(10, RED, 0.5)
            .setDepth(9);

        this.tweens.add({
            targets: this.vignette, alpha: 0.25, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut'
        });
    }

    //  Random towers drop offline for a moment, anywhere in the region.
    startBrownouts ()
    {
        this.brownoutTimer = this.time.addEvent({
            delay: BROWNOUT_EVERY,
            loop: true,
            callback: () => {
                if (this.over) return;

                const live: Tower[] = [];
                for (const region of this.regions)
                {
                    for (const tower of region.towers) if (!tower.offline) live.push(tower);
                }

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

    //  Brief banner under the HUD when a tier trips, a wave escalates, a hall
    //  comes online, or a boss goes down.
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

        //  Covers both routes a boss leaves the board by: killed, or reaching
        //  the origin. Once the last one in any hall is gone the bed comes back.
        if (enemy.boss) this.refreshMusic();

        if (!reward) return;

        //  Every kill is worth the same 10 score; the money depends on the mob.
        this.score += 10;
        this.budget += Math.round(enemy.bounty * this.billing);
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

        const tx = target.obj.x;
        const ty = target.obj.y;
        const angle = PhaserMath.Angle.Between(tower.x, tower.y, tx, ty);

        this.sfx(spec.fireSfx, { volume: spec.fireVolume, minGap: spec.fireGap });

        //  Snap onto the exact firing line: TURN_RATE may still be mid-swing,
        //  and a shot leaving at an angle the barrel isn't pointing reads as a
        //  bug rather than as a fast turret.
        tower.sprite.rotation = angle;

        this.kick(tower, angle);
        this.muzzle(tower.region, tower.x, tower.y, angle);
        this.tracer(tower.region, tower.x, tower.y, tx, ty, angle);

        const bullet = this.add.image(tower.x, tower.y, spec.shot).setDepth(6);
        tower.region.layer.add(bullet);

        if (spec.shotFacing) bullet.setRotation(angle);

        tower.region.bullets.push({
            obj: bullet, target, damage: spec.damage, speed: spec.bulletSpeed,
            facing: spec.shotFacing
        });
    }

    //  Punch the emplacement back along its firing line. Nothing tweens it
    //  home — the tower loop in update() eases every sprite back to its slot,
    //  so a kick can land while the build pop is still playing, and Shield's
    //  120ms cadence can't stack recoils on top of each other.
    kick (tower: Tower, angle: number)
    {
        const back = tower.spec.beam ? RECOIL_BEAM_PX : RECOIL_PX;

        tower.sprite.x = tower.x - Math.cos(angle) * back;
        tower.sprite.y = tower.y - Math.sin(angle) * back;
    }

    //  Bore bloom. Shared by projectile and beam towers, so the discharge and
    //  the shot always start from the same flare. Layered into the firing hall
    //  so an off-screen tower's flare stays off screen.
    muzzle (region: Region, x: number, y: number, angle: number, to = 2.2)
    {
        const bloom = this.add.image(x, y, 'shot-muzzle').setRotation(angle).setDepth(7);
        region.layer.add(bloom);

        this.tweens.add({
            targets: bloom, scale: to, alpha: 0, duration: 170,
            onComplete: () => bloom.destroy()
        });
    }

    //  The lane: stretched (not tiled) from bore to target and gone in 120ms,
    //  which is short enough that Shield's 120ms cadence never stacks two.
    tracer (region: Region, x: number, y: number, tx: number, ty: number, angle: number)
    {
        const lane = this.add.image(x, y, 'shot-tracer')
            .setOrigin(0, 0.5)
            .setRotation(angle)
            .setDisplaySize(PhaserMath.Distance.Between(x, y, tx, ty), 8)
            .setDepth(5)
            .setAlpha(0.55);

        region.layer.add(lane);

        this.tweens.add({
            targets: lane, alpha: 0, duration: 120, onComplete: () => lane.destroy()
        });
    }

    //  Ice lance. No projectile — everything inside the swept line takes the
    //  full hit the moment the tower fires, so the visual is pure decoration.
    fireBeam (tower: Tower, target: Enemy)
    {
        const spec = tower.spec;
        const region = tower.region;
        const angle = PhaserMath.Angle.Between(tower.x, tower.y, target.obj.x, target.obj.y);
        const len = spec.range + BEAM_OVERSHOOT;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        tower.sprite.rotation = angle;
        this.kick(tower, angle);

        //  Project each mob onto the beam: `along` is how far down the lance it
        //  sits, `off` is how far off the centre line. Only this hall's mobs —
        //  a lance cannot reach into the room next door.
        const struck: Enemy[] = [];

        for (const e of region.enemies)
        {
            if (!this.canEngage(spec, e)) continue;

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

        const flash = this.add.circle(tower.x, tower.y, 15, 0xffffff, 0.85).setDepth(8);

        region.layer.add([glow, core, flash]);

        this.tweens.add({
            targets: core, scaleY: 0.08, alpha: 0, duration: 260, ease: 'Cubic.In',
            onComplete: () => core.destroy()
        });

        this.tweens.add({
            targets: glow, scaleY: 1.8, alpha: 0, duration: 340, ease: 'Cubic.Out',
            onComplete: () => glow.destroy()
        });

        this.muzzle(region, tower.x, tower.y, angle, 3.2);

        //  Decoration: `struck` already took the damage the instant the tower
        //  fired. The slug just gives the discharge something to follow.
        const slug = this.add.image(tower.x, tower.y, spec.shot)
            .setRotation(angle)
            .setDepth(7);

        region.layer.add(slug);

        this.tweens.add({
            targets: slug,
            x: tower.x + cos * len,
            y: tower.y + sin * len,
            alpha: 0,
            duration: 230,
            ease: 'Quad.In',
            onComplete: () => slug.destroy()
        });

        //  Small kick so a discharge this expensive reads as an event.
        this.cameras.main.shake(90, 0.002);
    }

    //  Can this tower engage this mob at all?
    //
    //  Both targeting paths go through here on purpose. nearestEnemy() picks a
    //  target, but fireBeam() ignores that choice and sweeps everything along
    //  the lance, so a rule enforced in only one place leaks: the snowmobile
    //  would refuse to aim at a flyer and then shred it in passing anyway.
    //
    //  Taking the whole spec rather than a widening list of booleans, since this
    //  is the second such capability and there will be more.
    canEngage (spec: TowerSpec, e: Enemy)
    {
        if (!e.alive) return false;

        //  Smoke-dashing shinobi are only visible to identity checks.
        if (e.cloaked && !spec.seesCloaked) return false;

        //  Airborne mobs ignore the trench entirely, and only WAF reaches them.
        if (e.flying && !spec.hitsFlying) return false;

        return true;
    }

    //  Towers only see their own hall.
    nearestEnemy (region: Region, x: number, y: number, spec: TowerSpec): Enemy | null
    {
        let best: Enemy | null = null;
        let bestDist = spec.range;

        for (const e of region.enemies)
        {
            if (!this.canEngage(spec, e)) continue;

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
        this.provisionAt = 0;

        //  Every firing sound is now dead, so this has the mix to itself. The
        //  SoundManager is global, so the tail carries into the GameOver scene.
        this.stopMusic(500);
        this.sfx('sfx-region-down');

        for (const region of this.regions)
        {
            for (const e of region.enemies) if (e.alive) e.follower?.pauseFollow();
        }

        this.cameras.main.shake(400, 0.012);
        this.time.delayedCall(600, () => this.scene.start('GameOver', { score: this.score, wave: this.wave }));
    }

    update (_time: number, delta: number)
    {
        if (this.over) return;

        const dt = delta / 1000;

        this.updateWaveText();

        //  A new hall comes online mid-gap — see startWave().
        if (this.provisionAt > 0 && this.time.now >= this.provisionAt) this.provisionRegion();

        //  Cooldown is stretched by cooling loss and by any active latency
        //  spike, both of which are region-wide.
        const spiking = this.time.now < this.spikeUntil;
        const penalty = this.fireRateMult * (spiking ? LATENCY_PENALTY : 1);

        for (const region of this.regions) this.updateRegion(region, delta, dt, penalty);

        this.paintTabs();
        this.paintPowerups();
    }

    //  One hall's simulation. Runs whether or not the hall is on screen: the
    //  hall you are not watching is exactly as dangerous as the one you are.
    updateRegion (region: Region, delta: number, dt: number, penalty: number)
    {
        //  Shinobi cloak on their own clock. cloakAt of 0 means "already
        //  cloaked", uncloakAt of 0 means "not cloaked", so mobs that never
        //  cloak (flood, flyers) sit at 0/0 and are skipped by both branches.
        for (const e of region.enemies)
        {
            if (!e.alive) continue;

            if (e.cloakAt > 0 && this.time.now >= e.cloakAt) this.cloakDash(e);
            else if (e.uncloakAt > 0 && this.time.now >= e.uncloakAt) this.uncloak(e);
        }

        //  Rate limiting throttles the whole board, and it multiplies onto
        //  whatever a mob was already doing — a dashing shinobi stays
        //  proportionally faster than the flood.
        const limit = this.time.now < this.rateLimitUntil ? RATE_LIMIT_SLOW : 1;

        //  Walkers ride their pathTween; scaling it is the cheapest way to
        //  change speed mid-follow without restarting the follow. Re-derived
        //  every frame so cloak dashes and the throttle compose either way.
        for (const e of region.enemies)
        {
            if (!e.alive) continue;

            const tween = e.follower?.pathTween;
            if (tween) tween.timeScale = (e.cloaked ? NINJA_DASH_MULT : 1) * limit;
        }

        //  Flyers move themselves — no path, so this is their whole AI.
        for (const e of region.enemies)
        {
            if (!e.alive || !e.flying) continue;

            if (this.time.now >= e.turnAt) this.steer(e);

            e.obj.x += e.vx * dt * limit;
            e.obj.y += e.vy * dt * limit;

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
        for (const e of region.enemies)
        {
            if (!e.alive) continue;

            const by = e.obj.y - e.barOffset;
            e.barBg.setPosition(e.obj.x, by);
            e.bar.setPosition(e.obj.x - e.barW / 2, by);
            e.bar.width = e.barW * (e.hp / e.maxHp);
        }

        //  Towers acquire the closest target in range and shoot on cooldown.
        for (const t of region.towers)
        {
            //  Settle any recoil first, so a tower that browns out mid-kick
            //  still slides home instead of freezing off-centre.
            const dx = t.x - t.sprite.x;
            const dy = t.y - t.sprite.y;

            if (dx !== 0 || dy !== 0)
            {
                if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1)
                {
                    t.sprite.setPosition(t.x, t.y);
                }
                else
                {
                    const settle = Math.min(1, dt * RECOIL_SETTLE);
                    t.sprite.x += dx * settle;
                    t.sprite.y += dy * settle;
                }
            }

            if (t.offline) continue;

            //  Target is resolved every frame, not just when the cooldown is
            //  up, so the emplacement can track a mob while it reloads and is
            //  already lined up when it fires.
            const target = this.nearestEnemy(region, t.x, t.y, t.spec);

            if (target)
            {
                t.sprite.rotation = PhaserMath.Angle.RotateTo(
                    t.sprite.rotation,
                    PhaserMath.Angle.Between(t.x, t.y, target.obj.x, target.obj.y),
                    TURN_RATE * dt
                );
            }

            t.cooldown -= delta;
            if (t.cooldown > 0) continue;
            if (!target) continue;

            t.cooldown = t.spec.rate * penalty * (t.az.dark ? AZ_SLOW : 1);
            this.fire(t, target);
        }

        //  Homing bullets.
        for (const b of region.bullets)
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

            //  Homing means the heading changes in flight, so point-first art
            //  has to be re-aimed every frame, not just at spawn.
            if (b.facing) b.obj.rotation = angle;
        }

        region.bullets = region.bullets.filter(b => b.obj.active);
        region.enemies = region.enemies.filter(e => e.alive);
    }

    hit (enemy: Enemy, damage: number)
    {
        if (!enemy.alive) return;

        enemy.hp -= damage;

        const layer = enemy.region.layer;

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
            layer.add(pop);

            this.tweens.add({
                targets: pop, scale: 3, alpha: 0, duration: boss ? 500 : flying ? 340 : 220,
                onComplete: () => pop.destroy()
            });

            //  Killing a tank is the biggest thing that happens in a run.
            if (boss)
            {
                this.cameras.main.shake(260, 0.008);
                this.flashHud(`LEATHERBACK DOWN  ·  +$${Math.round(TANK_BOUNTY * this.billing)}`, '#22c55e');
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
        layer.add(spark);

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
        //  left and fitText()'d so nothing can grow into the buttons. The region
        //  tabs sit in the strip above them; see makeTab().
        this.makePicker('iam', 591);
        this.makePicker('shield', 711);
        this.makePicker('waf', 831);
        this.makePicker('snowmobile', 951);
        this.refreshPickers();

        this.statusText = this.add.text(182, 2, 'HEALTHY', {
            fontFamily: 'Arial Black', fontSize: 15, color: '#22c55e'
        }).setOrigin(0.5, 0).setDepth(10);

        this.latencyText = this.add.text(182, 22, `p99 ${BASE_LATENCY}ms`, {
            fontFamily: 'Arial', fontSize: 12, color: '#5c728a'
        }).setOrigin(0.5, 0).setDepth(10);

        this.waveText = this.add.text(355, 4, 'WAVE 1', {
            fontFamily: 'Arial', fontSize: 13, color: '#8ea3b8'
        }).setOrigin(0.5, 0).setDepth(10);

        this.integrityText = this.add.text(355, 24, 'INTEGRITY 100%', {
            fontFamily: 'Arial Black', fontSize: 14, color: '#8ea3b8'
        }).setOrigin(0.5, 0).setDepth(10);

        //  Incident response, stacked between the wave readout and the towers.
        this.makePowerup(0, 'RATE LIMIT', RATE_LIMIT_COST,
            () => this.time.now < this.rateLimitUntil, () => this.rateLimit());
        this.makePowerup(1, 'CALL THE CTO', CTO_COST,
            () => false, () => this.callCto());
        this.paintPowerups();
    }

    //  One incident-response button. Unlike a tower there is nothing to arm:
    //  clicking it spends the money and fires the effect on the spot.
    makePowerup (row: number, label: string, cost: number, on: () => boolean, run: () => void)
    {
        const y = 20 + row * (PWRUP_H + 4);

        const box = this.add.rectangle(PWRUP_X, y, PWRUP_W, PWRUP_H)
            .setStrokeStyle(1, PAD_LINE, 0.9)
            .setDepth(10)
            .setInteractive({ useHandCursor: true });

        const name = this.add.text(PWRUP_X, y - 5, label, {
            fontFamily: 'Arial Black', fontSize: 8, color: '#8ea3b8'
        }).setOrigin(0.5).setDepth(11);

        const price = this.add.text(PWRUP_X, y + 6, `$${cost}`, {
            fontFamily: 'Arial', fontSize: 8, color: '#5c728a'
        }).setOrigin(0.5).setDepth(11);

        this.fitText(name, PWRUP_W - 8);

        box.on('pointerdown', run);

        this.powerups.push({ box, name, price, cost, on, state: '' });
    }

    //  Runs every frame with the same paint-on-change guard as the tabs:
    //  affordability tracks the budget, and the rate-limit button holds an ice
    //  glow for as long as its throttle does.
    paintPowerups ()
    {
        for (const p of this.powerups)
        {
            const active = p.on();
            const afford = this.budget >= p.cost;

            const state = `${active}|${afford}`;
            if (state === p.state) continue;
            p.state = state;

            const colour = active ? ICE : afford ? ACCENT : PAD_LINE;

            p.box.setStrokeStyle(active ? 2 : 1, colour, active || afford ? 0.9 : 0.5);
            p.box.setFillStyle(colour, active ? 0.22 : 0);
            p.name.setColor(active ? '#67e8f9' : afford ? '#e6edf3' : '#5c728a');
            p.price.setColor(active ? '#67e8f9' : afford ? '#ff9900' : '#5c728a');
        }
    }

    //  Throttle every mob in every region to a crawl for a few seconds. The
    //  discount is applied per-frame in updateRegion(), which reads the clock,
    //  so mobs that spawn mid-throttle are throttled too.
    rateLimit ()
    {
        if (this.over || this.time.now < this.rateLimitUntil) return;

        if (this.budget < RATE_LIMIT_COST)
        {
            this.rejectPurchase();
            return;
        }

        this.budget -= RATE_LIMIT_COST;
        this.budgetText.setText(`$${this.budget}`);
        this.rateLimitUntil = this.time.now + RATE_LIMIT_MS;

        this.sfx('sfx-ui-click', { volume: 0.9 });
        this.flashHud('429  ·  RATE LIMITING EVERY REGION', '#67e8f9');
    }

    //  Clear the board, everywhere. Pays no bounty — the CTO takes the credit.
    //  Refused with the buy-error buzz when there is nothing to destroy, so a
    //  misclick between waves cannot quietly eat the money.
    callCto ()
    {
        if (this.over) return;

        const doomed: Enemy[] = [];

        for (const r of this.regions)
        {
            for (const e of r.enemies) if (e.alive) doomed.push(e);
        }

        if (doomed.length === 0 || this.budget < CTO_COST)
        {
            this.rejectPurchase();
            return;
        }

        this.budget -= CTO_COST;
        this.budgetText.setText(`$${this.budget}`);

        for (const e of doomed)
        {
            const pop = this.add.circle(e.obj.x, e.obj.y, e.boss ? 26 : 10, ICE).setDepth(6);
            e.region.layer.add(pop);

            this.tweens.add({
                targets: pop, scale: 3, alpha: 0, duration: 320,
                onComplete: () => pop.destroy()
            });

            this.killEnemy(e, false);
        }

        this.sfx('sfx-boss-death');
        this.cameras.main.flash(300, 200, 240, 255);
        this.flashHud(`THE CTO HAS BEEN CALLED  ·  ${doomed.length} THREATS GONE`, '#67e8f9');
    }

    //  Bottom HUD line: which region you are looking at, then every key
    //  binding. Rewritten on mute and on every region switch.
    showHint ()
    {
        const region = this.regions[this.active];
        const where = region ? `${region.name}  ·  ` : '';

        this.hintText.setText(`${where}${HINT}${this.sound.mute ? '  ·  MUTED' : ''}`);
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
            ['PROVISION NEW REGION', () => this.provisionRegion()],
            ['FAIL NEXT POWER DOMAIN', () => this.failNextPower()],
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

    //  Trip the next power domain without grinding integrity down to reach it.
    failNextPower ()
    {
        for (let slot = 0; slot < PWR_NAMES.length; slot++)
        {
            if (!this.powerLost.includes(slot))
            {
                this.killPowerDomain(slot);
                return;
            }
        }

        this.flashHud('EVERY POWER DOMAIN IS ALREADY DARK');
    }

    //  Every hall, not just the one on screen.
    clearEnemies ()
    {
        for (const region of this.regions)
        {
            for (const e of [...region.enemies]) this.killEnemy(e, false);
            region.enemies = [];
        }
    }

    //  One HUD build button. Clicking it buys the tower if locked and
    //  otherwise arms it for the next pad click.
    makePicker (kind: TowerKind, x: number)
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
        const text = this.add.text(x + 14, 31, spec.name, {
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

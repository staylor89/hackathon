import { Scene, GameObjects, Math as PhaserMath, TintModes } from 'phaser';

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

//  ── Balance ──────────────────────────────────────────────────────────────
const SHIELD_COST = 100;
const SHIELD_RANGE = 130;
const SHIELD_RATE = 450;      // ms between shots
const SHIELD_DAMAGE = 10;
const BULLET_SPEED = 620;     // px/sec

const DDOS_SPEED = 110;       // px/sec along the trench
const DDOS_HP = 30;           // +10 per wave
const DDOS_DAMAGE = 10;       // integrity lost if it reaches the origin
const DDOS_BOUNTY = 25;
const SPAWN_EVERY = 1500;     // ms
const WAVE_SIZE = 8;

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
    obj: GameObjects.PathFollower;
    hp: number;
    maxHp: number;
    barBg: GameObjects.Rectangle;
    bar: GameObjects.Rectangle;
    alive: boolean;
}

interface Tower {
    x: number;
    y: number;
    cooldown: number;
}

interface Bullet {
    obj: GameObjects.Arc;
    target: Enemy;
}

export class Game extends Scene
{
    //  Run state
    budget = 500;
    integrity = 100;
    wave = 1;
    score = 0;
    spawned = 0;
    over = false;

    //  Live objects
    enemies: Enemy[] = [];
    towers: Tower[] = [];
    bullets: Bullet[] = [];

    route: Phaser.Curves.Path;
    spawner: Phaser.Time.TimerEvent;

    //  HUD
    budgetText: GameObjects.Text;
    waveText: GameObjects.Text;
    integrityText: GameObjects.Text;
    integrityBar: GameObjects.Rectangle;

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
        this.wave = 1;
        this.score = 0;
        this.spawned = 0;
        this.over = false;
        this.enemies = [];
        this.towers = [];
        this.bullets = [];

        this.makeTextures();

        this.add.rectangle(512, 384, 1024, 768, BG);

        this.drawFloor();
        this.route = this.drawRoute();
        this.drawIngress();
        this.drawOrigin();
        this.drawDecor();
        this.drawPads();
        this.drawHud();

        this.spawner = this.time.addEvent({
            delay: SPAWN_EVERY,
            loop: true,
            callback: () => this.spawnDdos()
        });

        this.input.keyboard?.once('keydown-ESC', () => {
            this.scene.start('MainMenu');
        });
    }

    //  No art in the repo — enemy and bullet textures are drawn at boot.
    makeTextures ()
    {
        if (!this.textures.exists('ddos'))
        {
            const g = this.make.graphics({ x: 0, y: 0 }, false);
            g.fillStyle(0x7f1d1d, 1);
            g.fillCircle(15, 15, 14);
            g.fillStyle(RED, 1);
            g.fillCircle(15, 15, 10);
            g.fillStyle(0xfecaca, 1);
            g.fillCircle(15, 15, 3.5);
            g.generateTexture('ddos', 30, 30);
            g.destroy();
        }
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

    //  One buildable slot: hover shows the range ring, click builds a SHIELD.
    makePad (col: number, row: number)
    {
        const x = this.cx(col);
        const y = this.cy(row);

        const pad = this.add.rectangle(x, y, 46, 46)
            .setStrokeStyle(1, PAD_LINE, 0.9)
            .setInteractive({ useHandCursor: true });

        const ring = this.add.circle(x, y, SHIELD_RANGE, ACCENT, 0.07)
            .setStrokeStyle(1, ACCENT, 0.35)
            .setVisible(false);

        pad.on('pointerover', () => {
            pad.setFillStyle(ACCENT, 0.16).setStrokeStyle(1, ACCENT, 0.9);
            ring.setVisible(true);
        });

        pad.on('pointerout', () => {
            pad.setFillStyle(BG, 0).setStrokeStyle(1, PAD_LINE, 0.9);
            ring.setVisible(false);
        });

        pad.on('pointerdown', () => {
            if (this.over) return;

            if (this.budget < SHIELD_COST)
            {
                //  Can't afford it — flash the budget red.
                this.budgetText.setColor('#ef4444');
                this.time.delayedCall(250, () => this.budgetText.setColor('#ff9900'));
                return;
            }

            this.budget -= SHIELD_COST;
            this.budgetText.setText(`$${this.budget}`);

            pad.disableInteractive();
            pad.setFillStyle(BG, 0).setStrokeStyle(1, ACCENT, 0.4);
            ring.setVisible(false);

            this.buildShield(x, y);
        });
    }

    buildShield (x: number, y: number)
    {
        const box = this.add.rectangle(x, y, 40, 40, 0x16243a).setStrokeStyle(2, ACCENT).setDepth(4);
        const label = this.add.text(x, y, 'SHLD', {
            fontFamily: 'Arial Black', fontSize: 11, color: '#ff9900'
        }).setOrigin(0.5).setDepth(4);

        box.setScale(0.4);
        label.setScale(0.4);
        this.tweens.add({ targets: [box, label], scale: 1, duration: 180, ease: 'Back.Out' });

        this.towers.push({ x, y, cooldown: 0 });
    }

    // ── Combat ───────────────────────────────────────────────────────────

    spawnDdos ()
    {
        if (this.over) return;

        this.spawned++;
        this.wave = Math.floor((this.spawned - 1) / WAVE_SIZE) + 1;
        this.waveText.setText(`WAVE ${this.wave}  ·  DDoS FLOOD`);

        const maxHp = DDOS_HP + (this.wave - 1) * 10;
        const start = this.route.getStartPoint();
        const obj = this.add.follower(this.route, start.x, start.y, 'ddos').setDepth(5);

        const barBg = this.add.rectangle(0, 0, 28, 5, 0x000000, 0.6).setDepth(6);
        const bar = this.add.rectangle(0, 0, 26, 3, RED).setOrigin(0, 0.5).setDepth(6);

        const enemy: Enemy = { obj, hp: maxHp, maxHp, barBg, bar, alive: true };

        obj.startFollow({
            duration: (this.route.getLength() / DDOS_SPEED) * 1000,
            positionOnPath: true,
            onComplete: () => this.breach(enemy)
        });

        this.tweens.add({
            targets: obj, scale: 1.18, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.InOut'
        });

        this.enemies.push(enemy);
    }

    //  Enemy reached the origin server.
    breach (enemy: Enemy)
    {
        if (!enemy.alive || this.over) return;

        this.killEnemy(enemy, false);

        this.integrity = Math.max(0, this.integrity - DDOS_DAMAGE);
        this.integrityText.setText(`INTEGRITY ${this.integrity}%`);
        this.integrityText.setColor(this.integrity <= 30 ? '#ef4444' : '#8ea3b8');
        this.integrityBar.width = this.integrity;
        this.integrityBar.setFillStyle(this.integrity <= 30 ? RED : this.integrity <= 60 ? ACCENT : GREEN);

        this.cameras.main.shake(180, 0.006);
        this.cameras.main.flash(120, 239, 68, 68);

        if (this.integrity <= 0) this.fail();
    }

    killEnemy (enemy: Enemy, reward: boolean)
    {
        enemy.alive = false;
        enemy.obj.stopFollow();
        this.tweens.killTweensOf(enemy.obj);
        enemy.obj.destroy();
        enemy.barBg.destroy();
        enemy.bar.destroy();

        if (!reward) return;

        this.score += 10;
        this.budget += DDOS_BOUNTY;
        this.budgetText.setText(`$${this.budget}`);
    }

    fire (tower: Tower, target: Enemy)
    {
        const bullet = this.add.circle(tower.x, tower.y, 4, ACCENT).setDepth(6);
        this.bullets.push({ obj: bullet, target });
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

        for (const e of this.enemies) if (e.alive) e.obj.pauseFollow();

        this.cameras.main.shake(400, 0.012);
        this.time.delayedCall(600, () => this.scene.start('GameOver', { score: this.score }));
    }

    update (_time: number, delta: number)
    {
        if (this.over) return;

        //  Health bars ride along above each enemy.
        for (const e of this.enemies)
        {
            if (!e.alive) continue;

            e.barBg.setPosition(e.obj.x, e.obj.y - 22);
            e.bar.setPosition(e.obj.x - 13, e.obj.y - 22);
            e.bar.width = 26 * (e.hp / e.maxHp);
        }

        //  Towers acquire the closest target in range and shoot on cooldown.
        for (const t of this.towers)
        {
            t.cooldown -= delta;
            if (t.cooldown > 0) continue;

            const target = this.nearestEnemy(t.x, t.y, SHIELD_RANGE);
            if (!target) continue;

            t.cooldown = SHIELD_RATE;
            this.fire(t, target);
        }

        //  Homing bullets.
        const step = (BULLET_SPEED * delta) / 1000;

        for (const b of this.bullets)
        {
            if (!b.target.alive)
            {
                b.obj.destroy();
                continue;
            }

            const tx = b.target.obj.x;
            const ty = b.target.obj.y;
            const d = PhaserMath.Distance.Between(b.obj.x, b.obj.y, tx, ty);

            if (d <= step + 6)
            {
                this.hit(b.target);
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

    hit (enemy: Enemy)
    {
        enemy.hp -= SHIELD_DAMAGE;

        if (enemy.hp <= 0)
        {
            const { x, y } = enemy.obj;
            this.killEnemy(enemy, true);

            const pop = this.add.circle(x, y, 6, ACCENT).setDepth(6);
            this.tweens.add({
                targets: pop, scale: 3, alpha: 0, duration: 220, onComplete: () => pop.destroy()
            });
            return;
        }

        //  Flash white on damage. Phaser 4 splits tint colour from tint mode.
        enemy.obj.setTint(0xffffff).setTintMode(TintModes.FILL);
        this.time.delayedCall(60, () => {
            if (enemy.alive) enemy.obj.setTintMode(TintModes.MULTIPLY).clearTint();
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

        this.add.text(16, 40, 'DATA HALL 1  ·  AZ-C  ·  not on the status page', {
            fontFamily: 'Arial', fontSize: 12, color: '#5c728a'
        }).setDepth(10);

        this.budgetText = this.add.text(1014, 12, `$${this.budget}`, {
            fontFamily: 'Arial Black', fontSize: 22, color: '#ff9900'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(1014, 40, `SHIELD  $${SHIELD_COST}`, {
            fontFamily: 'Arial', fontSize: 12, color: '#5c728a'
        }).setOrigin(1, 0).setDepth(10);

        this.waveText = this.add.text(512, 12, 'WAVE 1  ·  DDoS FLOOD', {
            fontFamily: 'Arial', fontSize: 16, color: '#8ea3b8'
        }).setOrigin(0.5, 0).setDepth(10);

        this.integrityText = this.add.text(512, 34, 'INTEGRITY 100%', {
            fontFamily: 'Arial Black', fontSize: 14, color: '#8ea3b8'
        }).setOrigin(0.5, 0).setDepth(10);

        this.add.text(512, 52, 'click a slot to build a SHIELD  ·  ESC menu', {
            fontFamily: 'Arial', fontSize: 11, color: '#5c728a'
        }).setOrigin(0.5, 0).setDepth(10);
    }
}

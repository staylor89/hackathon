import { Scene } from 'phaser';

export class Preloader extends Scene
{
    constructor ()
    {
        super('Preloader');
    }

    init ()
    {
        this.add.rectangle(512, 384, 1024, 768, 0x0b1120);

        this.add.text(512, 330, 'EU-TORT-3', {
            fontFamily: 'Arial Black', fontSize: 40, color: '#e6edf3'
        }).setOrigin(0.5);

        this.add.rectangle(512, 400, 468, 24).setStrokeStyle(1, 0xff9900);

        const bar = this.add.rectangle(512 - 230, 400, 4, 20, 0xff9900);

        this.load.on('progress', (progress: number) => {
            bar.width = 4 + (460 * progress);
        });
    }

    preload ()
    {
        //  The default intruder — shinobi tortoise. Every wave spawns these.
        this.load.image('tortoise-default', 'assets/tortoise-default.png');

        //  DDoS swarm tortoise. 64x64, drawn facing right.
        this.load.image('tortoise-ddos', 'assets/tortoise-ddos.png');

        //  SQL injection tortoise — the flyer. 64x64, drawn facing right.
        this.load.image('tortoise-injection', 'assets/tortoise-injection.png');

        //  Enterprise Customer tank — the boss. 96x96, not 64.
        this.load.image('tortoise-tank', 'assets/tortoise-tank.png');

        //  Towers. 64x64 top-down emplacements, drawn on a 50x50 baseplate, so
        //  they sit on a 64px grid tile at scale 1 with no fitting to do.
        this.load.image('tower-iam', 'assets/tower-iam.png');
        this.load.image('tower-shield', 'assets/tower-shield.png');
        this.load.image('tower-waf', 'assets/tower-waf.png');
        this.load.image('tower-snowmobile', 'assets/tower-snowmobile.png');

        //  Firing lanes. Every directional piece is drawn pointing right, same
        //  as the mobs, so setRotation to the firing angle needs no offset.
        this.load.image('shot-tracer', 'assets/shot-tracer.png');
        this.load.image('shot-muzzle', 'assets/shot-muzzle.png');
        this.load.image('shot-iam', 'assets/shot-iam.png');
        this.load.image('shot-shield', 'assets/shot-shield.png');
        this.load.image('shot-waf', 'assets/shot-waf.png');
        this.load.image('shot-snowmobile', 'assets/shot-snowmobile.png');

        //  Map overlays. map-flow is a seamless chevron tile whose 46px height
        //  is the trench width; map-scan spans the floor's full 704px height.
        this.load.image('map-flow', 'assets/map-flow.png');
        this.load.image('map-scan', 'assets/map-scan.png');
        this.load.image('map-node', 'assets/map-node.png');

        //  Sound. All synthesised by tools/make-sfx.mjs — 44.1kHz mono 16-bit
        //  WAV, deliberately not MP3: encoder padding puts 10-30ms of silence
        //  in front of every file, and Shield fires every 120ms.
        //
        //  make-sfx.mjs also emits glacier / lambda / guardduty firing sounds
        //  for towers that don't exist yet. They're left unloaded on purpose —
        //  Web Audio decodes everything loaded here up front.
        this.load.audio('sfx-iam-fire', 'assets/sfx/tower-iam-fire.wav');
        this.load.audio('sfx-shield-fire', 'assets/sfx/tower-shield-fire.wav');
        this.load.audio('sfx-waf-fire', 'assets/sfx/tower-waf-fire.wav');
        this.load.audio('sfx-snowmobile-fire', 'assets/sfx/tower-snowmobile-fire.wav');

        this.load.audio('sfx-tower-build', 'assets/sfx/tower-build.wav');
        this.load.audio('sfx-tower-sell', 'assets/sfx/tower-sell.wav');
        this.load.audio('sfx-tower-unlock', 'assets/sfx/tower-unlock.wav');
        this.load.audio('sfx-tower-offline', 'assets/sfx/tower-offline.wav');

        this.load.audio('sfx-enemy-hit', 'assets/sfx/enemy-hit.wav');
        this.load.audio('sfx-enemy-death', 'assets/sfx/enemy-death.wav');
        this.load.audio('sfx-boss-death', 'assets/sfx/boss-death.wav');
        this.load.audio('sfx-ninja-dash', 'assets/sfx/ninja-dash.wav');

        //  Breaches and the wave alert are sourced recordings, not synth — see
        //  tools/make-clips.mjs. Light breaches get a 0.34s cut of the same
        //  recording, because the flood arrives 260ms apart.
        this.load.audio('sfx-breach', 'assets/sfx/turtle-mating-short.wav');
        this.load.audio('sfx-breach-heavy', 'assets/sfx/turtle-mating.wav');

        this.load.audio('sfx-wave-start', 'assets/sfx/i-like-turtles.wav');
        this.load.audio('sfx-wave-boss', 'assets/sfx/wave-boss.wav');
        this.load.audio('sfx-region-down', 'assets/sfx/region-down.wav');

        //  A new data hall coming online. The generator's unused GuardDuty ping
        //  is exactly the right shape for it, so no new recipe was needed.
        this.load.audio('sfx-region-up', 'assets/sfx/tower-guardduty-ping.wav');

        this.load.audio('sfx-ui-click', 'assets/sfx/ui-click.wav');
        this.load.audio('sfx-place-denied', 'assets/sfx/place-denied.wav');

        //  Music. Two loops from tools/make-music.mjs, both A minor at 96 BPM —
        //  sharing key and tempo is what lets the game crossfade between them
        //  mid-wave without a car crash. 2.5 MB the pair; WAV again, because a
        //  compressed loop hiccups at the seam on every pass.
        this.load.audio('music-core', 'assets/sfx/music-core.wav');
        this.load.audio('music-boss', 'assets/sfx/music-boss.wav');
    }

    create ()
    {
        //  Generate a small white circle texture for particle emitters.
        const g = this.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture('sparkle', 8, 8);
        g.destroy();

        this.scene.start('MainMenu');
    }
}

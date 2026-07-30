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
        //  DDoS swarm tortoise. 64x64, drawn facing right.
        this.load.image('tortoise-ddos', 'assets/tortoise-ddos.png');

        //  SQL injection tortoise — the flyer. 64x64, drawn facing right.
        this.load.image('tortoise-injection', 'assets/tortoise-injection.png');
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

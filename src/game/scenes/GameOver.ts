import { Scene } from 'phaser';

interface GameOverData {
    score?: number;
}

const BG = 0x0b1120;
const GRID = 0x1c2a3a;

export class GameOver extends Scene
{
    score = 0;

    constructor ()
    {
        super('GameOver');
    }

    init (data: GameOverData)
    {
        this.score = data?.score ?? 0;
    }

    create ()
    {
        this.add.rectangle(512, 384, 1024, 768, BG);

        const g = this.add.graphics();
        g.lineStyle(1, GRID, 1);
        for (let x = 0; x <= 1024; x += 64) g.lineBetween(x, 0, x, 768);
        for (let y = 0; y <= 768; y += 64) g.lineBetween(0, y, 1024, y);

        this.add.text(512, 300, 'REGION DOWN', {
            fontFamily: 'Arial Black', fontSize: 80, color: '#ff9900'
        }).setOrigin(0.5);

        this.add.text(512, 400, `Final score: ${this.score}`, {
            fontFamily: 'Arial', fontSize: 32, color: '#e6edf3'
        }).setOrigin(0.5);

        const prompt = this.add.text(512, 560, 'click to try again', {
            fontFamily: 'Arial', fontSize: 22, color: '#5c728a'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: prompt,
            alpha: 0.3,
            ease: 'Sine.InOut',
            duration: 900,
            yoyo: true,
            repeat: -1
        });

        this.input.once('pointerdown', () => {
            this.scene.start('MainMenu');
        });
    }
}

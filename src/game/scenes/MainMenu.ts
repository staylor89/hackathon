import { Scene, GameObjects } from 'phaser';

const BG = 0x0b1120;
const GRID = 0x1c2a3a;
const ACCENT = 0xff9900;

export class MainMenu extends Scene
{
    button: GameObjects.Rectangle;

    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        //  Flat dark backdrop with a faint grid. No art needed — pure Graphics.
        this.add.rectangle(512, 384, 1024, 768, BG);

        const g = this.add.graphics();
        g.lineStyle(1, GRID, 1);
        for (let x = 0; x <= 1024; x += 64) g.lineBetween(x, 0, x, 768);
        for (let y = 0; y <= 768; y += 64) g.lineBetween(0, y, 1024, y);

        this.add.text(512, 220, 'EU-TORT-3', {
            fontFamily: 'Arial Black', fontSize: 96, color: '#e6edf3'
        }).setOrigin(0.5);

        this.add.text(512, 300, 'Europe (Tortoise)  ·  Cloud Defence', {
            fontFamily: 'Arial', fontSize: 26, color: '#8ea3b8'
        }).setOrigin(0.5);

        //  Start button = a rectangle made interactive, with a label on top.
        this.button = this.add.rectangle(512, 460, 260, 68, BG)
            .setStrokeStyle(2, ACCENT)
            .setInteractive({ useHandCursor: true });

        const label = this.add.text(512, 460, 'START', {
            fontFamily: 'Arial Black', fontSize: 32, color: '#ff9900'
        }).setOrigin(0.5);

        this.button.on('pointerover', () => {
            this.button.setFillStyle(ACCENT);
            label.setColor('#0b1120');
        });

        this.button.on('pointerout', () => {
            this.button.setFillStyle(BG);
            label.setColor('#ff9900');
        });

        this.button.on('pointerdown', () => this.startGame());

        const hint = this.add.text(512, 600, 'click START or press SPACE', {
            fontFamily: 'Arial', fontSize: 20, color: '#5c728a'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: hint,
            alpha: 0.3,
            ease: 'Sine.InOut',
            duration: 900,
            yoyo: true,
            repeat: -1
        });

        this.input.keyboard?.once('keydown-SPACE', () => this.startGame());
        this.input.keyboard?.once('keydown-ENTER', () => this.startGame());
    }

    startGame ()
    {
        this.scene.start('Game');
    }
}

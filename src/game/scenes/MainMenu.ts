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

        this.button = this.makeButton(460, 68, 32, 'START', () => this.startGame());
        this.makeButton(545, 44, 20, 'LEADERBOARD', () => this.scene.start('Leaderboard'));

        const hint = this.add.text(512, 610, 'click START or press SPACE', {
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

    //  A menu button: a stroked rectangle that inverts on hover, label on top.
    makeButton (y: number, h: number, fontSize: number, label: string, onClick: () => void)
    {
        const button = this.add.rectangle(512, y, 260, h, BG)
            .setStrokeStyle(2, ACCENT)
            .setInteractive({ useHandCursor: true });

        const text = this.add.text(512, y, label, {
            fontFamily: 'Arial Black', fontSize, color: '#ff9900'
        }).setOrigin(0.5);

        button.on('pointerover', () => {
            button.setFillStyle(ACCENT);
            text.setColor('#0b1120');
        });

        button.on('pointerout', () => {
            button.setFillStyle(BG);
            text.setColor('#ff9900');
        });

        button.on('pointerdown', onClick);

        return button;
    }

    startGame ()
    {
        this.scene.start('Game');
    }
}

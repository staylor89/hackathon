import { Scene } from 'phaser';

const BG = 0x0b1120;
const GRID = 0x1c2a3a;

export class Game extends Scene
{
    constructor ()
    {
        super('Game');
    }

    create ()
    {
        this.add.rectangle(512, 384, 1024, 768, BG);

        const g = this.add.graphics();
        g.lineStyle(1, GRID, 1);
        for (let x = 0; x <= 1024; x += 64) g.lineBetween(x, 0, x, 768);
        for (let y = 0; y <= 768; y += 64) g.lineBetween(0, y, 1024, y);

        this.add.text(512, 340, 'EU-TORT-3', {
            fontFamily: 'Arial Black', fontSize: 48, color: '#e6edf3'
        }).setOrigin(0.5);

        this.add.text(512, 400, 'gameplay goes here', {
            fontFamily: 'Arial', fontSize: 24, color: '#8ea3b8'
        }).setOrigin(0.5);

        this.add.text(512, 720, 'ESC — menu    ·    ENTER — game over screen', {
            fontFamily: 'Arial', fontSize: 18, color: '#5c728a'
        }).setOrigin(0.5);

        this.input.keyboard?.once('keydown-ESC', () => {
            this.scene.start('MainMenu');
        });

        this.input.keyboard?.once('keydown-ENTER', () => {
            this.scene.start('GameOver', { score: 0 });
        });
    }
}

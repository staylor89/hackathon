import { Scene, GameObjects } from 'phaser';
import { qualifies, saveScore } from './Leaderboard';

interface GameOverData {
    score?: number;
    wave?: number;
}

const BG = 0x0b1120;
const GRID = 0x1c2a3a;

export class GameOver extends Scene
{
    score = 0;
    wave = 0;

    //  Arcade initials entry, shown only when the score makes the top ten.
    initials = '';
    entering = false;
    entryUi: GameObjects.GameObject[] = [];
    slots?: GameObjects.Text;

    constructor ()
    {
        super('GameOver');
    }

    init (data: GameOverData)
    {
        this.score = data?.score ?? 0;
        this.wave = data?.wave ?? 0;
        this.initials = '';
        this.entering = false;
        this.entryUi = [];
    }

    create ()
    {
        this.add.rectangle(512, 384, 1024, 768, BG);

        const g = this.add.graphics();
        g.lineStyle(1, GRID, 1);
        for (let x = 0; x <= 1024; x += 64) g.lineBetween(x, 0, x, 768);
        for (let y = 0; y <= 768; y += 64) g.lineBetween(0, y, 1024, y);

        //  One origin serves every region, so losing it is not a regional
        //  incident any more.
        this.add.text(512, 280, 'GLOBAL OUTAGE', {
            fontFamily: 'Arial Black', fontSize: 80, color: '#ff9900'
        }).setOrigin(0.5);

        this.add.text(512, 380, `Final score: ${this.score}`, {
            fontFamily: 'Arial', fontSize: 32, color: '#e6edf3'
        }).setOrigin(0.5);

        if (qualifies(this.score)) this.buildEntry();
        else this.buildPrompt();
    }

    //  The classic three-initials flow: letters type, backspace deletes,
    //  enter saves and jumps to the table with the new row picked out.
    buildEntry ()
    {
        this.entering = true;

        const banner = this.add.text(512, 460, 'TOP TEN INCIDENT  ·  ENTER YOUR INITIALS', {
            fontFamily: 'Arial Black', fontSize: 22, color: '#38bdf8'
        }).setOrigin(0.5);

        this.slots = this.add.text(512, 520, '', {
            fontFamily: 'Arial Black', fontSize: 52, color: '#e6edf3'
        }).setOrigin(0.5);

        const help = this.add.text(512, 585, 'ENTER SAVE  ·  ESC SKIP', {
            fontFamily: 'Arial', fontSize: 18, color: '#5c728a'
        }).setOrigin(0.5);

        this.entryUi = [banner, this.slots, help];
        this.paintSlots();

        this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));
    }

    onKey (ev: KeyboardEvent)
    {
        if (!this.entering) return;

        if (ev.key === 'Enter' && this.initials.length > 0)
        {
            this.entering = false;

            const rank = saveScore({
                name: this.initials, score: this.score, wave: this.wave
            });

            this.scene.start('Leaderboard', { highlight: rank });
            return;
        }

        //  Skipping keeps the score off the record on purpose — no anonymous
        //  rows, or the table fills with 'AAA' by accident.
        if (ev.key === 'Escape')
        {
            this.entering = false;
            for (const o of this.entryUi) o.destroy();
            this.buildPrompt();
            return;
        }

        if (ev.key === 'Backspace')
        {
            this.initials = this.initials.slice(0, -1);
        }
        else if (this.initials.length < 3 && /^[a-zA-Z0-9]$/.test(ev.key))
        {
            this.initials += ev.key.toUpperCase();
        }

        this.paintSlots();
    }

    paintSlots ()
    {
        const shown = this.initials.padEnd(3, '_').split('').join('  ');
        this.slots?.setText(shown);
    }

    //  The restart prompt. Deferred while initials are being entered so a
    //  stray click cannot throw the run's score away.
    buildPrompt ()
    {
        const prompt = this.add.text(512, 520, 'click to try again', {
            fontFamily: 'Arial', fontSize: 22, color: '#5c728a'
        }).setOrigin(0.5);

        this.add.text(512, 570, 'press L for the leaderboard', {
            fontFamily: 'Arial', fontSize: 18, color: '#5c728a'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: prompt,
            alpha: 0.3,
            ease: 'Sine.InOut',
            duration: 900,
            yoyo: true,
            repeat: -1
        });

        this.input.keyboard?.once('keydown-L', () => this.scene.start('Leaderboard'));

        this.input.once('pointerdown', () => {
            this.scene.start('MainMenu');
        });
    }
}

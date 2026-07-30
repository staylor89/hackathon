import { Scene } from 'phaser';

const BG = 0x0b1120;
const GRID = 0x1c2a3a;
const ACCENT = 0xff9900;

//  Top ten, kept in localStorage: it survives reloads but never leaves the
//  machine, because there is no backend to send it to.
const STORE_KEY = 'eu-tort-3-leaderboard';
const MAX_ENTRIES = 10;

export interface LeaderboardEntry {
    name: string;             // three arcade initials
    score: number;
    wave: number;             // the wave the run ended on
}

export function loadLeaderboard (): LeaderboardEntry[]
{
    try
    {
        const raw = localStorage.getItem(STORE_KEY);
        const list = raw ? JSON.parse(raw) : [];

        return Array.isArray(list) ? list : [];
    }
    catch
    {
        //  Private browsing or corrupt JSON — an empty board beats a crash.
        return [];
    }
}

//  Whether a score makes the table at all — GameOver only asks for initials
//  when it does. Any score counts while the table has room (a zero-kill run
//  is still a run); once it is full you have to beat the last row.
export function qualifies (score: number): boolean
{
    const board = loadLeaderboard();

    return board.length < MAX_ENTRIES || score > board[board.length - 1].score;
}

//  Insert, sort, clamp to ten, persist. Returns the new entry's row index so
//  the table can highlight it.
export function saveScore (entry: LeaderboardEntry): number
{
    const board = loadLeaderboard();

    board.push(entry);
    board.sort((a, b) => b.score - a.score);
    board.length = Math.min(board.length, MAX_ENTRIES);

    try
    {
        localStorage.setItem(STORE_KEY, JSON.stringify(board));
    }
    catch
    {
        //  Storage full or blocked: the run still happened, so carry on and
        //  show the table for this session.
    }

    return board.indexOf(entry);
}

interface LeaderboardSceneData {
    highlight?: number;       // row index to pick out, straight from saveScore()
}

export class Leaderboard extends Scene
{
    highlight = -1;

    constructor ()
    {
        super('Leaderboard');
    }

    init (data: LeaderboardSceneData)
    {
        this.highlight = data?.highlight ?? -1;
    }

    create ()
    {
        //  Same backdrop as the menu, so this reads as a page of it.
        this.add.rectangle(512, 384, 1024, 768, BG);

        const g = this.add.graphics();
        g.lineStyle(1, GRID, 1);
        for (let x = 0; x <= 1024; x += 64) g.lineBetween(x, 0, x, 768);
        for (let y = 0; y <= 768; y += 64) g.lineBetween(0, y, 1024, y);

        this.add.text(512, 110, 'LEADERBOARD', {
            fontFamily: 'Arial Black', fontSize: 56, color: '#e6edf3'
        }).setOrigin(0.5);

        this.add.text(512, 165, 'longest-lived deployments on this machine', {
            fontFamily: 'Arial', fontSize: 18, color: '#5c728a'
        }).setOrigin(0.5);

        const board = loadLeaderboard();

        if (board.length === 0)
        {
            this.add.text(512, 380, 'NO INCIDENTS ON RECORD', {
                fontFamily: 'Arial Black', fontSize: 24, color: '#5c728a'
            }).setOrigin(0.5);
        }
        else
        {
            this.drawTable(board);
        }

        const prompt = this.add.text(512, 690, 'click or press ESC to return', {
            fontFamily: 'Arial', fontSize: 20, color: '#5c728a'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: prompt,
            alpha: 0.3,
            ease: 'Sine.InOut',
            duration: 900,
            yoyo: true,
            repeat: -1
        });

        this.input.once('pointerdown', () => this.scene.start('MainMenu'));
        this.input.keyboard?.once('keydown-ESC', () => this.scene.start('MainMenu'));
    }

    drawTable (board: LeaderboardEntry[])
    {
        const top = 230;
        const row = 42;

        //  Column x positions: rank, initials, score (right-aligned), wave.
        const header = { fontFamily: 'Arial Black', fontSize: 14, color: '#5c728a' };

        this.add.text(330, top - 34, 'RANK', header);
        this.add.text(430, top - 34, 'NAME', header);
        this.add.text(660, top - 34, 'SCORE', header).setOrigin(1, 0);
        this.add.text(730, top - 34, 'WAVE', header);

        board.forEach((entry, i) => {
            const y = top + i * row;
            const hot = i === this.highlight;

            //  The run that just ended gets picked out in the accent colour.
            const colour = hot ? '#ff9900' : i === 0 ? '#e6edf3' : '#8ea3b8';
            const style = { fontFamily: 'Arial Black', fontSize: 20, color: colour };

            if (hot)
            {
                this.add.rectangle(512, y + 12, 480, row - 6, ACCENT, 0.12)
                    .setStrokeStyle(1, ACCENT, 0.5);
            }

            this.add.text(330, y, `${i + 1}`, style);
            this.add.text(430, y, entry.name, style);
            this.add.text(660, y, `${entry.score}`, style).setOrigin(1, 0);
            this.add.text(730, y, `${entry.wave}`, style);
        });
    }
}

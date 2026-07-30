//  Sourced audio clips for EU-Tort-3.
//
//  Unlike make-sfx.mjs and make-music.mjs, these are not synthesised: they are
//  real recordings in tools/source-audio/. This script decodes, downmixes,
//  trims and levels them so they land in the same format as everything else
//  (44.1 kHz mono 16-bit WAV) and sit correctly in the mix.
//
//  Requires afconvert, which ships with macOS. There is no pure-Node MP3
//  decoder here and adding a dependency for two clips is not worth it; if this
//  ever needs to run on Linux, swap the decode line for ffmpeg.
//
//  Licensing: both clips are found audio, fine for an internal demo but not
//  cleared for public distribution. Worth knowing before this goes anywhere
//  other than a hackathon screen.
//
//  Run: node tools/make-clips.mjs

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RATE, readWav, trimSilence, slice, normalise, declick, wav } from './dsp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'source-audio');
const OUT = join(HERE, '..', 'public', 'assets', 'sfx');

//  ------------------------------------------------------------------- clips
//
//  window is applied AFTER trimming, in seconds from the start of the trimmed
//  audio — so it survives the source file being re-exported with different
//  leading silence.

const CLIPS = [
    {
        //  Was -5, which made it the loudest asset in the game - louder than
        //  the snowmobile beam. It plays every wave, so it does not need to win
        //  that fight; -11 puts it level with the boss alert.
        out: 'i-like-turtles',
        src: 'i-like-turtles.mp3',
        db: -11,
        fadeOut: 30,
        brief: 'Wave inbound. Replaces the synth alert; plays once per wave.'
    },
    {
        //  The full article, for a flyer or a tank landing on the origin.
        out: 'turtle-mating',
        src: 'turtle-mating.mp3',
        db: -9,
        fadeOut: 60,
        brief: 'Major breach (flyer or tank).'
    },
    {
        //  Same recording cut down to its first gesture. A light breach fires
        //  per DDoS packet and the flood arrives 260ms apart, so the full 0.9s
        //  version would be a pile-up.
        out: 'turtle-mating-short',
        src: 'turtle-mating.mp3',
        window: [ 0, 0.34 ],
        db: -14,
        fadeOut: 70,
        brief: 'Light breach (flood or shinobi).'
    }
];

//  ---------------------------------------------------------------------- main

function decode (file)
{
    const tmp = join(tmpdir(), `eu-tort-3-${file.replace(/\W/g, '_')}.wav`);
    execFileSync('/usr/bin/afconvert', [
        '-f', 'WAVE',
        '-d', `LEI16@${RATE}`,
        '-c', '1',
        join(SRC, file),
        tmp
    ]);
    return readWav(readFileSync(tmp));
}

if (!existsSync('/usr/bin/afconvert'))
{
    console.error('afconvert not found. This script needs macOS, or an ffmpeg swap in decode().');
    process.exit(1);
}

mkdirSync(OUT, { recursive: true });

let total = 0;

for (const clip of CLIPS)
{
    let buf = trimSilence(decode(clip.src));
    const sourceSecs = buf.length / RATE;

    if (clip.window) buf = slice(buf, clip.window[0], clip.window[1]);

    //  Level, then fade. The fade is long enough on the cut-down clip to hide
    //  the fact that it stops mid-noise.
    buf = declick(normalise(buf, clip.db), 2, clip.fadeOut);

    const bytes = wav(buf);
    writeFileSync(join(OUT, `${clip.out}.wav`), bytes);
    total += bytes.length;

    console.log(
        `${(clip.out + '.wav').padEnd(26)} ${(buf.length / RATE).toFixed(3)}s  ` +
        `${String(clip.db).padStart(4)} dBFS  ${(bytes.length / 1024).toFixed(1).padStart(6)} KB` +
        `${clip.window ? `  (${clip.window[0]}-${clip.window[1]}s of ${sourceSecs.toFixed(2)}s)` : ''}`
    );
}

console.log(`\n${CLIPS.length} clips, ${(total / 1024).toFixed(1)} KB total -> public/assets/sfx/`);

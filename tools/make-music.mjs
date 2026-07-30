//  Procedural music loops for EU-Tort-3.
//
//  Two tracks: a restrained bed for normal play, and a boss track for wave 5,
//  10, 15... The game crossfades between them (see Game.playMusic), which only
//  works musically because both are in the SAME KEY (A minor) at the SAME TEMPO
//  (96 BPM). Change one and you must change the other, or the switch mid-fight
//  will clash.
//
//  Loops are WAV, not MP3/AAC, for the same reason the one-shots are: encoder
//  padding. A compressed loop gains 10-30ms of silence at the head, which Web
//  Audio faithfully reproduces on every single pass - an audible hiccup every
//  ten seconds for the length of the run. See fold() in dsp.mjs for how the
//  seam is made continuous.
//
//  Run: node tools/make-music.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    RATE, rng, phasor, sine, saw, tri, pulse, lowpass, highpass, svf,
    decay, glide, sat, ad, midi, addVoice, normalise, fold, wav
} from './dsp.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'sfx');

//  ----------------------------------------------------------------- transport

const BPM = 96;
const BEAT = 60 / BPM;          // 0.625s
const BAR = BEAT * 4;           // 2.5s

//  Bar and beat to seconds. Beats are fractional, so beat 2.5 is the "and" of 3.
const at = (bar, beat = 0) => bar * BAR + beat * BEAT;
const S = (sec) => Math.round(sec * RATE);

//  Sixteenth-note grid position to seconds.
const step = (bar, n) => at(bar) + n * BEAT / 4;

//  ---------------------------------------------------------------- instruments
//
//  Each of these returns a per-sample function. A fresh call per note means
//  oscillator phase and filter state never leak between voices.

function kick (gain = 1)
{
    const ph = phasor();
    return (t) => sat(sine(ph(glide(t, 85, 140, 44))) * 1.3, 1.3) * ad(t, 1, 135) * gain;
}

//  Sustained sub. Carries the harmony on cheap laptop speakers where the pad
//  is barely audible.
function sub (note, tau, gain = 1)
{
    const ph = phasor();
    const f = midi(note);
    return (t) => sat(sine(ph(f)) * 1.15, 1.15) * ad(t, 6, tau) * gain;
}

//  Plucked bass. Narrow pulse through a lowpass, so it has bite without
//  competing with the sub an octave down.
function bass (note, tau, gain = 1, cutoff = 850)
{
    const ph = phasor();
    const lp = lowpass(cutoff);
    const f = midi(note);
    return (t) => lp(pulse(ph(f), 0.3)) * ad(t, 3, tau) * gain;
}

//  Detuned saw pad. Slow attack, long release; the release is what fold() wraps
//  around the loop seam.
function pad (notes, durSec, gain = 1, cutoff = 780)
{
    const phs = notes.map(() => [ phasor(), phasor() ]);
    const fs = notes.map(midi);
    const lp = lowpass(cutoff);

    return (t) =>
    {
        let v = 0;
        fs.forEach((f, i) => {
            v += saw(phs[i][0](f)) + saw(phs[i][1](f * 1.006));
        });

        const env = Math.min(t / 0.55, 1) * (t < durSec ? 1 : decay(t - durSec, 620));
        return lp(v / (fs.length * 2)) * env * gain;
    };
}

//  Resonant blip. The only element with any sparkle in the core track.
function arp (note, gain = 1)
{
    const ph = phasor();
    const f = midi(note);
    const filt = svf(0.35);
    return (t) => filt(saw(ph(f)), glide(t, 110, 2800, 720)).low * ad(t, 2, 85) * gain;
}

function hat (seed, gain = 1, tau = 16)
{
    const nz = rng(seed);
    const hp = highpass(6200);
    return (t) => hp(nz() * 2 - 1) * ad(t, 0.5, tau) * gain;
}

//  Low tom. Boss-only; the thing that makes the room feel smaller.
function timp (note, gain = 1)
{
    const ph = phasor();
    const nz = rng(4242);
    const lp = lowpass(320);
    const f = midi(note);
    return (t) => sat((sine(ph(f * (1 + 0.12 * decay(t, 40)))) + lp(nz() * 2 - 1) * 0.5) * 1.2, 1.4) * ad(t, 2, 260) * gain;
}

//  Saw-stack chord stab. Boss-only.
function stab (notes, gain = 1)
{
    const phs = notes.map(() => [ phasor(), phasor() ]);
    const fs = notes.map(midi);
    const lp = lowpass(2400);

    return (t) =>
    {
        let v = 0;
        fs.forEach((f, i) => {
            v += saw(phs[i][0](f)) + tri(phs[i][1](f * 0.994));
        });
        return lp(v / (fs.length * 2)) * ad(t, 4, 190) * gain;
    };
}

//  Tremolo high drone. Boss-only. Carries the semitone clash that makes the
//  boss track read as dread rather than as urgency.
function drone (notes, durSec, gain = 1)
{
    const phs = notes.map(() => phasor());
    const trem = phasor();
    const fs = notes.map(midi);
    const lp = lowpass(3200);

    return (t) =>
    {
        let v = 0;
        fs.forEach((f, i) => { v += saw(phs[i](f)); });

        const wobble = 0.65 + 0.35 * sine(trem(7.5));
        const env = Math.min(t / 0.4, 1) * (t < durSec ? 1 : decay(t - durSec, 400));
        return lp(v / fs.length) * wobble * env * gain;
    };
}

//  Reverse-ish noise swell. Marks the top of the boss loop.
function swell (seed, durSec, gain = 1)
{
    const nz = rng(seed);
    const filt = svf(0.7);
    return (t) =>
    {
        const fc = glide(t, durSec * 1000, 400, 5200);
        const env = Math.pow(Math.min(t / durSec, 1), 2.2);
        return filt(nz() * 2 - 1, fc).band * env * gain;
    };
}

//  ------------------------------------------------------------------ the bed
//
//  8 bars (20s), A minor, two bars per chord: Am - F - C - G. Restrained on
//  purpose. This plays for the entire run, so anything with a strong hook would
//  be unbearable by wave 12; the job is to fill the silence and imply a machine
//  room, not to be memorable.

function core ()
{
    const BARS = 8;
    const TAIL = 1.4;
    const out = new Float32Array(S(BARS * BAR + TAIL));

    //  root (for sub/bass) and the pad voicing, per two-bar chord.
    const chords = [
        { root: 33, pad: [ 57, 60, 64 ], arp: [ 69, 72, 76, 72 ] },   // Am
        { root: 29, pad: [ 53, 57, 60 ], arp: [ 65, 69, 72, 69 ] },   // F
        { root: 36, pad: [ 60, 64, 67 ], arp: [ 72, 76, 79, 76 ] },   // C
        { root: 31, pad: [ 55, 59, 62 ], arp: [ 67, 71, 74, 71 ] }    // G
    ];

    //  Sparse sixteenth pattern. Same every bar; the chord underneath is what
    //  makes it feel like it is going somewhere.
    const ARP_STEPS = [ 0, 3, 6, 10, 12 ];

    for (let bar = 0; bar < BARS; bar++)
    {
        const chord = chords[Math.floor(bar / 2) % chords.length];

        //  Pad enters on the first bar of each chord and holds for both.
        if (bar % 2 === 0)
        {
            addVoice(out, S(at(bar)), S(BAR * 2 + TAIL), pad(chord.pad, BAR * 2 - 0.15, 0.34));
        }

        //  Half-time kick. Two per bar is enough at this tempo.
        addVoice(out, S(at(bar, 0)), S(0.5), kick(0.95));
        addVoice(out, S(at(bar, 2)), S(0.5), kick(0.95));

        //  Sub on the downbeat, plus a syncopated push into beat 3.
        addVoice(out, S(at(bar, 0)), S(BEAT * 2), sub(chord.root, 520, 0.62));
        addVoice(out, S(at(bar, 2.5)), S(BEAT * 1.5), sub(chord.root, 240, 0.42));

        //  Bass pluck an octave up, on the offbeats only, so it interlocks with
        //  the sub rather than doubling it.
        addVoice(out, S(at(bar, 1.5)), S(BEAT), bass(chord.root + 12, 150, 0.3));
        addVoice(out, S(at(bar, 3.5)), S(BEAT), bass(chord.root + 12, 150, 0.3));

        //  Offbeat hats.
        for (const b of [ 0.5, 1.5, 2.5, 3.5 ])
        {
            addVoice(out, S(at(bar, b)), S(0.12), hat(7000 + bar * 17 + b * 100, 0.26));
        }

        //  Arp. Skips the last bar of each chord pair on odd chords, which is
        //  the only asymmetry in the whole loop.
        if (!(bar % 4 === 3))
        {
            ARP_STEPS.forEach((n, i) => {
                addVoice(out, S(step(bar, n)), S(0.4), arp(chord.arp[i % chord.arp.length], 0.2));
            });
        }
    }

    return fold(out, S(BARS * BAR));
}

//  ---------------------------------------------------------------- boss track
//
//  4 bars (10s), same key and tempo so it can be crossfaded into mid-wave.
//  Everything is tighter: four-on-the-floor instead of half-time, sixteenth
//  bass instead of offbeat plucks, and a Bb sitting a semitone above the A root
//  in bar 3 to do the actual menacing.

function boss ()
{
    const BARS = 4;
    const TAIL = 1.0;
    const out = new Float32Array(S(BARS * BAR + TAIL));

    //  A, A, Bb, A. The Bb is the whole idea.
    const roots = [ 33, 33, 34, 33 ];
    const stabs = [
        [ 57, 60, 64 ],   // Am
        [ 57, 60, 64 ],   // Am
        [ 58, 61, 65 ],   // Bb, shifted wholesale - parallel motion, no voice leading
        [ 57, 60, 64 ]    // Am
    ];

    //  Sixteenth accents: 1 is a hit, 2 is an accented hit.
    const BASS_PATTERN = [ 2, 1, 1, 1, 2, 1, 0, 1, 2, 1, 1, 1, 2, 0, 1, 1 ];

    //  High drone across the whole loop, clashing in bar 3.
    addVoice(out, S(at(0)), S(BARS * BAR + TAIL), drone([ 81, 84 ], BARS * BAR - 0.2, 0.13));
    addVoice(out, S(at(2)), S(BAR + 0.4), drone([ 82 ], BAR - 0.1, 0.11));

    //  Noise swell into the top of the loop, so the seam is an event rather
    //  than a repeat.
    addVoice(out, S(at(BARS - 1, 2)), S(BEAT * 2), swell(5150, BEAT * 2, 0.16));

    for (let bar = 0; bar < BARS; bar++)
    {
        const root = roots[bar];

        //  Four on the floor.
        for (let b = 0; b < 4; b++)
        {
            addVoice(out, S(at(bar, b)), S(0.5), kick(1));
        }

        //  Sustained sub under the whole bar.
        addVoice(out, S(at(bar, 0)), S(BAR + 0.3), sub(root, 900, 0.5));

        //  Driving sixteenth bass.
        BASS_PATTERN.forEach((hit, n) => {
            if (hit === 0) return;
            addVoice(out, S(step(bar, n)), S(0.3), bass(root + 12, hit === 2 ? 95 : 60, hit === 2 ? 0.42 : 0.24));
        });

        //  Chord stab on the downbeat, and a second one late in bar 3 to push
        //  into the loop point.
        addVoice(out, S(at(bar, 0)), S(BEAT * 2), stab(stabs[bar], 0.3));
        if (bar === BARS - 1) addVoice(out, S(at(bar, 3)), S(BEAT * 2), stab(stabs[bar], 0.22));

        //  Timpani on 1 and the "and" of 3.
        addVoice(out, S(at(bar, 0)), S(0.7), timp(26, 0.5));
        addVoice(out, S(at(bar, 2.5)), S(0.7), timp(26, 0.34));

        //  Sixteenth hats, accented on the beat.
        for (let n = 0; n < 16; n++)
        {
            const accent = n % 4 === 0;
            addVoice(out, S(step(bar, n)), S(0.1), hat(9000 + bar * 31 + n, accent ? 0.24 : 0.12, accent ? 22 : 12));
        }
    }

    return fold(out, S(BARS * BAR));
}

//  ---------------------------------------------------------------------- main
//
//  Peak is -14 dBFS, well under the loudest one-shots, and the game plays these
//  at MUSIC_VOL on top of that. Music must lose every fight with a sound effect.
//
//  No declick() here: a fade at either end of a loop is a hole at the seam.

const TRACKS = {
    'music-core': { make: core, bars: 8, note: 'Normal play. A minor, 96 BPM, Am-F-C-G.' },
    'music-boss': { make: boss, bars: 4, note: 'Boss waves. Same key and tempo, Bb clash in bar 3.' }
};

mkdirSync(OUT, { recursive: true });

let total = 0;

for (const [ name, def ] of Object.entries(TRACKS))
{
    const buf = normalise(def.make(), -14);
    const bytes = wav(buf);
    writeFileSync(join(OUT, `${name}.wav`), bytes);
    total += bytes.length;

    const secs = (buf.length / RATE).toFixed(2);
    const seam = Math.max(Math.abs(buf[0]), Math.abs(buf[buf.length - 1]));
    console.log(
        `${(name + '.wav').padEnd(18)} ${String(def.bars).padStart(2)} bars  ${secs.padStart(6)}s  ` +
        `${(bytes.length / 1024 / 1024).toFixed(2)} MB  seam ${seam.toFixed(3)}`
    );
}

console.log(`\n${Object.keys(TRACKS).length} tracks, ${(total / 1024 / 1024).toFixed(2)} MB total -> public/assets/sfx/`);
console.log(`Tempo ${BPM} BPM, bar ${BAR.toFixed(3)}s. Both tracks share key and tempo so they crossfade.`);

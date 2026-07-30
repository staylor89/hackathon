//  Procedural sound effects for EU-Tort-3.
//
//  Every sound is synthesised here rather than sourced as a file, so the whole
//  set is regenerable and tunable in one place - same idea as the code-drawn
//  sprites. Output is 44.1 kHz mono 16-bit WAV, which Web Audio decodes with no
//  encoder padding (MP3/AAC prepend silence, which is fatal for a tower firing
//  every 120ms).
//
//  Run: node tools/make-sfx.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    RATE, rng, phasor, sine, square, saw, tri, lowpass, highpass, svf,
    decay, glide, sat, ad, render, normalise, declick, wav
} from './dsp.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'sfx');

//  -------------------------------------------------------------------- sounds
//
//  Peak levels are deliberately uneven. Firing sounds sit low because a dozen
//  towers overlap; one-per-wave events get the headroom.

const SOUNDS = {

    //  Identity check. Clean, clinical two-tone - a credential being verified,
    //  not a projectile. Deliberately unlike the Shield zap; IAM is the starter
    //  tower and its sound plays for the whole run.
    'tower-iam-fire': { db: -17, brief: 'IAM firing. Clipped digital verify blip.', make: () =>
    {
        const a = phasor();
        const b = phasor();
        const shape = lowpass(7000);

        return render(95, (t) =>
        {
            const lo = sine(a(880)) * decay(t, 16);
            const hi = t >= 0.026 ? sine(b(1320)) * 0.75 * decay(t - 0.026, 22) : 0;
            return shape(lo + hi);
        });
    } },

    //  Rapid-fire chip damage. Must survive ~8 plays/sec/tower, so: short,
    //  bright, quiet, and pitched high enough to cut through the low end.
    'tower-shield-fire': { db: -18, brief: 'Shield firing. Short bright zap.', make: () =>
    {
        const ph = phasor();
        const nz = rng(101);
        const body = svf(0.9);
        const tick = highpass(2400);

        return render(70, (t) =>
        {
            const f = glide(t, 55, 1900, 430);
            const tone = square(ph(f)) * 0.55 * decay(t, 13);
            const trans = tick(nz() * 2 - 1) * 0.5 * decay(t, 4);
            return body(tone + trans, 5200).low;
        });
    } },

    //  Cold storage. Filtered noise sweeping up, high resonance, slow attack -
    //  reads as frost rather than as a gunshot.
    'tower-glacier-fire': { db: -16, brief: 'Glacier firing. Icy resonant shimmer.', make: () =>
    {
        const nz = rng(202);
        const ice = svf(0.22);
        const ph = phasor();

        return render(300, (t) =>
        {
            const fc = glide(t, 260, 850, 4600);
            const env = Math.min(t / 0.045, 1) * decay(Math.max(0, t - 0.045), 90);
            const shimmer = ice(nz() * 2 - 1, fc).band * 0.9;
            const thin = sine(ph(2650)) * 0.18 * env;
            return (shimmer + thin) * env;
        });
    } },

    //  Rule match, request denied. A stamp, not a shot: hard click then a low
    //  saturated thunk.
    'tower-waf-fire': { db: -14, brief: 'WAF firing. Gate slam / deny stamp.', make: () =>
    {
        const nz = rng(303);
        const click = highpass(3000);
        const ph = phasor();
        const dull = lowpass(1500);

        return render(110, (t) =>
        {
            const snap = click(nz() * 2 - 1) * decay(t, 3);
            const f = glide(t, 70, 240, 105);
            const thunk = square(ph(f)) * 0.8 * decay(t, 32);
            return sat(dull(thunk) + snap * 0.7, 1.6);
        });
    } },

    //  Event-driven burst. Three ascending blips; the last one is brightest so
    //  the volley has a direction.
    'tower-lambda-fire': { db: -16, brief: 'Lambda firing. Three ascending blips.', make: () =>
    {
        const ph = phasor();
        const shape = lowpass(6000);
        const hits = [ { at: 0, f: 720 }, { at: 0.072, f: 940 }, { at: 0.144, f: 1280 } ];

        return render(290, (t) =>
        {
            let v = 0;
            for (const h of hits)
            {
                if (t < h.at) continue;
                const dt = t - h.at;
                v += (sine(ph(h.f)) * 0.7 + tri(ph(h.f * 2.01)) * 0.3) * decay(dt, 26);
            }
            return shape(v);
        });
    } },

    //  Detection, not prevention. Sonar ping with a long tail; no attack punch,
    //  because it never deals damage.
    'tower-guardduty-ping': { db: -18, brief: 'GuardDuty reveal. Sonar ping.', make: () =>
    {
        const a = phasor();
        const b = phasor();

        return render(650, (t) =>
        {
            const f = glide(t, 600, 1420, 1330);
            const env = Math.min(t / 0.004, 1) * decay(t, 150);
            return (sine(a(f)) * 0.85 + sine(b(f * 1.5)) * 0.25) * env;
        });
    } },

    //  Snowmobile is a beam tower: 300 damage on a 4s cooldown, instant hit,
    //  icy cyan. So this is a charge and a discharge, not an impact - the shape
    //  is 200ms of rising whine, a crack, then a long cryo tail. It fires once
    //  every four seconds and should be the loudest thing on the board, which
    //  is the whole reason it can afford to be this long.
    'tower-snowmobile-fire': { db: -6, brief: 'Snowmobile firing. Cryo beam: charge, crack, frozen tail.', make: () =>
    {
        const CHARGE = 0.2;

        const nz = rng(404);
        const whine = phasor();
        const whine2 = phasor();
        const sub = phasor();
        const beam = svf(0.3);
        const ice = svf(0.18);
        const crack = highpass(5000);
        const shimmer = phasor();

        return render(980, (t) =>
        {
            //  Charge: two detuned saws sweeping up, amplitude ramping in.
            const cf = glide(t, CHARGE * 1000, 220, 1750);
            const ramp = Math.pow(Math.min(t / CHARGE, 1), 2);
            const charge = t < CHARGE
                ? (saw(whine(cf)) + saw(whine2(cf * 1.008))) * 0.22 * ramp
                : 0;

            if (t < CHARGE) return charge;

            //  Everything past here is the discharge.
            const d = t - CHARGE;

            //  The crack that sells the release.
            const snap = crack(nz() * 2 - 1) * 0.7 * decay(d, 6);

            //  Beam body: resonant noise falling from bright to cold, over a
            //  sub that gives it weight on real speakers.
            const body = beam(nz() * 2 - 1, glide(d, 420, 3400, 640)).band * 0.85 * decay(d, 260);
            const weight = sine(sub(glide(d, 300, 88, 42))) * 0.55 * decay(d, 190);

            //  Frozen tail: high resonant shimmer sweeping up as it dies away,
            //  plus a thin crystalline partial. This is the "cryo" rather than
            //  "laser" part.
            const frost = ice(nz() * 2 - 1, glide(d, 620, 2600, 6200)).band * 0.5 * decay(d, 300);
            const ring = sine(shimmer(3140)) * 0.12 * ad(d, 90, 340);

            return sat(snap + body + weight + frost + ring, 1.25);
        });
    } },

    //  Provisioned. Rising two-tone with a mechanical clunk under it.
    'tower-build': { db: -12, brief: 'Tower placed. Affirmative rising two-tone.', make: () =>
    {
        const a = phasor();
        const b = phasor();
        const nz = rng(505);
        const clunk = lowpass(700);

        return render(320, (t) =>
        {
            const lo = tri(a(440)) * decay(t, 70) * (t < 0.12 ? 1 : 0);
            const hi = t >= 0.11 ? tri(b(660)) * decay(t - 0.11, 90) : 0;
            const knock = clunk(nz() * 2 - 1) * 0.5 * decay(t, 18);
            return (lo + hi) * 0.7 + knock;
        });
    } },

    //  Sold. Falling two-tone with a coin tick; the inverse of tower-build.
    'tower-sell': { db: -14, brief: 'Tower sold. Falling two-tone plus coin tick.', make: () =>
    {
        const a = phasor();
        const b = phasor();
        const tick = highpass(4000);
        const nz = rng(909);

        return render(240, (t) =>
        {
            const hi = tri(a(900)) * decay(t, 55) * (t < 0.1 ? 1 : 0);
            const lo = t >= 0.09 ? tri(b(600)) * decay(t - 0.09, 75) : 0;
            const coin = tick(nz() * 2 - 1) * 0.35 * decay(t, 8);
            return (hi + lo) * 0.7 + coin;
        });
    } },

    //  Unlocked. A rung above tower-build: three notes, more headroom, because
    //  it happens at most twice a run.
    'tower-unlock': { db: -11, brief: 'Tower unlocked. Three-note ascending fanfare.', make: () =>
    {
        const shape = lowpass(5200);
        const ph = [ phasor(), phasor(), phasor() ];
        const notes = [ { at: 0, f: 523 }, { at: 0.085, f: 784 }, { at: 0.17, f: 1046 } ];

        return render(440, (t) =>
        {
            let v = 0;
            notes.forEach((nt, i) =>
            {
                if (t < nt.at) return;
                const dt = t - nt.at;
                v += (tri(ph[i](nt.f)) * 0.6 + sine(ph[i](nt.f)) * 0.4) * decay(dt, i === 2 ? 150 : 70);
            });
            return shape(v);
        });
    } },

    //  Brownout. Power-down glide with mains hum bleeding through.
    'tower-offline': { db: -14, brief: 'Tower browned out. Sad power-down.', make: () =>
    {
        const a = phasor();
        const hum = phasor();
        const dull = lowpass(900);

        return render(520, (t) =>
        {
            const f = glide(t, 420, 310, 88);
            const fall = saw(a(f)) * 0.8;
            const mains = sine(hum(60)) * 0.3;
            const env = decay(t, 220);
            return dull(fall + mains) * env;
        });
    } },

    //  Chip damage confirmation. Barely there on purpose - this fires as often
    //  as the Shield does.
    'enemy-hit': { db: -23, brief: 'Enemy damaged. Dry tick.', make: () =>
    {
        const nz = rng(606);
        const band = svf(0.4);

        return render(38, (t) => band(nz() * 2 - 1, 1900).band * decay(t, 6));
    } },

    //  Shell breaking. Bright noise collapsing downward plus a body thump.
    'enemy-death': { db: -16, brief: 'Enemy killed. Shell crack.', make: () =>
    {
        const nz = rng(707);
        const shell = svf(0.7);
        const ph = phasor();

        return render(210, (t) =>
        {
            const fc = glide(t, 150, 5200, 420);
            const crack = shell(nz() * 2 - 1, fc).low * decay(t, 48);
            const thump = sine(ph(glide(t, 120, 95, 52))) * 0.5 * decay(t, 55);
            return sat(crack * 1.2 + thump, 1.2);
        });
    } },

    //  Smoke dash. Fires every 2.4s per shinobi and there are several on the
    //  board, so this is throttled and quiet by design.
    'ninja-dash': { db: -22, brief: 'Shinobi smoke dash. Short downward whoosh.', make: () =>
    {
        const nz = rng(1010);
        const air = svf(0.6);

        return render(190, (t) =>
        {
            const fc = glide(t, 170, 3400, 480);
            const env = Math.min(t / 0.012, 1) * decay(t, 55);
            return air(nz() * 2 - 1, fc).band * env * 1.3;
        });
    } },

    //  Leatherback down. The best thing that happens in a run, so it gets the
    //  longest tail of any kill sound.
    'boss-death': { db: -11, brief: 'Boss killed. Shell collapse into a low boom.', make: () =>
    {
        const nz = rng(1313);
        const shell = svf(0.55);
        const ph = phasor();
        const sub = phasor();

        return render(760, (t) =>
        {
            const crack = shell(nz() * 2 - 1, glide(t, 300, 6000, 300)).low * decay(t, 130);
            const boom = sine(ph(glide(t, 340, 120, 40))) * 0.9 * decay(t, 240);
            const ring = sine(sub(196)) * 0.25 * decay(t, 300);
            return sat(crack * 1.1 + boom + ring, 1.3);
        });
    } },

    //  Boss wave inbound. Same two-beat shape as wave-start but an octave and a
    //  half down, with rumble under it, so the two never get confused.
    'wave-boss': { db: -11, brief: 'Boss wave inbound. Low ominous double alert.', make: () =>
    {
        const ph = phasor();
        const nz = rng(1414);
        const shape = lowpass(1400);
        const rumble = lowpass(160);
        const beeps = [ 0, 0.34 ];

        return render(980, (t) =>
        {
            let v = 0;
            for (const at of beeps)
            {
                if (t < at || t > at + 0.26) continue;
                const dt = t - at;
                const env = Math.min(dt / 0.03, 1) * Math.min((0.26 - dt) / 0.04, 1);
                v += square(ph(146)) * 0.55 * env;
            }
            const floor = rumble(nz() * 2 - 1) * 2.2 * decay(t, 420);
            return sat(shape(v) + floor, 1.2);
        });
    } },

    //  REGION DOWN. The only sound allowed to be genuinely loud and long.
    'region-down': { db: -10, brief: 'Game over. Descending doom sweep.', make: () =>
    {
        const a = phasor();
        const b = phasor();
        const dull = lowpass(1100);

        return render(1700, (t) =>
        {
            const f = glide(t, 1450, 330, 44);
            const pair = saw(a(f)) * 0.6 + saw(b(f * 0.994)) * 0.6;
            const env = Math.min(t / 0.01, 1) * decay(t, 620);
            return sat(dull(pair) * env, 1.3);
        });
    } },

    //  UI affordances.
    'ui-click': { db: -20, brief: 'Button / pad click.', make: () =>
    {
        const nz = rng(808);
        const hp = highpass(3200);
        const ph = phasor();

        return render(28, (t) => hp(nz() * 2 - 1) * decay(t, 4) + sine(ph(1250)) * 0.4 * decay(t, 7));
    } },

    'place-denied': { db: -16, brief: 'Cannot afford / invalid slot. Flat buzz.', make: () =>
    {
        const ph = phasor();
        const gate = phasor();
        const dull = lowpass(1600);

        return render(170, (t) =>
        {
            const chop = square(gate(42)) > 0 ? 1 : 0.25;
            return dull(square(ph(148)) * 0.8 * chop) * decay(t, 90);
        });
    } }
};

//  ---------------------------------------------------------------------- main

mkdirSync(OUT, { recursive: true });

let total = 0;
const rows = [];

for (const [ name, def ] of Object.entries(SOUNDS))
{
    const buf = declick(normalise(def.make(), def.db));
    const bytes = wav(buf);
    writeFileSync(join(OUT, `${name}.wav`), bytes);

    total += bytes.length;
    rows.push({
        file: `${name}.wav`,
        ms: Math.round(buf.length / RATE * 1000),
        db: def.db,
        kb: (bytes.length / 1024).toFixed(1)
    });
}

for (const r of rows)
{
    console.log(`${r.file.padEnd(28)} ${String(r.ms).padStart(5)}ms  ${String(r.db).padStart(4)} dBFS  ${r.kb.padStart(7)} KB`);
}

console.log(`\n${rows.length} files, ${(total / 1024).toFixed(1)} KB total -> public/assets/sfx/`);

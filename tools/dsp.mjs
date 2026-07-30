//  Shared synthesis primitives for the EU-Tort-3 audio generators.
//
//  Used by tools/make-sfx.mjs (one-shots) and tools/make-music.mjs (loops).
//  Everything here is sample-rate-aware but otherwise stateless plumbing; the
//  actual sound design lives in the two generator scripts.

export const RATE = 44100;

export const ms = (t) => Math.max(1, Math.round(RATE * t / 1000));

//  Seeded PRNG so regenerating produces byte-identical files.
export function rng (seed)
{
    let a = seed >>> 0;

    return () =>
    {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

//  Normalised phase accumulator: call with a frequency each sample, get 0..1.
export function phasor ()
{
    let p = 0;

    return (f) =>
    {
        p += f / RATE;
        if (p >= 1) p -= Math.floor(p);
        return p;
    };
}

export const sine = (p) => Math.sin(2 * Math.PI * p);
export const square = (p) => (p < 0.5 ? 1 : -1);
export const saw = (p) => p * 2 - 1;
export const tri = (p) => 4 * Math.abs(p - 0.5) - 1;

//  Pulse with variable width — thinner than a square, good for plucked bass.
export const pulse = (p, width = 0.25) => (p < width ? 1 : -1);

//  One-pole filters. Cheap, gentle, good enough for tone shaping.
export function lowpass (fc)
{
    let y = 0;
    const a = 1 - Math.exp(-2 * Math.PI * fc / RATE);
    return (x) => (y += a * (x - y));
}

export function highpass (fc)
{
    const lp = lowpass(fc);
    return (x) => x - lp(x);
}

//  Chamberlin state-variable filter. Sweepable cutoff and real resonance, which
//  is what gives noise a pitched "zap" or "shimmer" character. q: 0.1 (very
//  resonant) to 2 (damped).
export function svf (q)
{
    let low = 0;
    let band = 0;

    return (x, fc) =>
    {
        const f = 2 * Math.sin(Math.PI * Math.min(fc, RATE / 4) / RATE);
        const high = x - low - q * band;
        band += f * high;
        low += f * band;
        return { low, band, high };
    };
}

//  Exponential amplitude decay. tau in ms.
export const decay = (t, tau) => Math.exp(-t / (tau / 1000));

//  Exponential frequency glide from f0 to f1 across dur ms.
export const glide = (t, dur, f0, f1) => f0 * Math.pow(f1 / f0, Math.min(t / (dur / 1000), 1));

//  Soft saturation. Adds weight without the crackle of hard clipping.
export const sat = (x, drive = 1) => Math.tanh(x * drive);

//  Attack-decay envelope, both in ms. Linear attack, exponential decay.
export const ad = (t, attack, tau) => Math.min(t / (attack / 1000), 1) * decay(Math.max(0, t - attack / 1000), tau);

//  MIDI note number to Hz. 69 = A4 = 440.
export const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export function render (durMs, fn)
{
    const len = ms(durMs);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = fn(i / RATE, i, len);
    return out;
}

//  Mix a voice into an existing buffer at a sample offset. Each call gets its
//  own closure, so per-note filter and oscillator state stays independent.
export function addVoice (out, startSample, durSamples, fn)
{
    for (let i = 0; i < durSamples; i++)
    {
        const idx = startSample + i;
        if (idx >= out.length) break;
        out[idx] += fn(i / RATE, i);
    }
}

export function normalise (buf, peakDb)
{
    let peak = 0;
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
    if (peak === 0) return buf;

    const g = Math.pow(10, peakDb / 20) / peak;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
    return buf;
}

//  Force the first and last samples to zero so playback never ticks. The 1ms
//  in-ramp is short enough that transients still read as instant.
//
//  Never use this on a loop — it puts a hole at the seam. See fold().
export function declick (buf, inMs = 1, outMs = 4)
{
    const a = ms(inMs);
    const b = ms(outMs);
    for (let i = 0; i < a && i < buf.length; i++) buf[i] *= i / a;
    for (let i = 0; i < b && i < buf.length; i++) buf[buf.length - 1 - i] *= i / b;
    return buf;
}

//  Make a loop seamless. Render loopLen + tail worth of audio, then fold the
//  overhang back over the start: everything still ringing when the loop ends is
//  what should already be ringing when it begins. Without this, every reverb
//  tail and bass decay gets guillotined at the seam and the loop clicks once a
//  bar for the rest of the game.
export function fold (buf, loopSamples)
{
    const out = buf.slice(0, loopSamples);
    const overhang = Math.min(buf.length - loopSamples, loopSamples);
    for (let i = 0; i < overhang; i++) out[i] += buf[loopSamples + i];
    return out;
}

export function wav (buf)
{
    const bytes = Buffer.alloc(44 + buf.length * 2);

    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(36 + buf.length * 2, 4);
    bytes.write('WAVE', 8);
    bytes.write('fmt ', 12);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);            // PCM
    bytes.writeUInt16LE(1, 22);            // mono
    bytes.writeUInt32LE(RATE, 24);
    bytes.writeUInt32LE(RATE * 2, 28);     // byte rate
    bytes.writeUInt16LE(2, 32);            // block align
    bytes.writeUInt16LE(16, 34);           // bits per sample
    bytes.write('data', 36);
    bytes.writeUInt32LE(buf.length * 2, 40);

    for (let i = 0; i < buf.length; i++)
    {
        const s = Math.max(-1, Math.min(1, buf[i]));
        bytes.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
    }

    return bytes;
}

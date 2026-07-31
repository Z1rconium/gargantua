#!/usr/bin/env python3
"""Synthesize assets/ambient.wav — a seamless 48 s deep-space drone.

Loop safety: every oscillator and every amplitude LFO uses a frequency that is an
integer multiple of 1/T, so the waveform is exactly periodic over the file length.
The filtered-noise wash is shaped by an envelope that is zero at both ends.
Pure stdlib (wave + math): no numpy required.
"""
import math
import random
import struct
import wave
from pathlib import Path

T = 48.0          # loop length, seconds
SR = 22050        # sample rate
N = int(T * SR)

random.seed(7)

def q(f):
    """Quantize a frequency to an exact multiple of 1/T."""
    return round(f * T) / T

# (freq Hz, gain, LFO cycles per loop, LFO depth)
VOICES = [
    (q(55.0),   0.230, 1, 0.45),   # A1 fundamental
    (q(55.7),   0.110, 2, 0.55),   # detuned pair -> slow beating
    (q(82.5),   0.130, 2, 0.50),   # E2 fifth
    (q(110.0),  0.120, 3, 0.45),   # A2
    (q(138.6),  0.055, 2, 0.60),   # C#3
    (q(164.8),  0.050, 3, 0.55),   # E3
    (q(220.0),  0.040, 4, 0.60),   # A3
    (q(660.0),  0.011, 5, 0.80),   # shimmer partials
    (q(880.0),  0.008, 7, 0.85),
]
PHASES = [random.uniform(0, 2 * math.pi) for _ in VOICES]
LFO_PHASES = [random.uniform(0, 2 * math.pi) for _ in VOICES]

# pre-render a loop-periodic low-passed noise wash
lp = 0.0
alpha = 1.0 - math.exp(-2.0 * math.pi * 420.0 / SR)   # ~420 Hz one-pole
noise = []
for i in range(N):
    lp += alpha * (random.uniform(-1.0, 1.0) - lp)
    noise.append(lp)

samples = []
TAU = 2.0 * math.pi
for i in range(N):
    t = i / SR
    s = 0.0
    for (f, g, lfoc, depth), ph, lph in zip(VOICES, PHASES, LFO_PHASES):
        lfo = 1.0 - depth * 0.5 * (1.0 + math.sin(TAU * lfoc * t / T + lph))
        s += g * lfo * math.sin(TAU * f * t + ph)
    # noise wash: envelope hits zero exactly at t=0 and t=T
    env = 0.5 * (1.0 - math.cos(TAU * 2.0 * t / T))
    s += 0.035 * env * noise[i]
    samples.append(s)

peak = max(abs(x) for x in samples)
scale = 0.60 / peak
out = Path(__file__).resolve().parent.parent / 'assets' / 'ambient.wav'
out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out), 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(b''.join(
        struct.pack('<h', int(max(-1.0, min(1.0, x * scale)) * 32767)) for x in samples))

print(f'wrote {out} ({out.stat().st_size / 1e6:.2f} MB, {T:.0f}s @ {SR} Hz)')

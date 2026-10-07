"""Original procedural score and Foley. No samples, recordings, or external music.
90 s, stereo, 48 kHz. Fixed seed makes every render identical.
Run with Python + NumPy (the bundled Codex Python includes it).
"""
from pathlib import Path
import json
import wave
import numpy as np

SR = 48000
DURATION = 90
rng = np.random.default_rng(1942)
out = np.zeros((SR * DURATION, 2), dtype=np.float64)

def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)

def add(signal, start, gain=1., pan=0.):
    offset = round(start * SR)
    if offset < 0:
        signal = signal[-offset:]
        offset = 0
    n = min(len(signal), len(out) - offset)
    if n <= 0:
        return
    left, right = np.cos((pan + 1)*np.pi/4), np.sin((pan + 1)*np.pi/4)
    out[offset:offset+n, 0] += signal[:n] * gain * left
    out[offset:offset+n, 1] += signal[:n] * gain * right

def note(midi, duration=2.6):
    t = np.arange(int(SR*duration))/SR
    attack = 1-np.exp(-t*95)
    tone = np.sin(2*np.pi*hz(midi)*t) + .20*np.sin(2*np.pi*hz(midi)*2*t)*np.exp(-t*2.5)
    env = attack*np.exp(-t*2.3) * np.minimum(1, (duration-t)/.1)
    return tone*env

# D minor / B-flat / F / C: open voicings, slow harmonic rhythm.
chords = [[50,57,60,64,69], [46,53,57,60,65], [41,53,57,60,67], [48,55,62,64,67]]
for index, start in enumerate(np.arange(0, DURATION, 6.)):
    chord = chords[index % 4]
    t = np.arange(int(SR*7.5))/SR
    env = np.minimum(t/1.6, 1)*np.minimum((7.5-t)/2, 1)
    for k, midi in enumerate(chord[1:]):
        signal = np.sin(2*np.pi*hz(midi)*t+.08*np.sin(2*np.pi*.19*t))
        add(signal*env, start, .014, -.55+k*.36)
    # Low, soft bass pulse. No heavy drum loop.
    for beat in range(3):
        tb = np.arange(int(SR*2))/SR
        bass = np.sin(2*np.pi*hz(chord[0]-12)*tb)*(1-np.exp(-tb*18))*np.exp(-tb*1.8)
        add(bass, start+beat*2, .047)
    for step in range(8):
        if index == 0 and step < 3:
            continue
        when = start + .5 + step*2/3
        midi = chord[1+(step%4)] + (12 if step%3 == 0 else 0)
        sig = note(midi)
        pan = [-.35,.25,.1,-.2][step%4]
        add(sig, when, .029, pan)
        add(sig, when+.31, .007, -pan)
    if start >= 7:
        for step in range(9):
            tt = np.arange(int(SR*.11))/SR
            noise = rng.normal(0,1,len(tt));noise = np.diff(noise,prepend=0)
            add(noise*np.exp(-tt*70), start+step*2/3, .0018, (-1)**step*.5)

# Mouse clicks are short, quiet wooden taps, not exaggerated UI beeps.
clicks = [8.7,10.4,12.25,14.1,18.2,22.5,26.2,31.6,36.2,39.3,43.7,46,48.3,55.5,58.3,70.2,75.5,81.2]
for when in clicks:
    t = np.arange(int(SR*.07))/SR
    click = (.6*np.sin(2*np.pi*940*t)+.15*rng.normal(0,1,len(t)))*np.exp(-t*110)*(1-np.exp(-t*1000))
    add(click, when, .033)
for when in [7,17,30,42,54,66,84]:
    t = np.arange(int(SR*.3))/SR
    noise = rng.normal(0,1,len(t))
    soft = np.convolve(noise,np.ones(25)/25,mode='same')
    add(soft*np.sin(np.pi*t/.3)**2,when-.06,.018,-.1)
for when in [51.9,77.2]:
    add(note(76,.9),when,.018,-.12)
    add(note(81,.9),when+.14,.013,.12)

# Head/tail ramps, finite signal, and generous pre-normalization headroom.
time = np.arange(len(out))/SR
out *= (np.minimum(time/1.1,1)*np.minimum((DURATION-time)/2.1,1))[:,None]
peak = float(np.max(np.abs(out)))
assert np.isfinite(out).all() and peak < 1
output = Path(__file__).resolve().parent.parent / 'output'
output.mkdir(exist_ok=True)
with wave.open(str(output/'soundtrack.wav'),'wb') as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
    f.writeframes((out*32767).astype('<i2').tobytes())
(output/'audio-source.json').write_text(json.dumps({'duration':DURATION,'sample_rate':SR,'channels':2,'peak_dbfs':20*np.log10(peak),'original':True,'external_samples':False},indent=2))
print(f'Original soundtrack saved: {DURATION}s / stereo / 48 kHz / peak {20*np.log10(peak):.1f} dBFS')

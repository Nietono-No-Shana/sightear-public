import { PIANO_SAMPLES, pianoVoiceFor } from '../src/adapters/piano-samples';

describe('piano sample map', () => {
  it('samples the keyboard in minor thirds from A0 to C8', () => {
    expect(PIANO_SAMPLES).toHaveLength(30);
    expect(PIANO_SAMPLES[0]?.midi).toBe(21);
    expect(PIANO_SAMPLES.at(-1)?.midi).toBe(108);
    for (let index = 1; index < PIANO_SAMPLES.length; index += 1) {
      expect(PIANO_SAMPLES[index]!.midi - PIANO_SAMPLES[index - 1]!.midi).toBe(3);
    }
  });

  it('plays each sample at its own pitch without resampling', () => {
    for (const sample of PIANO_SAMPLES) {
      const voice = pianoVoiceFor(sample.midi);
      expect(voice.sample.midi).toBe(sample.midi);
      expect(voice.playbackRate).toBe(1);
    }
  });

  it('picks the nearest sample for every pitch inside the sampled range', () => {
    for (let midi = 21; midi <= 108; midi += 1) {
      const voice = pianoVoiceFor(midi);
      expect(Math.abs(voice.sample.midi - midi)).toBeLessThanOrEqual(1.5);
      expect(voice.playbackRate).toBeCloseTo(2 ** ((midi - voice.sample.midi) / 12), 10);
    }
  });

  it('clamps pitches outside the sampled range to its ends', () => {
    expect(pianoVoiceFor(0).sample.midi).toBe(21);
    expect(pianoVoiceFor(127).sample.midi).toBe(108);
    expect(pianoVoiceFor(0).playbackRate).toBeCloseTo(2 ** (-21 / 12), 10);
    expect(pianoVoiceFor(127).playbackRate).toBeCloseTo(2 ** (19 / 12), 10);
  });

  it('rounds fractional pitches before choosing a sample', () => {
    expect(pianoVoiceFor(60.4).sample.midi).toBe(60);
    expect(pianoVoiceFor(61.6).sample.midi).toBe(63);
  });
});

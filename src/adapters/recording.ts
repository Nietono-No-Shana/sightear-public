import type { PcmRecording } from '../engine/ports';

export function recordingUrl(recording: PcmRecording): string {
  const buffer = new ArrayBuffer(44 + recording.samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string): void => { [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0))); };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, recording.sampleRate, true); view.setUint32(28, recording.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, recording.samples.length * 2, true);
  recording.samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

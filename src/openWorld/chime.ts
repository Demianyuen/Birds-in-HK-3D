/**
 * A soft, short bell when a flower is laid: a few decaying sine partials,
 * made on the fly (no audio files). Quietly does nothing where Web Audio is
 * missing or blocked.
 */
let context: AudioContext | null = null;

export function playLayingChime(): void {
  try {
    const AudioContextClass = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    context ??= new AudioContextClass();
    if (context.state === 'suspended') void context.resume();
    const now = context.currentTime + 0.02;
    const master = context.createGain();
    master.gain.value = 0.16;
    master.connect(context.destination);
    // Two struck notes a fifth apart, like a small temple bell.
    for (const [start, base] of [[0, 523.25], [0.42, 783.99]] as const) {
      for (const [ratio, level, decay] of [[1, 1, 3.2], [2.01, 0.35, 1.6], [2.76, 0.22, 1.1], [5.4, 0.08, 0.5]] as const) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = base * ratio;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(level, now + start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + decay);
        oscillator.connect(gain).connect(master);
        oscillator.start(now + start);
        oscillator.stop(now + start + decay + 0.05);
      }
    }
  } catch {
    // Sound is a nicety; never block laying the flower.
  }
}

/* Browser preview of the tank sounds: same integer algorithm as firmware/main/aqua_sound.c. */
(function (root) {
  'use strict';
  const RATE = 16000, VOICES = 8;
  const SINE = Int16Array.from({ length: 256 }, (_, i) => Math.floor(Math.sin(i * 2 * Math.PI / 256) * 32767 + 0.5));
  // Arithmetic shift right that stays exact beyond 32 bits, matching C int64 >> on negatives.
  const shr = (v, n) => Math.floor(v / 2 ** n);

  function create(seed) {
    return { seed: seed >>> 0, clock: 0, nextBubble: RATE, nextTiny: 0, nextLfo: 0, lpFast: 0, lpSlow: 0, lfo: 26000, lfoTarget: 26000,
      gain: 0, splash: 0, splashLp: 0, voice: Array.from({ length: VOICES }, () => ({ phase: 0, inc: 0, env: 0, decay: 0, sweep: 0 })) };
  }
  const rnd = s => (s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0);
  const between = (s, lo, hi) => lo + ((rnd(s) >>> 8) % (hi - lo + 1));
  const hz = f => Math.floor(f * 4294967296 / RATE) >>> 0;
  function startVoice(s, f0, amp, decay, sweep) {
    let v = s.voice[0];
    for (const o of s.voice) if (o.env < v.env) v = o;
    Object.assign(v, { phase: 0, inc: hz(f0), env: amp, decay, sweep });
  }
  function plop(s) { s.splash = 5000; startVoice(s, between(s, 380, 620), between(s, 7000, 9000), 32702, 10); }
  function render(s, out, water, immersive) {
    const target = water ? (immersive ? 26000 : 21000) : 0;
    for (let i = 0; i < out.length; i++, s.clock++) {
      if (s.gain < target) s.gain++; else if (s.gain > target) s.gain--;
      const white = (rnd(s) >>> 16) - 32768;
      s.lpFast += ((white - s.lpFast) * 14580) >> 15;
      s.lpSlow += ((s.lpFast - s.lpSlow) * 3064) >> 15;
      const fizz = s.lpFast - s.lpSlow;
      if (s.clock >= s.nextLfo) { s.lfoTarget = between(s, 22000, 32767); s.nextLfo = s.clock + between(s, 6000, 26000); }
      s.lfo += (s.lfoTarget - s.lfo) >> 12;
      if (s.gain > 0 && s.clock >= s.nextTiny) {
        startVoice(s, between(s, 1400, 3200), (between(s, 700, 1800) * s.gain) >> 15, 32480, 10);
        s.nextTiny = s.clock + between(s, 300, 1400);
      }
      if (s.gain > 0 && s.clock >= s.nextBubble) {
        startVoice(s, between(s, 500, 900), (between(s, 1500, 2800) * s.gain) >> 15, 32640, 11);
        s.nextBubble = s.clock + between(s, 12000, 40000);
      }
      let mix = shr(shr(shr(fizz * s.lfo, 15) * s.gain, 15), 5);
      if (s.splash > 8) {
        s.splashLp += ((white - s.splashLp) * 20000) >> 15;
        mix += (s.splashLp * s.splash) >> 15;
        s.splash = (s.splash * 32420) >> 15;
      }
      for (const b of s.voice) {
        if (b.env < 16) continue;
        mix += (SINE[b.phase >>> 24] * b.env) >> 15;
        b.phase = (b.phase + b.inc) >>> 0;
        b.inc = (b.inc + (b.inc >>> b.sweep)) >>> 0;
        b.env = (b.env * b.decay) >> 15;
      }
      out[i] = Math.max(-32768, Math.min(32767, mix));
    }
  }

  // Plays the live preview. Browsers only allow audio after a click or key press, so start() is
  // called from the first interaction; it is safe to call repeatedly.
  let ctx = null, node = null, synth = null, heard = 0;
  function start(getState) {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ sampleRate: RATE });
    synth = create(1179);
    const pcm = new Int16Array(1024);
    node = ctx.createScriptProcessor(1024, 0, 1);
    node.onaudioprocess = e => {
      const s = getState(), data = e.outputBuffer.getChannelData(0);
      if (s.plops < heard) heard = s.plops;
      for (; heard < s.plops; heard++) plop(synth);
      render(synth, pcm, s.sound, s.immersive);
      for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
    };
    node.connect(ctx.destination);
  }
  root.AquaSound = { RATE, create, plop, render, start };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AquaSound;
})(globalThis);

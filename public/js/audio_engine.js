/**
 * VIGIL AI — Generative audio engine (Phase 9).
 *
 * Synthesizes calm soundscapes in the browser from a track's `gen_params`
 * recipe — no audio files, nothing copyrighted, works offline. A live
 * deployment swaps recipes for real streaming URLs without touching this
 * page: the player only needs play/pause/seek/duration.
 *
 * Recipe fields: base (Hz), pad (warm|soft|airy|dark), texture
 * (waves|rain|breeze|wind|none), tempo (pulses per minute).
 */
(function (V) {
  let ctx = null;
  let master = null;
  let nodes = [];
  let timerIds = [];
  let current = null;   // { trackId, startedAt, pausedAt }
  let volume = 0.6;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function stop() {
    timerIds.forEach(clearInterval);
    timerIds = [];
    nodes.forEach(function (n) {
      try {
        if (n.stop) n.stop();
        n.disconnect();
      } catch (e) { /* already stopped */ }
    });
    nodes = [];
    current = null;
  }

  function padWave(kind) {
    return { warm: "sine", soft: "sine", airy: "triangle", dark: "sine" }[kind] || "sine";
  }

  function start(track) {
    const c = ensureCtx();
    if (!c) return false;
    stop();
    const p = track.gen_params || {};
    const now = c.currentTime;

    // --- base drone: two detuned oscillators through a lowpass ---
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = { warm: 900, soft: 700, airy: 1400, dark: 500 }[p.pad] || 800;
    filter.connect(master);

    const padGain = c.createGain();
    padGain.gain.value = 0.16;
    padGain.connect(filter);

    [0, 0.6].forEach(function (detune) {
      const osc = c.createOscillator();
      osc.type = padWave(p.pad);
      osc.frequency.value = p.base;
      osc.detune.value = detune * 10;
      osc.connect(padGain);
      osc.start();
      nodes.push(osc);
    });
    nodes.push(padGain, filter);

    // slow breathing LFO on the pad gain
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain);
    lfoGain.connect(padGain.gain);
    lfo.start();
    nodes.push(lfo, lfoGain);

    // --- texture layer (filtered noise) ---
    if (p.texture && p.texture !== "none") {
      const noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = c.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;
      const nFilter = c.createBiquadFilter();
      const nGain = c.createGain();
      if (p.texture === "waves") {
        nFilter.type = "lowpass"; nFilter.frequency.value = 400; nGain.gain.value = 0.05;
        // slow swell
        const swell = c.createOscillator(); const swellG = c.createGain();
        swell.frequency.value = 0.08; swellG.gain.value = 0.04;
        swell.connect(swellG); swellG.connect(nGain.gain); swell.start();
        nodes.push(swell, swellG);
      } else if (p.texture === "rain") {
        nFilter.type = "bandpass"; nFilter.frequency.value = 1800; nFilter.Q.value = 0.6; nGain.gain.value = 0.035;
      } else if (p.texture === "breeze") {
        nFilter.type = "bandpass"; nFilter.frequency.value = 700; nFilter.Q.value = 0.4; nGain.gain.value = 0.03;
        const sway = c.createOscillator(); const swayG = c.createGain();
        sway.frequency.value = 0.11; swayG.gain.value = 600;
        sway.connect(swayG); swayG.connect(nFilter.frequency); sway.start();
        nodes.push(sway, swayG);
      } else { // wind
        nFilter.type = "lowpass"; nFilter.frequency.value = 300; nGain.gain.value = 0.05;
      }
      noise.connect(nFilter); nFilter.connect(nGain); nGain.connect(master);
      noise.start();
      nodes.push(noise, nFilter, nGain);
    }

    // --- gentle pulse (soft chime at tempo) ---
    if (p.tempo) {
      const interval = 60000 / p.tempo;
      timerIds.push(setInterval(function () {
        if (!ctx) return;
        const t = ctx.currentTime;
        const chime = ctx.createOscillator();
        const chimeGain = ctx.createGain();
        chime.type = "sine";
        chime.frequency.value = p.base * 2;
        chimeGain.gain.setValueAtTime(0.0001, t);
        chimeGain.gain.exponentialRampToValueAtTime(0.05, t + 0.06);
        chimeGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        chime.connect(chimeGain); chimeGain.connect(master);
        chime.start(t); chime.stop(t + 2);
      }, interval * 4)); // every 4 beats — sparse
    }

    current = { trackId: track.id, startedAt: Date.now() };
    return true;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = volume;
  }

  function getVolume() { return volume; }
  function playing() { return !!current; }
  function trackId() { return current ? current.trackId : null; }

  V.AudioEngine = {
    start: start, stop: stop, setVolume: setVolume, getVolume: getVolume,
    playing: playing, trackId: trackId,
  };
})(window.VIGIL = window.VIGIL || {});

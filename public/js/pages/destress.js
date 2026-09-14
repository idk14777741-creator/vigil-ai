/**
 * VIGIL AI — De-stress Zone (Phase 9).
 * Music station (generative audio — no copyrighted files) and calming videos.
 * Everything here is demo content, clearly labelled.
 */
(function (V) {
  const esc = V.UI.esc;
  const demoChip = V.UI.demoChip;
  const toast = V.UI.toast;
  const confirmModal = V.UI.confirmModal;

  V.ROUTER.register("/destress", render, { title: "De-stress Zone", nav: "/destress", roles: ["personnel"] });

  const TRACK_CATS = [
    ["", "All"], ["calm", "Calm"], ["relaxation", "Relaxation"], ["focus", "Focus"],
    ["sleep", "Sleep"], ["ambient", "Ambient"], ["comfort", "Comfort"],
  ];
  const VIDEO_CATS = [
    ["", "All"], ["breathing", "Breathing"], ["relaxation", "Relaxation"], ["mindfulness", "Mindfulness"],
    ["stretching", "Stretching"], ["sleep", "Sleep"], ["positive", "Positive"],
  ];

  const state = {
    tab: "music",
    trackCat: "",
    videoCat: "",
    tracks: [],
    videos: [],
    history: [],
    queue: [],
    idx: 0,
    shuffle: false,
    repeat: false,
    timerMin: 0,
    timerLeft: 0,
    timerId: null,
  };

  function render(el) {
    el.innerHTML = '<div class="page">' +
      '<div class="page-header"><div><h1>De-stress Zone</h1>' +
      '<p class="sub">A quieter corner of the app. Put on a soundscape, follow a breathing exercise, or simply sit for a moment.</p></div>' +
      demoChip("Demo content") + "</div>" +
      '<div class="tabs" role="tablist">' +
      '<button role="tab" data-tab="music" class="active">♪ Music station</button>' +
      '<button role="tab" data-tab="videos" data-videos>▷ De-stress videos</button>' +
      "</div>" +
      '<div id="dz-body"><div class="loading-block"><div class="spinner"></div><p>Loading…</p></div></div>' +
      '<div id="player-dock"></div>' +
      "</div>";

    document.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.tab = btn.getAttribute("data-tab");
        document.querySelectorAll("[data-tab]").forEach(function (b) { b.classList.toggle("active", b === btn); });
        draw();
      });
    });
    load();
  }

  window.addEventListener("vigil:navigating", function () {
    // leaving the page stops audio so sound never lingers across routes
    if (V.AudioEngine.playing()) V.AudioEngine.stop();
    clearInterval(state.timerId);
  });

  async function load() {
    const results = await Promise.allSettled([
      V.API.endpoints.musicTracks(state.trackCat),
      V.API.endpoints.videos(state.videoCat),
      V.API.endpoints.musicHistory(),
    ]);
    if (results[0].status === "fulfilled") state.tracks = results[0].value.tracks;
    if (results[1].status === "fulfilled") state.videos = results[1].value.videos;
    if (results[2].status === "fulfilled") state.history = results[2].value.history;
    draw();
  }

  function draw() {
    const body = document.getElementById("dz-body");
    if (!body) return;
    body.innerHTML = state.tab === "music" ? musicView() : videosView();
    wireMusic();
    wireVideos();
  }

  /* ================= music ================= */

  function musicView() {
    const grouped = {};
    state.tracks.forEach(function (t) {
      const list = (grouped[t.category] = grouped[t.category] || []);
      if (!state.trackCat || t.category === state.trackCat) list.push(t);
    });
    return '<div class="dz-grid">' +
      '<section class="card"><div class="card-header"><h3>Music station</h3><span class="meta">Generated live in your browser — royalty-free by design</span></div>' +
      '<div class="tabs dz-cats">' + TRACK_CATS.map(function (c) {
        return '<button data-tcat="' + c[0] + '" class="' + (state.trackCat === c[0] ? "active" : "") + '">' + c[1] + "</button>";
      }).join("") + "</div>" +
      '<div class="track-list">' +
      Object.keys(grouped).sort().map(function (cat) {
        return grouped[cat].map(function (t) {
          const active = V.AudioEngine.trackId() === t.id && V.AudioEngine.playing();
          return '<div class="track-row' + (active ? " playing" : "") + '" data-track="' + t.id + '" tabindex="0" role="button" aria-label="Play ' + esc(t.title) + '">' +
            '<span class="tr-icon" aria-hidden="true">' + (active ? "❚❚" : "▶") + "</span>" +
            '<div class="grow"><div class="tr-title">' + esc(t.title) + "</div>" +
            '<div class="tr-sub meta">' + esc(t.artist) + " · " + fmtDur(t.duration_sec) + "</div></div>" +
            '<span class="badge">' + esc(cat) + "</span></div>";
        }).join("");
      }).join("") +
      "</div></section>" +
      '<section class="card"><div class="card-header"><h3>Recently played</h3></div>' +
      (state.history.length
        ? '<div class="stack-list">' + state.history.map(function (t) {
            return '<div class="list-row" data-track="' + t.id + '" style="cursor:pointer"><div class="l-icon">♪</div>' +
              '<div class="grow"><div class="l-title">' + esc(t.title) + "</div>" +
              '<div class="l-sub">' + esc(t.category) + " · " + fmtDur(t.duration_sec) + "</div></div></div>";
          }).join("") + "</div>"
        : '<p class="meta">Nothing yet — start a track and it appears here.</p>') +
      '<div class="mt-6">' +
      '<div class="card-header"><h3>Wind-down timer</h3></div>' +
      '<p class="meta mb-2">Gently fades the music out and stops — handy before sleep.</p>' +
      '<div class="row gap-2 wrap">' +
      [15, 30, 45].map(function (m) {
        return '<button class="btn sm ghost" data-timer="' + m + '">' + m + " min</button>";
      }).join("") +
      '<button class="btn sm ghost" data-timer="0">Off</button>' +
      "</div>" +
      '<div id="timer-status" class="meta mt-2"></div>' +
      "</div></section></div>";
  }

  function wireMusic() {
    document.querySelectorAll("[data-tcat]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.trackCat = btn.getAttribute("data-tcat");
        load();
      });
    });
    document.querySelectorAll("[data-track]").forEach(function (row) {
      row.addEventListener("click", function () {
        const id = row.getAttribute("data-track");
        const track = state.tracks.find(function (t) { return t.id === id; }) ||
                      state.history.find(function (t) { return t.id === id; });
        if (!track) return;
        if (V.AudioEngine.trackId() === id && V.AudioEngine.playing()) {
          dockPause();
        } else {
          playTrack(id);
        }
      });
    });
    document.querySelectorAll("[data-timer]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTimer(parseInt(btn.getAttribute("data-timer"), 10));
      });
    });
  }

  /* ================= player ================= */

  function buildQueue(startId) {
    const pool = state.tracks.filter(function (t) { return !state.trackCat || t.category === state.trackCat; });
    const list = pool.length ? pool : state.tracks;
    let idx = list.findIndex(function (t) { return t.id === startId; });
    if (idx === -1) idx = 0;
    if (state.shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      }
      idx = list.findIndex(function (t) { return t.id === startId; });
      if (idx === -1) idx = 0;
    }
    state.queue = list;
    state.idx = idx;
  }

  async function playTrack(id) {
    const track = state.tracks.find(function (t) { return t.id === id; });
    if (!track) return;
    const ok = V.AudioEngine.start(track);
    if (!ok) { toast("Your browser couldn't start audio.", "error"); return; }
    buildQueue(id);
    V.AudioEngine.setVolume(parseFloat(document.getElementById("vol")?.value ?? 0.6));
    V.API.endpoints.recordPlay(id).catch(function () {});
    renderDock();
    draw(); // refresh playing markers
  }

  function dockPause() {
    V.AudioEngine.stop();
    renderDock();
    draw();
  }

  function next(dir) {
    if (!state.queue.length) return;
    if (!state.shuffle) {
      state.idx += dir;
      if (state.idx >= state.queue.length) {
        if (state.repeat) state.idx = 0;
        else { state.idx = state.queue.length - 1; dockPause(); return; }
      }
      if (state.idx < 0) state.idx = 0;
    } else {
      state.idx = Math.floor(Math.random() * state.queue.length);
    }
    playTrack(state.queue[state.idx].id);
  }

  function renderDock() {
    const dock = document.getElementById("player-dock");
    if (!dock) return;
    const track = state.tracks.find(function (t) { return t.id === V.AudioEngine.trackId(); });
    if (!track || !V.AudioEngine.playing()) {
      dock.innerHTML = "";
      return;
    }
    dock.innerHTML =
      '<div class="player-dock card">' +
      '<div class="row gap-3 grow" style="min-width:0">' +
      '<span class="pd-icon" aria-hidden="true">♪</span>' +
      '<div class="grow" style="min-width:0"><div class="pd-title truncate">' + esc(track.title) + "</div>" +
      '<div class="meta">' + esc(track.category) + " · generative · " + fmtDur(track.duration_sec) + "</div></div>" +
      '<div class="row gap-2">' +
      '<button class="icon-btn" id="pd-prev" aria-label="Previous track">⏮</button>' +
      '<button class="btn primary sm" id="pd-toggle" aria-label="Pause">❚❚</button>' +
      '<button class="icon-btn" id="pd-next" aria-label="Next track">⏭</button>' +
      '<button class="icon-btn' + (state.shuffle ? " active" : "") + '" id="pd-shuffle" aria-label="Shuffle" title="Shuffle">⤨</button>' +
      '<button class="icon-btn' + (state.repeat ? " active" : "") + '" id="pd-repeat" aria-label="Repeat" title="Repeat">↻</button>' +
      "</div>" +
      '<div class="row gap-2 pd-vol"><span aria-hidden="true">🔉</span>' +
      '<input type="range" id="vol" min="0" max="100" value="' + Math.round(V.AudioEngine.getVolume() * 100) + '" aria-label="Volume">' +
      "</div></div></div>";

    document.getElementById("pd-toggle").addEventListener("click", dockPause);
    document.getElementById("pd-prev").addEventListener("click", function () { next(-1); });
    document.getElementById("pd-next").addEventListener("click", function () { next(1); });
    document.getElementById("pd-shuffle").addEventListener("click", function () {
      state.shuffle = !state.shuffle; renderDock();
    });
    document.getElementById("pd-repeat").addEventListener("click", function () {
      state.repeat = !state.repeat; renderDock();
    });
    document.getElementById("vol").addEventListener("input", function (e) {
      V.AudioEngine.setVolume(parseInt(e.target.value, 10) / 100);
    });
  }

  function setTimer(minutes) {
    clearInterval(state.timerId);
    const status = document.getElementById("timer-status");
    if (!minutes) {
      state.timerMin = 0; state.timerLeft = 0;
      if (status) status.textContent = "Timer off.";
      return;
    }
    state.timerMin = minutes;
    state.timerLeft = minutes * 60;
    tickTimer();
    state.timerId = setInterval(tickTimer, 1000);
    if (status) status.textContent = "Will fade out in " + minutes + " minutes.";
  }

  function tickTimer() {
    state.timerLeft -= 1;
    const status = document.getElementById("timer-status");
    if (state.timerLeft <= 0) {
      clearInterval(state.timerId);
      V.AudioEngine.stop();
      renderDock();
      draw();
      if (status) status.textContent = "Timer finished — music stopped. Rest well.";
      return;
    }
    const mm = Math.floor(state.timerLeft / 60);
    const ss = state.timerLeft % 60;
    if (status) status.textContent = "Will fade out in " + mm + ":" + String(ss).padStart(2, "0");
  }

  /* ================= videos ================= */

  function videosView() {
    const vids = state.videos.filter(function (v) { return !state.videoCat || v.category === state.videoCat; });
    return '<div class="card"><div class="card-header"><h3>De-stress videos</h3><span class="meta">Demo placeholders — real videos arrive with media integration</span></div>' +
      '<div class="tabs dz-cats">' + VIDEO_CATS.map(function (c) {
        return '<button data-vcat="' + c[0] + '" class="' + (state.videoCat === c[0] ? "active" : "") + '">' + c[1] + "</button>";
      }).join("") + "</div>" +
      '<div class="video-grid">' + vids.map(function (v) {
        return '<article class="video-card" data-video="' + v.id + '" tabindex="0" role="button" aria-label="Open ' + esc(v.title) + '">' +
          '<div class="v-thumb cat-' + esc(v.category) + '"><span aria-hidden="true">' + videoIcon(v.category) + "</span>" +
          '<span class="v-dur">' + fmtDur(v.duration_sec) + "</span></div>" +
          '<div class="v-body"><div class="v-title">' + esc(v.title) + "</div>" +
          '<p class="meta">' + esc(v.description) + "</p>" +
          '<span class="badge">' + esc(v.category) + "</span></div></article>";
      }).join("") + "</div></div>";
  }

  function videoIcon(cat) {
    return { breathing: "◉", relaxation: "☾", mindfulness: "✦", stretching: "⤡", sleep: "☾", positive: "♡" }[cat] || "▷";
  }

  function wireVideos() {
    document.querySelectorAll("[data-vcat]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.videoCat = btn.getAttribute("data-vcat");
        load();
      });
    });
    document.querySelectorAll("[data-video]").forEach(function (card) {
      card.addEventListener("click", function () {
        const id = card.getAttribute("data-video");
        const v = state.videos.find(function (x) { return x.id === id; });
        if (v) openVideo(v);
      });
    });
  }

  function openVideo(v) {
    const m = V.UI.openModal({
      title: v.title,
      size: "lg",
      body:
        '<div class="video-placeholder">' +
        '<span class="vp-icon" aria-hidden="true">' + videoIcon(v.category) + "</span>" +
        "<p><strong>" + esc(v.title) + "</strong></p>" +
        '<p class="meta">' + esc(v.description) + "</p>" +
        '<p class="meta mt-4">Duration: ' + fmtDur(v.duration_sec) + " · demo placeholder</p>" +
        "</div>",
      footer: '<button class="btn ghost" data-act="close">Close</button>',
    });
    m.el.querySelector('[data-act="close"]').addEventListener("click", m.close);
  }

  /* ---------- helpers ---------- */

  function fmtDur(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }
})(window.VIGIL = window.VIGIL || {});

(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const state3104 = {
    version: "3.10.4",
    gmbStarted: false,
    gmbReady: false,
    mtrReady: false,
    secondPhaseReady: false,
    queued: [],
    active: 0,
    completed: 0,
    seen: 0,
    maxConcurrent: 2,
    gmbPromise: null,
    mtrPromise: null,
    readyPromise: null,
    readyResolve: null
  };

  state3104.readyPromise = new Promise(resolve => { state3104.readyResolve = resolve; });
  window.dzStageLoader3104 = state3104;

  function isLocalGmbShard(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      if (!raw) return false;
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) return false;
      return /\/gmb-(?:routes|stops)-\d+\.json$/i.test(url.pathname);
    } catch { return false; }
  }

  function pumpGmbQueue() {
    if (!state3104.gmbStarted) return;
    while (state3104.active < state3104.maxConcurrent && state3104.queued.length) {
      const job = state3104.queued.shift();
      state3104.active++;
      nativeFetch(job.input, job.init)
        .then(job.resolve, job.reject)
        .finally(() => {
          state3104.active--;
          state3104.completed++;
          pumpGmbQueue();
          if (state3104.gmbStarted && state3104.active === 0 && state3104.queued.length === 0 && state3104.seen >= 24) {
            state3104.gmbReady = true;
            checkReady();
            appendGmbNearby();
          }
        });
    }
  }

  window.fetch = function stagedFetch(input, init) {
    if (!isLocalGmbShard(input)) return nativeFetch(input, init);
    state3104.seen++;
    return new Promise((resolve, reject) => {
      state3104.queued.push({ input, init, resolve, reject });
      pumpGmbQueue();
    });
  };

  function startGmb() {
    if (state3104.gmbStarted) return;
    state3104.gmbStarted = true;
    pumpGmbQueue();
  }

  async function prepareMtr() {
    if (state3104.mtrPromise) return state3104.mtrPromise;
    state3104.mtrPromise = (async () => {
      try {
        const fn = window.dzExtraTransit?.ensureMtrData;
        if (typeof fn === "function") await fn();
      } catch {}
      state3104.mtrReady = true;
      checkReady();
    })();
    return state3104.mtrPromise;
  }

  function checkReady() {
    if (state3104.secondPhaseReady) return;
    if (state3104.gmbReady && state3104.mtrReady) {
      state3104.secondPhaseReady = true;
      state3104.readyResolve?.();
      const s = document.querySelector('#nearbyStatus');
      if (s && window.dzNearbyMapState?.position) s.textContent = `巴士／小巴／MTR 資料已準備。`;
    }
  }

  async function appendGmbNearby() {
    try {
      const mapState = window.dzNearbyMapState;
      const api = window.dzNearby393;
      if (!mapState?.position || typeof api?.collectStopsSafe !== 'function' || typeof window.loadNearbyEtas !== 'function') return;
      const all = await api.collectStopsSafe(mapState.position, mapState.radius || 100);
      const gmb = all.filter(x => x.operator === 'GMB');
      if (!gmb.length) return;
      const key = x => `${x.operator}|${x.stop}`;
      const have = new Set((mapState.stops || []).map(key));
      for (const x of gmb) if (!have.has(key(x))) mapState.stops.push(x);
      await window.loadNearbyEtas(gmb.map(x => ({operator:x.operator, stop:x.stop, stopObj:x.stopObj, distance:x.distance})));
    } catch {}
  }

  function startSecondPhase() {
    const status = document.querySelector('#nearbyStatus');
    if (status && window.dzNearbyMapState?.position) status.textContent = '巴士已顯示；背景載入小巴／MTR…';
    startGmb();
    prepareMtr();
  }

  function scheduleSecondPhase() {
    const go = () => startSecondPhase();
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 700 });
    else setTimeout(go, 450);
  }

  function installJourneyGate() {
    if (typeof window.runJourneySearch !== 'function' || window.runJourneySearch.__dz3104) return;
    const previous = window.runJourneySearch;
    const wrapped = async function() {
      if (!state3104.secondPhaseReady) {
        const s = document.querySelector('#journeyStatus');
        if (s) s.textContent = '正在等小巴及 MTR 資料完成，再開始完整搜尋…';
        startSecondPhase();
        await state3104.readyPromise;
      }
      return previous.apply(this, arguments);
    };
    wrapped.__dz3104 = true;
    window.runJourneySearch = wrapped;
  }

  function boot() {
    scheduleSecondPhase();
    installJourneyGate();
    setTimeout(installJourneyGate, 0);
    setTimeout(installJourneyGate, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();

  window.dzNearbyPriority3103 = {
    version: '3.10.4',
    startSecondPhase,
    prepareMtr,
    whenReady: () => state3104.readyPromise
  };
})();

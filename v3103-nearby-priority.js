(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const state3105 = {
    version: "3.10.5",
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

  state3105.readyPromise = new Promise(resolve => { state3105.readyResolve = resolve; });
  window.dzStageLoader3105 = state3105;

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
    if (!state3105.gmbStarted) return;
    while (state3105.active < state3105.maxConcurrent && state3105.queued.length) {
      const job = state3105.queued.shift();
      state3105.active++;
      nativeFetch(job.input, job.init)
        .then(job.resolve, job.reject)
        .finally(() => {
          state3105.active--;
          state3105.completed++;
          pumpGmbQueue();
          if (state3105.gmbStarted && state3105.active === 0 && state3105.queued.length === 0 && state3105.seen >= 24) {
            state3105.gmbReady = true;
            checkReady();
          }
        });
    }
  }

  window.fetch = function stagedFetch(input, init) {
    if (!isLocalGmbShard(input)) return nativeFetch(input, init);
    state3105.seen++;
    return new Promise((resolve, reject) => {
      state3105.queued.push({ input, init, resolve, reject });
      pumpGmbQueue();
    });
  };

  function startGmb() {
    if (state3105.gmbStarted) return;
    state3105.gmbStarted = true;
    pumpGmbQueue();
  }

  async function prepareMtr() {
    if (state3105.mtrPromise) return state3105.mtrPromise;
    state3105.mtrPromise = (async () => {
      try {
        const fn = window.dzExtraTransit?.ensureMtrData;
        if (typeof fn === "function") await fn();
      } catch {}
      state3105.mtrReady = true;
      checkReady();
    })();
    return state3105.mtrPromise;
  }

  function checkReady() {
    if (state3105.secondPhaseReady) return;
    if (state3105.gmbReady && state3105.mtrReady) {
      state3105.secondPhaseReady = true;
      state3105.readyResolve?.();
    }
  }

  function startSecondPhase() {
    startGmb();
    prepareMtr();
  }

  function installJourneyGate() {
    if (typeof window.runJourneySearch !== 'function' || window.runJourneySearch.__dz3105) return;
    const previous = window.runJourneySearch;
    const wrapped = async function() {
      if (!state3105.secondPhaseReady) {
        const s = document.querySelector('#journeyStatus');
        if (s) s.textContent = '先按需要準備附近小巴及 MTR，再開始完整搜尋…';
        startSecondPhase();
        await state3105.readyPromise;
      }
      return previous.apply(this, arguments);
    };
    wrapped.__dz3105 = true;
    window.runJourneySearch = wrapped;
  }

  document.addEventListener('dz:nearby-secondary-ready', () => {
    state3105.gmbStarted = true;
    state3105.gmbReady = true;
    state3105.mtrReady = true;
    checkReady();
  });

  function boot() {
    const v = document.querySelector('.app-version');
    if (v) { v.textContent = 'v3.10.5'; v.setAttribute('aria-label','版本 v3.10.5'); }
    installJourneyGate();
    setTimeout(installJourneyGate, 0);
    setTimeout(installJourneyGate, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();

  window.dzNearbyPriority3105 = {
    version: '3.10.5',
    startSecondPhase,
    prepareMtr,
    whenReady: () => state3105.readyPromise
  };
})();

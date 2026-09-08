(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const stage = {
    version: "4.0.4-stage",
    gmbStarted: false,
    gmbReady: false,
    mtrReady: false,
    secondPhaseReady: false,
    queued: [],
    active: 0,
    seen: 0,
    maxConcurrent: 2,
    mtrPromise: null,
    readyPromise: null,
    readyResolve: null
  };

  stage.readyPromise = new Promise(resolve => { stage.readyResolve = resolve; });
  window.dzStageLoader3105 = stage;

  function isLocalGmbShard(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      if (!raw) return false;
      const url = new URL(raw, location.href);
      return url.origin === location.origin && /\/gmb-(?:routes|stops)-\d+\.json$/i.test(url.pathname);
    } catch { return false; }
  }

  function checkReady() {
    if (!stage.secondPhaseReady && stage.gmbReady && stage.mtrReady) {
      stage.secondPhaseReady = true;
      stage.readyResolve?.();
      document.dispatchEvent(new CustomEvent('dz:nearby-secondary-ready'));
    }
  }

  function pump() {
    if (!stage.gmbStarted) return;
    while (stage.active < stage.maxConcurrent && stage.queued.length) {
      const job = stage.queued.shift();
      stage.active++;
      nativeFetch(job.input, job.init).then(job.resolve, job.reject).finally(() => {
        stage.active--;
        pump();
        if (stage.active === 0 && stage.queued.length === 0 && stage.seen >= 24) {
          stage.gmbReady = true;
          checkReady();
        }
      });
    }
  }

  window.fetch = function stagedFetch(input, init) {
    if (!isLocalGmbShard(input)) return nativeFetch(input, init);
    stage.seen++;
    return new Promise((resolve, reject) => {
      stage.queued.push({input, init, resolve, reject});
      pump();
    });
  };

  function startGmb() {
    if (!stage.gmbStarted) stage.gmbStarted = true;
    pump();
  }

  async function prepareMtr() {
    if (stage.mtrPromise) return stage.mtrPromise;
    stage.mtrPromise = (async () => {
      try {
        const fn = window.dzExtraTransit?.ensureMtrData;
        if (typeof fn === 'function') await fn();
      } catch {}
      stage.mtrReady = true;
      checkReady();
    })();
    return stage.mtrPromise;
  }

  function startSecondPhase() {
    startGmb();
    prepareMtr();
  }

  window.dzNearbyPriority3105 = {
    version: stage.version,
    startSecondPhase,
    prepareMtr,
    whenReady: () => stage.readyPromise
  };
})();

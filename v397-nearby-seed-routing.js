(() => {
  "use strict";
  // Emergency Safari stability hotfix v3.9.9.
  // The first nearby-seed prototype performed a very large nested scan across
  // route indexes and nearby transfer stops after every point-to-point search.
  // On iPhone Safari this can exceed the page process memory/CPU budget and
  // cause the tab to reload with "重複發生問題". Keep the experiment disabled
  // until it is rebuilt as a bounded/pre-indexed search.
  window.dzNearbySeed397 = {
    version: "3.9.9-disabled",
    disabled: true,
    reason: "Safari stability"
  };
})();

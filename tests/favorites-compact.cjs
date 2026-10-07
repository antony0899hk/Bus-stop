const fs = require("fs");
const assert = require("node:assert/strict");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");

assert(app.includes(".slice(0,2)"));
assert(app.includes('data-fav-eta="${i}"'));
assert(!app.includes('class="favorite-stop"'));
assert(app.includes('aria-label="移除 ${escapeHtml(f.route)} 收藏">×</button>'));
assert(css.includes("#favorites{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))"));
assert(css.includes(".favorite-stop{display:none}"));

console.log("Passed: favourites use a three-column compact grid with route-only cards and two ETAs.");

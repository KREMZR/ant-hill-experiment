/*
 * Runs the simulation without any drawing and prints what the colony is doing.
 * Usage: node tools/headless.js [minutes] [seed] [workers]
 */
'use strict';
var path = require('path');
['config', 'rng', 'world', 'ants', 'sim'].forEach(function (f) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
});
var AH = globalThis.AH, S = AH.STATE;

var minutes = +process.argv[2] || 30;
var seed = +process.argv[3] || 7;
var workers = +process.argv[4] || 0;

var sim = new AH.Sim({ seed: seed, workers: workers || undefined, naturalFood: process.argv[5] !== 'nofood' });
var col = sim.colony, W = sim.world;
console.log('nest at', W.nestX, W.nestY, '| rocks', W.rocks.length, '| foragers', col.count);
W.foods.forEach(function (f) {
  console.log(' food', f.type, 'amount', f.amount.toFixed(0), 'at distance',
    Math.hypot(f.x - W.nestX, f.y - W.nestY).toFixed(0), 'mm');
});

function trailMass() {
  var t = W.trail, s = 0, cells = 0;
  for (var i = 0; i < t.length; i++) if (t[i] > 0) { s += t[i]; if (t[i] > 1) cells++; }
  return s.toFixed(0) + '/' + cells;
}

var dt = 0.1, t0 = Date.now(), steps = 0;
console.log('min  out scout follow toFood search appr feed return lostN dump | delivered store hunger excite workers | trail(mass/cells) food');
for (var m = 1; m <= minutes; m++) {
  for (var k = 0; k < 600; k++) { sim.step(dt); steps++; }
  var c = col.stateCount;
  console.log(
    String(m).padStart(3), String(col.outside).padStart(4),
    String(c[S.SCOUT]).padStart(5), String(c[S.FOLLOW]).padStart(6), String(c[S.TO_FOOD]).padStart(6),
    String(c[S.SEARCH_FOOD]).padStart(6), String(c[S.APPROACH]).padStart(4), String(c[S.FEED]).padStart(4),
    String(c[S.RETURN]).padStart(6), String(c[S.SEARCH_NEST]).padStart(5), String(c[S.DUMP]).padStart(4), '|',
    String(col.delivered).padStart(6), col.store.toFixed(0).padStart(5), col.hunger.toFixed(2),
    col.excite.toFixed(1).padStart(5), String(col.workers).padStart(5), '|', trailMass(),
    W.foods.map(function (f) { return f.type[0] + f.amount.toFixed(0); }).join(' ')
  );
}
console.log('recruited', col.nRecruited, '| food found by: trail followers', col.nFollowFound, ', scouts', col.nScoutFound, ', returning by memory', col.nMemoryFound);
var ms = Date.now() - t0;
console.log('simulated', minutes, 'min in', ms, 'ms  (' + (minutes * 60 / (ms / 1000)).toFixed(0) + 'x real time,',
  (ms * 1000 / steps).toFixed(1), 'us per step)');

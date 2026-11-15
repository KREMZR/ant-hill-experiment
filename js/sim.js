/* Ties the ground and the colony together and advances time. */
(function (root) {
  'use strict';
  var AH = root.AH = root.AH || {};
  var C = AH.CONFIG;
  var TAU = Math.PI * 2;

  function Sim(opts) {
    opts = opts || {};
    this.seed = opts.seed || C.seed;
    this.rng = new AH.Rng(this.seed);
    this.world = new AH.World(this.rng);
    if (opts.trailLifetime) this.world.trailLifetime = opts.trailLifetime;
    this.world.generate();
    this.colony = new AH.Colony(this.world, this.rng, { workers: opts.workers });
    this.workers0 = this.colony.workers;   // the size it was started with
    this.time = 0;
    this.foodScale = Math.max(0.6, Math.min(5, this.colony.workers / C.colony.workers));
    this.naturalFood = opts.naturalFood !== false;
    this.foodTimer = this.rng.range(120, 240);
    if (opts.starterFood !== false) this.placeStarterFood();
  }

  Sim.prototype.placeStarterFood = function () {
    var W = this.world, p, k = Math.sqrt(this.foodScale);
    p = W.freeSpot(190, 260);
    if (p) W.addFood('sugar', p.x, p.y, 220 * k, 0.9);
    p = W.freeSpot(260, 340);
    if (p) W.addFood('crumbs', p.x, p.y, 90 * k, 0.7);
  };

  Sim.prototype.step = function (dt) {
    this.time += dt;
    this.world.update(dt);
    this.colony.step(dt);
    if (this.naturalFood) {
      this.foodTimer -= dt;
      if (this.foodTimer <= 0) {
        this.foodTimer = this.rng.range(C.food.spawnEvery[0], C.food.spawnEvery[1]) / Math.pow(this.foodScale, 0.7);
        if (this.world.foods.length < Math.round(C.food.maxNatural * Math.pow(this.foodScale, 0.6))) this.spawnNaturalFood();
      }
    }
  };

  /* Food that turns up by itself: a fallen insect, a seed head, a drop of honeydew. */
  Sim.prototype.spawnNaturalFood = function () {
    var W = this.world, rng = this.rng, p = W.freeSpot(140, 620), k = Math.sqrt(this.foodScale);
    if (!p) return null;
    if (rng.next() < 0.5) return W.addFood('sugar', p.x, p.y, rng.range(60, 220) * k, rng.range(0.3, 1));
    return W.addFood('crumbs', p.x, p.y, rng.range(30, 110) * k, 0.7);
  };

  Sim.prototype.canPlace = function (x, y, pad) {
    var W = this.world;
    if (x < 12 || y < 12 || x > W.w - 12 || y > W.h - 12) return false;
    if (Math.hypot(x - W.nestX, y - W.nestY) < C.nest.moundR + pad) return false;
    if (W.blocked(x, y)) return false;
    for (var k = 0; k < 8; k++) {
      var a = k / 8 * TAU;
      if (W.blocked(x + Math.cos(a) * pad, y + Math.sin(a) * pad)) return false;
    }
    return true;
  };

  Sim.prototype.addSugar = function (x, y, amount, quality) {
    if (!this.canPlace(x, y, 8)) return null;
    return this.world.addFood('sugar', x, y, amount || 200, quality == null ? 0.9 : quality);
  };

  Sim.prototype.addCrumbs = function (x, y, amount) {
    if (!this.canPlace(x, y, 10)) return null;
    return this.world.addFood('crumbs', x, y, amount || 80, 0.7);
  };

  Sim.prototype.addRock = function (x, y, r) {
    var W = this.world;
    if (x < r || y < r || x > W.w - r || y > W.h - r) return null;
    if (!W.canPlaceRock(x, y, r)) return null;
    var rock = W.addRock(x, y, r);
    this.colony.clearFromRock(rock);
    return rock;
  };

  /* Removes whatever is under the point: a rock, or a food source. */
  Sim.prototype.eraseAt = function (x, y) {
    var W = this.world, f = W.foodNear(x, y, 3);
    if (f) { W.removeFood(f); return 'food'; }
    var rock = W.rockAt(x, y);
    if (rock) { W.removeRock(rock); return 'rock'; }
    return null;
  };

  Sim.prototype.poke = function (x, y) { return this.colony.poke(x, y); };

  AH.Sim = Sim;
})(typeof window !== 'undefined' ? window : globalThis);

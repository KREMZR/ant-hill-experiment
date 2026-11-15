/*
 * The ground: pheromone fields, rocks, food, and the things ants leave behind.
 * No drawing code here; this file also runs under Node for headless tests.
 */
(function (root) {
  'use strict';
  var AH = root.AH = root.AH || {};
  var C = AH.CONFIG;
  var TAU = Math.PI * 2;

  function World(rng) {
    var cw = C.world;
    this.rng = rng;
    this.w = cw.w; this.h = cw.h;
    this.cell = cw.cell;
    this.gw = Math.ceil(this.w / this.cell);
    this.gh = Math.ceil(this.h / this.cell);
    this.trail = new Float32Array(this.gw * this.gh);
    this.trailTmp = new Float32Array(this.gw * this.gh);
    // bounding box of cells that hold any pheromone, so empty ground costs nothing
    this.tx0 = this.gw; this.tx1 = -1; this.ty0 = this.gh; this.ty1 = -1;
    this.decayCount = 0;
    this.obst = new Uint8Array(this.gw * this.gh);

    this.fcell = cw.foodCell;
    this.fw = Math.ceil(this.w / this.fcell);
    this.fh = Math.ceil(this.h / this.fcell);
    this.foodMap = new Int16Array(this.fw * this.fh);

    this.acell = cw.alarmCell;
    this.aw = Math.ceil(this.w / this.acell);
    this.ah = Math.ceil(this.h / this.acell);
    this.alarm = new Float32Array(this.aw * this.ah);
    this.alarmTmp = new Float32Array(this.aw * this.ah);
    this.alarmActive = false;

    this.nestX = Math.round(this.w * C.nest.fx);
    this.nestY = Math.round(this.h * C.nest.fy);
    var ma = rng.range(0, TAU);
    this.middenX = this.nestX + Math.cos(ma) * C.nest.middenDist;
    this.middenY = this.nestY + Math.sin(ma) * C.nest.middenDist;

    this.foods = [];
    this.foodById = {};
    this.foodSeq = 0;
    this.rocks = [];
    this.rockSeq = 0;
    this.pellets = [];   // soil grains carried out of the nest: [x, y, size, shade] flattened
    this.corpses = [];   // dead ants on the refuse pile: {x, y, rot, size}

    this.trailLifetime = C.trail.lifetime;
    this.decayAcc = 0;
    this.alarmAcc = 0;
    this.trailStamp = 0; // bumped whenever the trail field changes shape (for the overlay)
    this.rockStamp = 0;
    this.foodStamp = 0;
    this.pelletStamp = 0;
  }

  /* ---------- trail pheromone ---------- */

  World.prototype.sampleTrail = function (x, y) {
    var c = this.cell, gx = x / c - 0.5, gy = y / c - 0.5;
    var ix = Math.floor(gx), iy = Math.floor(gy), gw = this.gw;
    if (ix < 0 || iy < 0 || ix >= gw - 1 || iy >= this.gh - 1) return 0;
    var fx = gx - ix, fy = gy - iy, k = iy * gw + ix, t = this.trail;
    return (t[k] * (1 - fx) + t[k + 1] * fx) * (1 - fy) +
           (t[k + gw] * (1 - fx) + t[k + gw + 1] * fx) * fy;
  };

  World.prototype.depositTrail = function (x, y, amt) {
    var c = this.cell, gx = x / c - 0.5, gy = y / c - 0.5;
    var ix = Math.floor(gx), iy = Math.floor(gy), gw = this.gw;
    if (ix < 1 || iy < 1 || ix >= gw - 2 || iy >= this.gh - 2) return;
    if (ix < this.tx0) this.tx0 = ix;
    if (ix + 1 > this.tx1) this.tx1 = ix + 1;
    if (iy < this.ty0) this.ty0 = iy;
    if (iy + 1 > this.ty1) this.ty1 = iy + 1;
    var fx = gx - ix, fy = gy - iy, k = iy * gw + ix, t = this.trail, mx = C.trail.max, v;
    v = t[k] + amt * (1 - fx) * (1 - fy);            t[k] = v > mx ? mx : v;
    v = t[k + 1] + amt * fx * (1 - fy);              t[k + 1] = v > mx ? mx : v;
    v = t[k + gw] + amt * (1 - fx) * fy;             t[k + gw] = v > mx ? mx : v;
    v = t[k + gw + 1] + amt * fx * fy;               t[k + gw + 1] = v > mx ? mx : v;
  };

  World.prototype.clearTrailDisc = function (x, y, r) {
    var c = this.cell, gw = this.gw, gh = this.gh, t = this.trail;
    var x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(gw - 1, Math.ceil((x + r) / c));
    var y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(gh - 1, Math.ceil((y + r) / c));
    for (var gy = y0; gy <= y1; gy++) {
      for (var gx = x0; gx <= x1; gx++) {
        var dx = (gx + 0.5) * c - x, dy = (gy + 0.5) * c - y;
        if (dx * dx + dy * dy <= r * r) t[gy * gw + gx] = 0;
      }
    }
  };

  World.prototype.update = function (dt) {
    this.decayAcc += dt;
    if (this.decayAcc >= 1) {
      var f = Math.exp(-this.decayAcc / this.trailLifetime);
      this.decayAcc = 0;
      this.ageTrail(f, ++this.decayCount % 4 === 0);
      this.trailStamp++;
    }
    if (this.alarmActive) {
      this.alarmAcc += dt;
      if (this.alarmAcc >= 0.4) { this.updateAlarm(this.alarmAcc); this.alarmAcc = 0; }
    }
  };

  /*
   * Pheromone evaporates, and its scent spreads a little to either side of
   * where it was laid. The spreading is what lets two trails that run close
   * together merge into one.
   */
  World.prototype.ageTrail = function (f, spread) {
    var t = this.trail, gw = this.gw, gh = this.gh;
    var x0 = this.tx0, x1 = this.tx1, y0 = this.ty0, y1 = this.ty1;
    if (x1 < x0) return;
    var nx0 = gw, nx1 = -1, ny0 = gh, ny1 = -1, x, y, i, v;
    if (spread) {
      var b = this.trailTmp, k = C.trail.spread;
      x0 = Math.max(1, x0 - 1); x1 = Math.min(gw - 2, x1 + 1);
      y0 = Math.max(1, y0 - 1); y1 = Math.min(gh - 2, y1 + 1);
      for (y = y0; y <= y1; y++) {
        i = y * gw + x0;
        for (x = x0; x <= x1; x++, i++) {
          v = t[i];
          b[i] = (v + k * (t[i - 1] + t[i + 1] + t[i - gw] + t[i + gw] - 4 * v)) * f;
        }
      }
      for (y = y0; y <= y1; y++) {
        i = y * gw + x0;
        for (x = x0; x <= x1; x++, i++) {
          v = b[i];
          if (v < 0.004) v = 0;
          else { if (x < nx0) nx0 = x; if (x > nx1) nx1 = x; if (y < ny0) ny0 = y; if (y > ny1) ny1 = y; }
          t[i] = v;
        }
      }
    } else {
      for (y = y0; y <= y1; y++) {
        i = y * gw + x0;
        for (x = x0; x <= x1; x++, i++) {
          v = t[i];
          if (v === 0) continue;
          v *= f;
          if (v < 0.004) v = 0;
          else { if (x < nx0) nx0 = x; if (x > nx1) nx1 = x; if (y < ny0) ny0 = y; if (y > ny1) ny1 = y; }
          t[i] = v;
        }
      }
    }
    this.tx0 = nx0; this.tx1 = nx1; this.ty0 = ny0; this.ty1 = ny1;
  };

  /* ---------- alarm pheromone (volatile: spreads fast, fades fast) ---------- */

  World.prototype.depositAlarm = function (x, y, amt) {
    var ix = (x / this.acell) | 0, iy = (y / this.acell) | 0;
    if (ix < 0 || iy < 0 || ix >= this.aw || iy >= this.ah) return;
    this.alarm[iy * this.aw + ix] += amt;
    this.alarmActive = true;
  };

  World.prototype.sampleAlarm = function (x, y) {
    var ix = (x / this.acell) | 0, iy = (y / this.acell) | 0;
    if (ix < 0 || iy < 0 || ix >= this.aw || iy >= this.ah) return 0;
    return this.alarm[iy * this.aw + ix];
  };

  World.prototype.updateAlarm = function (dt) {
    var a = this.alarm, b = this.alarmTmp, aw = this.aw, ah = this.ah;
    var k = Math.min(0.24, C.alarm.diffusion * dt / 0.4);
    var f = Math.exp(-dt / C.alarm.lifetime), any = false;
    for (var y = 0; y < ah; y++) {
      for (var x = 0; x < aw; x++) {
        var i = y * aw + x, v = a[i];
        var l = x > 0 ? a[i - 1] : v, r = x < aw - 1 ? a[i + 1] : v;
        var u = y > 0 ? a[i - aw] : v, d = y < ah - 1 ? a[i + aw] : v;
        var nv = (v + k * (l + r + u + d - 4 * v)) * f;
        if (nv < 0.01) nv = 0; else any = true;
        b[i] = nv;
      }
    }
    this.alarm = b; this.alarmTmp = a;
    this.alarmActive = any;
  };

  /* ---------- rocks and the obstacle grid ---------- */

  World.prototype.blocked = function (x, y) {
    var m = C.world.margin;
    if (x < m || y < m || x > this.w - m || y > this.h - m) return true;
    return this.obst[((y / this.cell) | 0) * this.gw + ((x / this.cell) | 0)] === 1;
  };

  function makeRockShape(rng, r) {
    var n = 9 + rng.int(5), pts = [], i;
    var squash = rng.range(0.68, 1), rot = rng.range(0, TAU);
    var radii = [];
    for (i = 0; i < n; i++) radii.push(rng.range(0.78, 1.08));
    for (i = 0; i < n; i++) {
      var rr = (radii[i] * 2 + radii[(i + 1) % n] + radii[(i + n - 1) % n]) / 4;
      var a = (i + rng.range(-0.25, 0.25)) / n * TAU;
      var lx = Math.cos(a) * r * rr, ly = Math.sin(a) * r * rr * squash;
      pts.push(lx * Math.cos(rot) - ly * Math.sin(rot), lx * Math.sin(rot) + ly * Math.cos(rot));
    }
    return pts;
  }

  function insidePoly(pts, px, py, scale) {
    var inside = false, n = pts.length / 2;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = pts[i * 2] * scale, yi = pts[i * 2 + 1] * scale;
      var xj = pts[j * 2] * scale, yj = pts[j * 2 + 1] * scale;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  World.prototype.canPlaceRock = function (x, y, r) {
    var dx = x - this.nestX, dy = y - this.nestY;
    if (Math.sqrt(dx * dx + dy * dy) < r + C.nest.moundR + 6) return false;
    for (var i = 0; i < this.foods.length; i++) {
      var f = this.foods[i], fx = x - f.x, fy = y - f.y;
      if (Math.sqrt(fx * fx + fy * fy) < r + f.r + 8) return false;
    }
    return true;
  };

  World.prototype.addRock = function (x, y, r) {
    var rock = {
      id: ++this.rockSeq, x: x, y: y, r: r,
      pts: makeRockShape(this.rng, r),
      tone: this.rng.range(0, 1), seed: this.rng.int(1e9)
    };
    this.rocks.push(rock);
    this.rasterRock(rock);
    this.clearTrailDisc(x, y, r + 1);
    this.rockStamp++;
    return rock;
  };

  World.prototype.removeRock = function (rock) {
    var i = this.rocks.indexOf(rock);
    if (i < 0) return;
    this.rocks.splice(i, 1);
    this.obst.fill(0);
    for (var k = 0; k < this.rocks.length; k++) this.rasterRock(this.rocks[k]);
    this.rockStamp++;
  };

  World.prototype.rockAt = function (x, y) {
    for (var i = this.rocks.length - 1; i >= 0; i--) {
      var rk = this.rocks[i];
      if (insidePoly(rk.pts, x - rk.x, y - rk.y, 1)) return rk;
    }
    return null;
  };

  World.prototype.rasterRock = function (rock) {
    var c = this.cell, gw = this.gw, gh = this.gh;
    var pad = 1.2, scale = (rock.r + pad) / rock.r, R = rock.r * 1.15 + pad;
    var x0 = Math.max(0, Math.floor((rock.x - R) / c)), x1 = Math.min(gw - 1, Math.ceil((rock.x + R) / c));
    var y0 = Math.max(0, Math.floor((rock.y - R) / c)), y1 = Math.min(gh - 1, Math.ceil((rock.y + R) / c));
    for (var gy = y0; gy <= y1; gy++) {
      for (var gx = x0; gx <= x1; gx++) {
        if (insidePoly(rock.pts, (gx + 0.5) * c - rock.x, (gy + 0.5) * c - rock.y, scale)) {
          this.obst[gy * gw + gx] = 1;
        }
      }
    }
  };

  /* ---------- food ---------- */

  function sugarRadius(amount) { return 1.1 * Math.cbrt(Math.max(amount, 0.05)); }

  World.prototype.addFood = function (type, x, y, amount, quality) {
    var rng = this.rng, f = {
      uid: ++this.foodSeq, type: type, x: x, y: y,
      amount: amount, initial: amount, quality: quality,
      r: 0, mapR: 0, bits: null, dead: false, seed: rng.int(1e9)
    };
    if (type === 'sugar') {
      f.r = sugarRadius(amount);
    } else {
      var n = Math.round(amount), sd = 2 + Math.sqrt(n) * 0.5, maxd = 0;
      f.amount = f.initial = n;
      f.bits = [];
      for (var i = 0; i < n; i++) {
        var bx = rng.gauss() * sd, by = rng.gauss() * sd;
        var d = Math.sqrt(bx * bx + by * by);
        if (d > sd * 2.4) { bx *= sd * 2.4 / d; by *= sd * 2.4 / d; d = sd * 2.4; }
        if (d > maxd) maxd = d;
        f.bits.push({
          x: x + bx, y: y + by, s: rng.range(0.45, 0.95), rot: rng.range(0, TAU),
          shade: rng.next(), taken: false
        });
      }
      f.r = maxd + 0.5;
    }
    this.foods.push(f);
    this.foodById[f.uid] = f;
    this.rebuildFoodMap();
    return f;
  };

  World.prototype.removeFood = function (f) {
    if (f.dead) return;
    f.dead = true;
    delete this.foodById[f.uid];
    var i = this.foods.indexOf(f);
    if (i >= 0) this.foods.splice(i, 1);
    this.rebuildFoodMap();
  };

  World.prototype.shrinkSugar = function (f) {
    f.r = sugarRadius(f.amount);
    if (f.mapR - f.r > 0.6) this.rebuildFoodMap();
  };

  World.prototype.rebuildFoodMap = function () {
    var m = this.foodMap, fc = this.fcell, fw = this.fw, fh = this.fh;
    m.fill(0);
    for (var k = 0; k < this.foods.length; k++) {
      var f = this.foods[k];
      var R = f.r + (f.type === 'sugar' ? C.food.sugarDetect : C.food.crumbDetect);
      f.mapR = f.r;
      var x0 = Math.max(0, Math.floor((f.x - R) / fc)), x1 = Math.min(fw - 1, Math.floor((f.x + R) / fc));
      var y0 = Math.max(0, Math.floor((f.y - R) / fc)), y1 = Math.min(fh - 1, Math.floor((f.y + R) / fc));
      for (var gy = y0; gy <= y1; gy++) {
        for (var gx = x0; gx <= x1; gx++) {
          // nearest point of the cell to the food centre
          var cx = Math.max(gx * fc, Math.min(f.x, (gx + 1) * fc));
          var cy = Math.max(gy * fc, Math.min(f.y, (gy + 1) * fc));
          var dx = cx - f.x, dy = cy - f.y;
          if (dx * dx + dy * dy <= R * R) m[gy * fw + gx] = k + 1;
        }
      }
    }
    this.foodStamp++;
  };

  /* Returns the food source whose scent or surface the point is touching, or null. */
  World.prototype.foodAt = function (x, y) {
    var ix = (x / this.fcell) | 0, iy = (y / this.fcell) | 0;
    if (ix < 0 || iy < 0 || ix >= this.fw || iy >= this.fh) return null;
    var k = this.foodMap[iy * this.fw + ix];
    if (k === 0) return null;
    var f = this.foods[k - 1];
    if (!f) return null;
    var dx = x - f.x, dy = y - f.y;
    var R = f.r + (f.type === 'sugar' ? C.food.sugarDetect : C.food.crumbDetect);
    return dx * dx + dy * dy <= R * R ? f : null;
  };

  World.prototype.foodNear = function (x, y, pad) {
    for (var i = this.foods.length - 1; i >= 0; i--) {
      var f = this.foods[i], dx = x - f.x, dy = y - f.y;
      if (Math.sqrt(dx * dx + dy * dy) <= f.r + pad) return f;
    }
    return null;
  };

  /* ---------- things ants leave on the surface ---------- */

  World.prototype.addPellet = function (x, y) {
    var p = this.pellets, rng = this.rng;
    if (p.length >= 4 * 7000) return;
    p.push(x, y, rng.range(0.2, 0.5), rng.next());
    this.pelletStamp++;
  };

  World.prototype.addCorpse = function (x, y) {
    if (this.corpses.length >= 400) this.corpses.shift();
    this.corpses.push({ x: x, y: y, rot: this.rng.range(0, TAU), size: this.rng.range(3.4, 4.3) });
  };

  /* ---------- starting scenery ---------- */

  World.prototype.generate = function () {
    var rng = this.rng, tries = 0, placed = 0, i;
    while (placed < 15 && tries < 400) {
      tries++;
      var r = rng.next() < 0.3 ? rng.range(26, 46) : rng.range(9, 24);
      var x = rng.range(40, this.w - 40), y = rng.range(40, this.h - 40);
      var dn = Math.hypot(x - this.nestX, y - this.nestY);
      if (dn < r + 85) continue;
      if (Math.hypot(x - this.middenX, y - this.middenY) < r + 25) continue;
      var ok = true;
      for (i = 0; i < this.rocks.length; i++) {
        var q = this.rocks[i];
        if (Math.hypot(x - q.x, y - q.y) < r + q.r + 14) { ok = false; break; }
      }
      if (!ok) continue;
      this.addRock(x, y, r);
      placed++;
    }
    // the mound: grains the colony has already carried out
    var mr = C.nest.moundR;
    for (i = 0; i < 3800; i++) {
      var a = rng.range(0, TAU);
      var d = mr * 0.55 + rng.gauss() * mr * 0.24;
      if (d < C.nest.entranceR + 1.2) d = C.nest.entranceR + 1.2 + rng.next() * 3;
      this.addPellet(this.nestX + Math.cos(a) * d, this.nestY + Math.sin(a) * d * 0.94);
    }
  };

  World.prototype.freeSpot = function (minNest, maxNest) {
    var rng = this.rng;
    for (var t = 0; t < 200; t++) {
      var a = rng.range(0, TAU), d = rng.range(minNest, maxNest);
      var x = this.nestX + Math.cos(a) * d, y = this.nestY + Math.sin(a) * d;
      if (x < 40 || y < 40 || x > this.w - 40 || y > this.h - 40) continue;
      if (this.blocked(x, y) || this.rockAt(x, y)) continue;
      var clear = true;
      for (var k = 0; k < 8 && clear; k++) {
        var b = k / 8 * TAU;
        if (this.blocked(x + Math.cos(b) * 14, y + Math.sin(b) * 14)) clear = false;
      }
      if (!clear || this.foodNear(x, y, 40)) continue;
      return { x: x, y: y };
    }
    return null;
  };

  AH.World = World;
  AH.sugarRadius = sugarRadius;
})(typeof window !== 'undefined' ? window : globalThis);

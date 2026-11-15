/*
 * Drawing: camera, ants at three levels of detail, legs, food, rocks and the
 * pheromone view. Nothing in here affects the simulation.
 */
(function (root) {
  'use strict';
  var AH = root.AH = root.AH || {};
  var C = AH.CONFIG, S = AH.STATE, CARRY = AH.CARRY, TAU = Math.PI * 2;

  /*
   * Anatomy in body lengths; x points forward, y to the ant's left.
   * Legs 0-2 are left front/middle/hind, 3-5 the right side.
   * Ants walk with an alternating tripod: left-front, right-middle and
   * left-hind move together, then the other three.
   */
  var REST = [0.46, 0.34, 0.06, 0.52, -0.44, 0.40, 0.46, -0.34, 0.06, -0.52, -0.44, -0.40];
  var HIP = [0.20, 0.045, 0.12, 0.05, 0.04, 0.05, 0.20, -0.045, 0.12, -0.05, 0.04, -0.05];
  var FEM = [0.20, 0.23, 0.27, 0.20, 0.23, 0.27];
  var TIB = [0.38, 0.45, 0.52, 0.38, 0.45, 0.52];
  var LEG_OFF = [0, 0.5, 0, 0.5, 0, 0.5];
  var STRIDE = 0.6;            // body lengths travelled per full step cycle
  var SWING = 0.38;            // share of the cycle a foot spends in the air
  var TRAVEL = STRIDE * (1 - SWING);

  var BODY = '#1a130e', GASTER = '#1f160f', LEG = '#2b1e15';
  var CRUMB_COLS = ['#ead7a8', '#d9bf87', '#f1e3bd'];
  var LOD_MID = 1.6, LOD_FULL = 6;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cam = { x: 0, y: 0, z: 3 };
    this.dpr = 1; this.W = 0; this.H = 0; this.cssW = 0; this.cssH = 0;
    this.showTrail = false;
    this.showSense = true;
    this.selUid = 0; this.selIndex = -1; this.follow = false;
    this.clock = 0; this.frame = 0;
    this.ripples = [];
    var n = C.maxAgents;
    this.vis = new Int32Array(n);
    this.feet = new Float32Array(12);
    this.knees = new Float32Array(12);
    this.footX = new Float32Array(n * 6); this.footY = new Float32Array(n * 6);
    this.liftX = new Float32Array(n * 6); this.liftY = new Float32Array(n * 6);
    this.swing = new Uint8Array(n * 6);
    this.gUid = new Uint32Array(n); this.gOdo = new Float32Array(n);
    this.sim = null;
  }

  Renderer.prototype.setSim = function (sim) {
    var W = sim.world;
    this.sim = sim;
    this.ground = new AH.Ground(sim);
    this.trailCanvas = document.createElement('canvas');
    this.trailCanvas.width = W.gw; this.trailCanvas.height = W.gh;
    this.trailCtx = this.trailCanvas.getContext('2d');
    this.trailImg = this.trailCtx.createImageData(W.gw, W.gh);
    this.trailPx = new Uint32Array(this.trailImg.data.buffer);
    this.alarmCanvas = document.createElement('canvas');
    this.alarmCanvas.width = W.aw; this.alarmCanvas.height = W.ah;
    this.alarmCtx = this.alarmCanvas.getContext('2d');
    this.alarmImg = this.alarmCtx.createImageData(W.aw, W.ah);
    this.alarmPx = new Uint32Array(this.alarmImg.data.buffer);
    this.gUid.fill(0);
    this.selUid = 0; this.selIndex = -1; this.follow = false;
    this.cam.x = W.nestX; this.cam.y = W.nestY;
  };

  Renderer.prototype.resize = function () {
    var c = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = c.clientWidth, h = c.clientHeight;
    this.dpr = dpr; this.cssW = w; this.cssH = h;
    this.W = c.width = Math.max(1, Math.round(w * dpr));
    this.H = c.height = Math.max(1, Math.round(h * dpr));
    this.clampCam();
  };

  Renderer.prototype.minZoom = function () {
    var W = this.sim.world;
    return Math.min(this.cssW / W.w, this.cssH / W.h) * 0.92;
  };

  Renderer.prototype.clampCam = function () {
    if (!this.sim) return;
    var W = this.sim.world, cam = this.cam, zmin = this.minZoom();
    if (cam.z < zmin) cam.z = zmin; else if (cam.z > 64) cam.z = 64;
    if (cam.x < 0) cam.x = 0; else if (cam.x > W.w) cam.x = W.w;
    if (cam.y < 0) cam.y = 0; else if (cam.y > W.h) cam.y = W.h;
  };

  Renderer.prototype.screenToWorld = function (px, py) {
    return { x: this.cam.x + (px - this.cssW / 2) / this.cam.z, y: this.cam.y + (py - this.cssH / 2) / this.cam.z };
  };

  Renderer.prototype.zoomAt = function (px, py, factor) {
    var before = this.screenToWorld(px, py);
    this.cam.z *= factor;
    this.clampCam();
    var after = this.screenToWorld(px, py);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
    this.clampCam();
  };

  Renderer.prototype.selected = function () {
    if (!this.selUid) return -1;
    var col = this.sim.colony, i = this.selIndex;
    if (i >= 0 && col.alive[i] && col.uid[i] === this.selUid) return i;
    i = this.selIndex = col.findByUid(this.selUid);
    if (i < 0) { this.selUid = 0; this.follow = false; }
    return i;
  };

  /* Nearest ant on the surface to a screen point, or -1. */
  Renderer.prototype.pickAnt = function (px, py) {
    var col = this.sim.colony, w = this.screenToWorld(px, py), best = -1;
    var reach = Math.max(3.2, 16 / this.cam.z), bd = reach * reach;
    for (var i = 0, n = col.count; i < n; i++) {
      if (!col.alive[i] || col.state[i] === S.IN_NEST) continue;
      var dx = col.x[i] - w.x, dy = col.y[i] - w.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  /* ---------- legs ---------- */

  /* Foot positions from the step cycle alone (body frame, mm). */
  Renderer.prototype.feetAnalytic = function (L, odo) {
    var F = this.feet, ph = odo / (STRIDE * L);
    for (var k = 0; k < 6; k++) {
      var p = ph + LEG_OFF[k]; p -= Math.floor(p);
      var rx = REST[k * 2], ry = REST[k * 2 + 1], fx, fy = ry;
      if (p < SWING) {
        var s = p / SWING, e = s * s * (3 - 2 * s);
        fx = rx - TRAVEL / 2 + TRAVEL * e; fy = ry * (1 + 0.1 * Math.sin(Math.PI * s));
      } else {
        fx = rx + TRAVEL / 2 - TRAVEL * (p - SWING) / (1 - SWING);
      }
      F[k * 2] = fx * L; F[k * 2 + 1] = fy * L;
    }
  };

  /*
   * Feet that stay planted on the ground while the body moves over them, and
   * only step when their tripod's turn comes. Used when zoomed in close.
   */
  Renderer.prototype.feetPlanted = function (i, x, y, c, s, L, odo) {
    var F = this.feet, b = i * 6, k, uid = this.sim.colony.uid[i];
    var d = odo - this.gOdo[i], ph = odo / (STRIDE * L), p;
    var fresh = this.gUid[i] !== uid || d < 0 || d > STRIDE * L * 0.4;
    this.gOdo[i] = odo;
    this.feetAnalytic(L, odo);
    if (fresh) {
      this.gUid[i] = uid;
      for (k = 0; k < 6; k++) {
        var wx0 = x + c * F[k * 2] - s * F[k * 2 + 1], wy0 = y + s * F[k * 2] + c * F[k * 2 + 1];
        this.footX[b + k] = this.liftX[b + k] = wx0; this.footY[b + k] = this.liftY[b + k] = wy0;
        p = ph + LEG_OFF[k]; p -= Math.floor(p);
        this.swing[b + k] = p < SWING ? 1 : 0;
      }
      return;
    }
    for (k = 0; k < 6; k++) {
      p = ph + LEG_OFF[k]; p -= Math.floor(p);
      var ax = F[k * 2], ay = F[k * 2 + 1], wx, wy;
      if (p < SWING) {
        if (!this.swing[b + k]) { this.swing[b + k] = 1; this.liftX[b + k] = this.footX[b + k]; this.liftY[b + k] = this.footY[b + k]; }
        var tx = (REST[k * 2] + TRAVEL / 2) * L, ty = REST[k * 2 + 1] * L;
        var twx = x + c * tx - s * ty, twy = y + s * tx + c * ty;
        var sg = p / SWING, e = sg * sg * (3 - 2 * sg);
        wx = this.liftX[b + k] + (twx - this.liftX[b + k]) * e;
        wy = this.liftY[b + k] + (twy - this.liftY[b + k]) * e;
        this.footX[b + k] = wx; this.footY[b + k] = wy;
      } else {
        if (this.swing[b + k]) {
          this.swing[b + k] = 0;
          this.footX[b + k] = x + c * ax - s * ay; this.footY[b + k] = y + s * ax + c * ay;
        }
        wx = this.footX[b + k]; wy = this.footY[b + k];
      }
      var dx = wx - x, dy = wy - y;
      var bx = c * dx + s * dy, by = -s * dx + c * dy;
      // a planted foot dragged out of reach, or under the body, steps again
      var hx = bx - HIP[k * 2] * L, hy = by - HIP[k * 2 + 1] * L, reach = (FEM[k] + TIB[k]) * L;
      if (hx * hx + hy * hy > reach * reach || by * REST[k * 2 + 1] < 0.02 * L) {
        bx = ax; by = ay;
        this.footX[b + k] = x + c * ax - s * ay; this.footY[b + k] = y + s * ax + c * ay;
      }
      F[k * 2] = bx; F[k * 2 + 1] = by;
    }
  };

  /* Two-segment leg: find the knee, bent outward from the body. */
  Renderer.prototype.solveKnees = function (L) {
    var F = this.feet, K = this.knees;
    for (var k = 0; k < 6; k++) {
      var hx = HIP[k * 2] * L, hy = HIP[k * 2 + 1] * L, a = FEM[k] * L, b = TIB[k] * L;
      var dx = F[k * 2] - hx, dy = F[k * 2 + 1] - hy, len = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      var d = len, mx = a + b - 1e-3, mn = Math.abs(a - b) + 1e-3;
      if (d > mx) d = mx; else if (d < mn) d = mn;
      var ca = (a * a + d * d - b * b) / (2 * a * d);
      if (ca > 1) ca = 1; else if (ca < -1) ca = -1;
      var sa = Math.sqrt(1 - ca * ca), ux = dx / len, uy = dy / len;
      var k1y = hy + a * (uy * ca + ux * sa), k2y = hy + a * (uy * ca - ux * sa);
      var side = k < 3 ? 1 : -1;
      if (k1y * side > k2y * side) { K[k * 2] = hx + a * (ux * ca - uy * sa); K[k * 2 + 1] = k1y; }
      else { K[k * 2] = hx + a * (ux * ca + uy * sa); K[k * 2 + 1] = k2y; }
    }
  };

  /* ---------- frame ---------- */

  Renderer.prototype.draw = function (dtReal, animRate) {
    var sim = this.sim, ctx = this.ctx, cam = this.cam, W = this.W, H = this.H;
    if (!sim || W < 2) return;
    this.frame++;
    this.clock += dtReal * animRate;

    var sel = this.selected(), col = sim.colony;
    if (this.follow && sel >= 0 && col.state[sel] !== S.IN_NEST) {
      var kf = Math.min(1, dtReal * 5);
      cam.x += (col.x[sel] - cam.x) * kf; cam.y += (col.y[sel] - cam.y) * kf;
    }

    var Z = cam.z * this.dpr, ox = W / 2 - cam.x * Z, oy = H / 2 - cam.y * Z;
    var view = { x0: cam.x - W / (2 * Z), y0: cam.y - H / (2 * Z), x1: cam.x + W / (2 * Z), y1: cam.y + H / (2 * Z) };
    this.Z = Z; this.ox = ox; this.oy = oy; this.view = view;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#17120d';
    ctx.fillRect(0, 0, W, H);

    this.ground.syncPellets();
    this.ground.draw(ctx, Z, ox, oy, W, H, view, cam.z);

    if (this.showTrail) this.drawPheromones(Z, ox, oy, view);

    ctx.setTransform(Z, 0, 0, Z, ox, oy);
    this.drawNestHole();
    this.drawCorpses(view);
    this.drawFood(view);
    this.drawRocks(view, Z, ox, oy);
    this.drawAnts(Z, ox, oy);
    if (sel >= 0 && col.state[sel] !== S.IN_NEST) this.drawSelection(sel, Z, ox, oy);
    if (this.ripples.length) this.drawRipples(dtReal, Z, ox, oy);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  };

  /* ---------- pheromone view ---------- */

  Renderer.prototype.drawPheromones = function (Z, ox, oy, view) {
    var ctx = this.ctx, Wd = this.sim.world, i, v, a;
    if (this.frame % 4 === 0 || this.trailDirty !== Wd.trailStamp) {
      var t = Wd.trail, px = this.trailPx, n = t.length;
      for (i = 0; i < n; i++) {
        v = t[i];
        if (v < 0.03) { px[i] = 0; continue; }
        a = v / (v + 3) * 262; if (a > 255) a = 255;
        // little-endian ABGR: a pale blue-green
        px[i] = ((a | 0) << 24) | (255 << 16) | (238 << 8) | 130;
      }
      this.trailCtx.putImageData(this.trailImg, 0, 0);
      this.trailDirty = Wd.trailStamp;
    }
    var x0 = Math.max(0, view.x0), y0 = Math.max(0, view.y0);
    var x1 = Math.min(Wd.w, view.x1), y1 = Math.min(Wd.h, view.y1);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // lights down, so the invisible chemistry can be shown glowing
    ctx.fillStyle = 'rgba(8,10,16,0.5)';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0.6, Math.min(1, 1.15 - this.cam.z / 36));
    var c = Wd.cell;
    ctx.drawImage(this.trailCanvas, x0 / c, y0 / c, (x1 - x0) / c, (y1 - y0) / c,
      x0 * Z + ox, y0 * Z + oy, (x1 - x0) * Z, (y1 - y0) * Z);
    if (Wd.alarmActive) {
      var al = Wd.alarm, apx = this.alarmPx, an = al.length;
      for (i = 0; i < an; i++) {
        v = al[i];
        if (v < 0.02) { apx[i] = 0; continue; }
        a = v / (v + 0.8) * 300; if (a > 235) a = 235;
        apx[i] = ((a | 0) << 24) | (60 << 16) | (96 << 8) | 255;
      }
      this.alarmCtx.putImageData(this.alarmImg, 0, 0);
      var ac = Wd.acell;
      ctx.drawImage(this.alarmCanvas, x0 / ac, y0 / ac, (x1 - x0) / ac, (y1 - y0) / ac,
        x0 * Z + ox, y0 * Z + oy, (x1 - x0) * Z, (y1 - y0) * Z);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  };

  /* ---------- static things on the ground ---------- */

  Renderer.prototype.drawNestHole = function () {
    var ctx = this.ctx, W = this.sim.world, r = C.nest.entranceR;
    var g = ctx.createRadialGradient(W.nestX, W.nestY, 0, W.nestX, W.nestY, r * 1.7);
    g.addColorStop(0, '#040302'); g.addColorStop(0.55, '#0d0906');
    g.addColorStop(0.8, 'rgba(24,16,9,0.75)'); g.addColorStop(1, 'rgba(30,20,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(W.nestX, W.nestY, r * 1.7, r * 1.55, 0, 0, TAU); ctx.fill();
  };

  Renderer.prototype.drawCorpses = function (view) {
    var ctx = this.ctx, cs = this.sim.world.corpses, z = this.cam.z;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.x < view.x0 - 5 || c.x > view.x1 + 5 || c.y < view.y0 - 5 || c.y > view.y1 + 5) continue;
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      var s = c.size;
      ctx.fillStyle = '#15100c';
      ctx.beginPath();
      ctx.ellipse(-0.2 * s, 0, 0.22 * s, 0.13 * s, 0.2, 0, TAU);
      ctx.moveTo(0.2 * s, 0.05 * s); ctx.ellipse(0.07 * s, 0.05 * s, 0.13 * s, 0.065 * s, 0.5, 0, TAU);
      ctx.moveTo(0.33 * s, 0.15 * s); ctx.ellipse(0.24 * s, 0.15 * s, 0.09 * s, 0.08 * s, 0.9, 0, TAU);
      ctx.fill();
      if (z > 3) {
        ctx.strokeStyle = '#2a1d14'; ctx.lineWidth = 0.03 * s; ctx.lineCap = 'round';
        ctx.beginPath();
        for (var k = 0; k < 3; k++) {
          var lx = 0.02 * s + k * 0.06 * s;
          ctx.moveTo(lx, 0.02 * s); ctx.quadraticCurveTo(lx + 0.1 * s, -0.22 * s, lx + 0.2 * s, -0.08 * s);
          ctx.moveTo(lx, 0.09 * s); ctx.quadraticCurveTo(lx - 0.02 * s, 0.3 * s, lx + 0.14 * s, 0.24 * s);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  Renderer.prototype.drawFood = function (view) {
    var ctx = this.ctx, foods = this.sim.world.foods, z = this.cam.z, i, k;
    for (i = 0; i < foods.length; i++) {
      var f = foods[i], pad = f.r + 8;
      if (f.x < view.x0 - pad || f.x > view.x1 + pad || f.y < view.y0 - pad || f.y > view.y1 + pad) continue;
      if (f.type === 'sugar') {
        var r = f.r, x = f.x, y = f.y, g;
        g = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 1.35);
        g.addColorStop(0, 'rgba(46,32,18,0.5)'); g.addColorStop(1, 'rgba(46,32,18,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, TAU); ctx.fill();
        g = ctx.createRadialGradient(x - r * 0.28, y - r * 0.32, r * 0.05, x, y, r);
        g.addColorStop(0, 'rgba(255,248,226,0.82)');
        g.addColorStop(0.55, 'rgba(238,204,138,0.62)');
        g.addColorStop(0.92, 'rgba(168,116,52,0.78)');
        g.addColorStop(1, 'rgba(110,72,30,0.85)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,238,196,0.5)'; ctx.lineWidth = Math.max(0.12, r * 0.05); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(x, y, r * 0.86, 0.15 * Math.PI, 0.62 * Math.PI); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.ellipse(x - r * 0.36, y - r * 0.4, r * 0.2, r * 0.11, -0.7, 0, TAU); ctx.fill();
      } else {
        var bits = f.bits, n = bits.length, b;
        if (z < 2.2) {
          ctx.fillStyle = '#e6d2a2';
          for (k = 0; k < n; k++) { b = bits[k]; if (!b.taken) ctx.fillRect(b.x - b.s * 0.7, b.y - b.s * 0.7, b.s * 1.4, b.s * 1.4); }
          continue;
        }
        ctx.fillStyle = 'rgba(22,15,8,0.36)';
        ctx.beginPath();
        for (k = 0; k < n; k++) { b = bits[k]; if (!b.taken) crumbPath(ctx, b.x + b.s * 0.22, b.y + b.s * 0.3, b.s, b.rot); }
        ctx.fill();
        for (var sh = 0; sh < 3; sh++) {
          ctx.fillStyle = CRUMB_COLS[sh];
          ctx.beginPath();
          for (k = 0; k < n; k++) { b = bits[k]; if (!b.taken && ((b.shade * 3) | 0) === sh) crumbPath(ctx, b.x, b.y, b.s, b.rot); }
          ctx.fill();
        }
        if (z > 5) {
          // the lit face of each fragment
          ctx.fillStyle = 'rgba(255,252,240,0.3)';
          ctx.beginPath();
          for (k = 0; k < n; k++) { b = bits[k]; if (!b.taken) crumbPath(ctx, b.x - b.s * 0.14, b.y - b.s * 0.18, b.s * 0.5, b.rot + 1.3); }
          ctx.fill();
        }
      }
    }
  };

  /* A broken, uneven fragment; its outline is fixed by the crumb's own rotation value. */
  function crumbPath(ctx, x, y, s, rot) {
    var n = 6 + ((rot * 7) | 0) % 3;
    for (var k = 0; k < n; k++) {
      var h = Math.sin(rot * 91.7 + k * 78.233) * 43758.5453; h -= Math.floor(h);
      var a = rot + (k + (h - 0.5) * 0.6) * TAU / n, r = s * (0.62 + 0.55 * h);
      if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function rockPath(rock) {
    var p = new Path2D(), pts = rock.pts, n = pts.length / 2, k;
    var mx = (pts[0] + pts[(n - 1) * 2]) / 2, my = (pts[1] + pts[(n - 1) * 2 + 1]) / 2;
    p.moveTo(mx, my);
    for (k = 0; k < n; k++) {
      var x = pts[k * 2], y = pts[k * 2 + 1], nx = pts[((k + 1) % n) * 2], ny = pts[((k + 1) % n) * 2 + 1];
      p.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    p.closePath();
    // a few flecks so the stone is not a flat blob
    var rng = new AH.Rng(rock.seed), spots = [];
    for (k = 0; k < 16 + rock.r * 0.8; k++) {
      var a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * rock.r * 0.8;
      spots.push(Math.cos(a) * d, Math.sin(a) * d, rng.range(0.3, 1.4) * (0.6 + rock.r / 40), rng.next());
    }
    rock._spots = spots;
    return p;
  }

  var ROCK_TONES = [[150, 146, 138], [166, 150, 126], [118, 112, 108], [142, 128, 112]];

  Renderer.prototype.drawRocks = function (view, Z, ox, oy) {
    var ctx = this.ctx, rocks = this.sim.world.rocks;
    for (var i = 0; i < rocks.length; i++) {
      var rk = rocks[i], pad = rk.r * 1.4 + 6;
      if (rk.x < view.x0 - pad || rk.x > view.x1 + pad || rk.y < view.y0 - pad || rk.y > view.y1 + pad) continue;
      var path = rk._path || (rk._path = rockPath(rk));
      var r = rk.r, X = ox + rk.x * Z, Y = oy + rk.y * Z;
      var sx = (0.05 * r + 1.0) * Z, sy = (0.08 * r + 1.4) * Z;
      ctx.setTransform(Z * 1.05, 0, 0, Z * 1.05, X + sx * 1.2, Y + sy * 1.2);
      ctx.fillStyle = 'rgba(16,11,6,0.16)'; ctx.fill(path);
      ctx.setTransform(Z, 0, 0, Z, X + sx, Y + sy);
      ctx.fillStyle = 'rgba(16,11,6,0.3)'; ctx.fill(path);

      ctx.setTransform(Z, 0, 0, Z, X, Y);
      var t = ROCK_TONES[(rk.tone * ROCK_TONES.length) | 0] || ROCK_TONES[0];
      var g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, 'rgb(' + (t[0] + 34) + ',' + (t[1] + 32) + ',' + (t[2] + 28) + ')');
      g.addColorStop(0.5, 'rgb(' + t[0] + ',' + t[1] + ',' + t[2] + ')');
      g.addColorStop(1, 'rgb(' + (t[0] - 50) + ',' + (t[1] - 50) + ',' + (t[2] - 48) + ')');
      ctx.fillStyle = g; ctx.fill(path);
      ctx.save();
      ctx.clip(path);
      var sp = rk._spots;
      for (var k = 0; k < sp.length; k += 4) {
        ctx.fillStyle = sp[k + 3] < 0.5 ? 'rgba(40,36,32,0.16)' : 'rgba(250,246,238,0.14)';
        ctx.beginPath(); ctx.arc(sp[k], sp[k + 1], sp[k + 2], 0, TAU); ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(28,20,12,0.5)'; ctx.lineWidth = 0.3; ctx.stroke(path);
      // the lit upper face
      ctx.setTransform(Z * 0.7, 0, 0, Z * 0.7, X - 0.1 * r * Z, Y - 0.13 * r * Z);
      ctx.fillStyle = 'rgba(255,250,238,0.1)'; ctx.fill(path);
    }
    ctx.setTransform(Z, 0, 0, Z, ox, oy);
  };

  /* ---------- ants ---------- */

  Renderer.prototype.drawAnts = function (Z, ox, oy) {
    var col = this.sim.colony, vis = this.vis, n = 0, W = this.W, H = this.H;
    var m = 6 * Z, i, cnt = col.count;
    for (i = 0; i < cnt; i++) {
      if (!col.alive[i] || col.state[i] === S.IN_NEST) continue;
      var X = col.x[i] * Z + ox, Y = col.y[i] * Z + oy;
      if (X < -m || X > W + m || Y < -m || Y > H + m) continue;
      vis[n++] = i;
    }
    this.visCount = n;
    var z = this.cam.z;
    if (z < LOD_MID) this.drawAntsFar(n, Z, ox, oy);
    else if (z < LOD_FULL) this.drawAntsMid(n, Z, ox, oy, z);
    else {
      for (var k = 0; k < n; k++) {
        i = vis[k];
        this.drawAntFull(i, col.x[i] * Z + ox, col.y[i] * Z + oy, Z);
      }
      this.ctx.globalAlpha = 1;
    }
  };

  Renderer.prototype.drawAntsFar = function (n, Z, ox, oy) {
    var ctx = this.ctx, col = this.sim.colony, vis = this.vis, k, i;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineCap = 'round';
    ctx.strokeStyle = BODY;
    ctx.lineWidth = Math.max(1.3 * this.dpr, 1.1 * Z);
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = vis[k];
      var X = col.x[i] * Z + ox, Y = col.y[i] * Z + oy, hl = 0.36 * col.size[i] * Z, th = col.th[i];
      var c = Math.cos(th) * hl, s = Math.sin(th) * hl;
      ctx.moveTo(X - c, Y - s); ctx.lineTo(X + c, Y + s);
    }
    ctx.stroke();
    // a pale speck where an ant is carrying something solid
    ctx.fillStyle = '#ecdcb0';
    var d = Math.max(1.4 * this.dpr, 0.9 * Z);
    for (k = 0; k < n; k++) {
      i = vis[k];
      if (col.carry[i] !== CARRY.CRUMB) continue;
      var th2 = col.th[i], hl2 = 0.5 * col.size[i] * Z;
      ctx.fillRect(col.x[i] * Z + ox + Math.cos(th2) * hl2 - d / 2, col.y[i] * Z + oy + Math.sin(th2) * hl2 - d / 2, d, d);
    }
  };

  Renderer.prototype.drawAntsMid = function (n, Z, ox, oy, z) {
    var ctx = this.ctx, col = this.sim.colony, vis = this.vis, F = this.feet, K = this.knees;
    var k, i, q, X, Y, L, th, c, s, an, t = this.clock;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = vis[k]; th = col.th[i]; L = col.size[i] * Z * animScale(col, i);
      X = col.x[i] * Z + ox + 0.07 * L; Y = col.y[i] * Z + oy + 0.09 * L;
      ctx.moveTo(X + Math.cos(th) * 0.47 * L, Y + Math.sin(th) * 0.47 * L);
      ctx.ellipse(X, Y, 0.47 * L, 0.13 * L, th, 0, TAU);
    }
    ctx.fill();

    if (z >= 2.3) {
      ctx.strokeStyle = LEG; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(0.7 * this.dpr, 0.13 * Z);
      ctx.beginPath();
      for (k = 0; k < n; k++) {
        i = vis[k]; th = col.th[i]; c = Math.cos(th); s = Math.sin(th);
        an = animScale(col, i); L = col.size[i];
        X = col.x[i] * Z + ox; Y = col.y[i] * Z + oy;
        var zs = Z * an;
        this.feetAnalytic(L, col.odo[i]);
        this.solveKnees(L);
        for (q = 0; q < 6; q++) {
          var hx = HIP[q * 2] * L, hy = HIP[q * 2 + 1] * L;
          ctx.moveTo(X + (c * hx - s * hy) * zs, Y + (s * hx + c * hy) * zs);
          ctx.lineTo(X + (c * K[q * 2] - s * K[q * 2 + 1]) * zs, Y + (s * K[q * 2] + c * K[q * 2 + 1]) * zs);
          ctx.lineTo(X + (c * F[q * 2] - s * F[q * 2 + 1]) * zs, Y + (s * F[q * 2] + c * F[q * 2 + 1]) * zs);
        }
        // antennae
        var ph = col.uid[i] * 2.399, sw = Math.sin(t * 8 + ph) * 0.12;
        for (q = -1; q <= 1; q += 2) {
          var a1 = q * (1.05 + sw * q), a2 = q * (0.35 - sw);
          var bx = 0.43 * L, by = q * 0.05 * L;
          var ex = bx + Math.cos(a1) * 0.24 * L, ey = by + Math.sin(a1) * 0.24 * L;
          var tx = ex + Math.cos(a2) * 0.33 * L, ty = ey + Math.sin(a2) * 0.33 * L;
          ctx.moveTo(X + (c * bx - s * by) * zs, Y + (s * bx + c * by) * zs);
          ctx.lineTo(X + (c * ex - s * ey) * zs, Y + (s * ex + c * ey) * zs);
          ctx.lineTo(X + (c * tx - s * ty) * zs, Y + (s * tx + c * ty) * zs);
        }
      }
      ctx.stroke();
    }

    ctx.fillStyle = BODY;
    ctx.beginPath();
    for (k = 0; k < n; k++) {
      i = vis[k]; th = col.th[i]; c = Math.cos(th); s = Math.sin(th);
      L = col.size[i] * Z * animScale(col, i);
      X = col.x[i] * Z + ox; Y = col.y[i] * Z + oy;
      var gs = 1 + 0.26 * sugarLoad(col, i);
      var gx = X - c * (0.035 + 0.235 * gs) * L, gy = Y - s * (0.035 + 0.235 * gs) * L;
      ctx.moveTo(gx + c * 0.225 * gs * L, gy + s * 0.225 * gs * L);
      ctx.ellipse(gx, gy, 0.225 * gs * L, 0.14 * (0.8 + 0.2 * gs) * L, th, 0, TAU);
      var tx2 = X + c * 0.115 * L, ty2 = Y + s * 0.115 * L;
      ctx.moveTo(tx2 + c * 0.15 * L, ty2 + s * 0.15 * L);
      ctx.ellipse(tx2, ty2, 0.15 * L, 0.072 * L, th, 0, TAU);
      var hx2 = X + c * 0.36 * L, hy2 = Y + s * 0.36 * L;
      ctx.moveTo(hx2 + c * 0.11 * L, hy2 + s * 0.11 * L);
      ctx.ellipse(hx2, hy2, 0.11 * L, 0.104 * L, th, 0, TAU);
    }
    ctx.fill();

    for (k = 0; k < n; k++) {
      i = vis[k];
      var cr = col.carry[i];
      if (cr < CARRY.CRUMB) continue;
      th = col.th[i]; L = col.size[i] * Z;
      X = col.x[i] * Z + ox + Math.cos(th) * 0.55 * L; Y = col.y[i] * Z + oy + Math.sin(th) * 0.55 * L;
      ctx.fillStyle = cr === CARRY.CRUMB ? '#ecdcb0' : cr === CARRY.SOIL ? '#b0946c' : '#120d0a';
      ctx.beginPath();
      ctx.arc(X, Y, (cr === CARRY.CORPSE ? 0.2 : 0.11) * L, 0, TAU);
      ctx.fill();
    }
  };

  function animScale(col, i) {
    var st = col.state[i];
    if (st !== S.EMERGE && st !== S.ENTER) return 1;
    var a = col.anim[i];
    return 0.45 + 0.55 * (a < 0 ? 0 : a > 1 ? 1 : a);
  }

  function sugarLoad(col, i) {
    if (col.carry[i] === CARRY.SUGAR || (col.state[i] === S.FEED && col.ftype[i] === 1)) {
      var l = col.load[i];
      return l > 1 ? 1 : l;
    }
    return 0;
  }

  Renderer.prototype.drawAntFull = function (i, X, Y, Z) {
    var ctx = this.ctx, col = this.sim.colony;
    var st = col.state[i], L = col.size[i], th = col.th[i];
    var c = Math.cos(th), s = Math.sin(th);
    var an = 1;
    if (st === S.EMERGE || st === S.ENTER) { an = col.anim[i]; an = an < 0 ? 0 : an > 1 ? 1 : an; }
    var sc = Z * (0.45 + 0.55 * an);
    var load = sugarLoad(col, i), gs = 1 + 0.26 * load;
    var agit = col.agit[i] > 0, carry = col.carry[i];
    var still = col.pause[i] > 0 || st === S.FEED;
    var flex = col.om[i] * 0.05; if (flex > 0.3) flex = 0.3; else if (flex < -0.3) flex = -0.3;
    var headA = flex * 0.9, gasA = -flex * 0.8, look = 0, looking = col.lookT[i] > 0;
    if (looking) { look = col.look[i]; if (look > 0.7) look = 0.7; else if (look < -0.7) look = -0.7; headA += look * 0.5; }

    var nkx = 0.255 * L, ptx = -0.035 * L;
    var hc = Math.cos(headA), hs = Math.sin(headA), gc = Math.cos(gasA), gn = Math.sin(gasA);
    var hdx = nkx + hc * 0.105 * L, hdy = hs * 0.105 * L;
    var grx = 0.225 * L * gs * (agit ? 0.9 : 1), gry = 0.14 * L * (0.82 + 0.18 * gs);
    var gax = ptx - gc * (0.01 * L + grx), gay = -gn * (0.01 * L + grx);

    if (an < 1) this.feetAnalytic(L, col.odo[i]);
    else this.feetPlanted(i, col.x[i], col.y[i], c, s, L, col.odo[i]);
    this.solveKnees(L);
    var F = this.feet, K = this.knees, k, hx, hy;

    // shadow on the ground, offset away from the light
    ctx.setTransform(sc * c, sc * s, -sc * s, sc * c, X + 0.07 * L * Z, Y + 0.09 * L * Z);
    ctx.globalAlpha = 0.24 * an;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(gax, gay, grx, gry, gasA, 0, TAU);
    ctx.moveTo(0.265 * L, 0); ctx.ellipse(0.115 * L, 0, 0.15 * L, 0.075 * L, 0, 0, TAU);
    ctx.moveTo(hdx + 0.11 * L, hdy); ctx.ellipse(hdx, hdy, 0.11 * L, 0.104 * L, headA, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 0.035 * L; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.16 * an;
    ctx.beginPath();
    for (k = 0; k < 6; k++) {
      ctx.moveTo(HIP[k * 2] * L, HIP[k * 2 + 1] * L); ctx.lineTo(K[k * 2], K[k * 2 + 1]); ctx.lineTo(F[k * 2], F[k * 2 + 1]);
    }
    ctx.stroke();

    ctx.setTransform(sc * c, sc * s, -sc * s, sc * c, X, Y);
    ctx.globalAlpha = an;

    // legs: femur, tibia, tarsus, each thinner than the last
    ctx.strokeStyle = LEG;
    ctx.lineWidth = 0.05 * L;
    ctx.beginPath();
    for (k = 0; k < 6; k++) { ctx.moveTo(HIP[k * 2] * L, HIP[k * 2 + 1] * L); ctx.lineTo(K[k * 2], K[k * 2 + 1]); }
    ctx.stroke();
    ctx.lineWidth = 0.034 * L;
    ctx.beginPath();
    for (k = 0; k < 6; k++) {
      ctx.moveTo(K[k * 2], K[k * 2 + 1]);
      ctx.lineTo(K[k * 2] + (F[k * 2] - K[k * 2]) * 0.6, K[k * 2 + 1] + (F[k * 2 + 1] - K[k * 2 + 1]) * 0.6);
    }
    ctx.stroke();
    ctx.lineWidth = 0.021 * L;
    ctx.beginPath();
    for (k = 0; k < 6; k++) {
      ctx.moveTo(K[k * 2] + (F[k * 2] - K[k * 2]) * 0.6, K[k * 2 + 1] + (F[k * 2 + 1] - K[k * 2 + 1]) * 0.6);
      ctx.lineTo(F[k * 2], F[k * 2 + 1]);
    }
    ctx.stroke();

    // antennae: elbowed, sweeping the ground ahead
    var t = this.clock, ph = col.uid[i] * 2.399;
    var f1 = still ? 4.5 : 9, A1 = still ? 0.16 : 0.07, A2 = still ? 0.36 : 0.16;
    ctx.lineWidth = 0.026 * L;
    ctx.beginPath();
    for (var q = -1; q <= 1; q += 2) {
      var a1 = headA + q * (1.05 + A1 * Math.sin(t * f1 + ph + q * 0.8));
      var a2 = headA + q * (0.35 + A2 * Math.sin(t * f1 * 1.3 + ph * 1.7 + q * 1.9));
      if (looking) a2 = headA + q * 0.06 + look * 0.6;
      var bx = hdx + hc * 0.07 * L - hs * q * 0.055 * L, by = hdy + hs * 0.07 * L + hc * q * 0.055 * L;
      var ex = bx + Math.cos(a1) * 0.24 * L, ey = by + Math.sin(a1) * 0.24 * L;
      ctx.moveTo(bx, by); ctx.lineTo(ex, ey);
      ctx.lineTo(ex + Math.cos(a2) * 0.33 * L, ey + Math.sin(a2) * 0.33 * L);
    }
    ctx.stroke();

    // mandibles
    var open = (agit || carry >= CARRY.CRUMB) ? 0.05 : 0.014;
    ctx.strokeStyle = '#3b2616'; ctx.lineWidth = 0.032 * L;
    ctx.beginPath();
    for (q = -1; q <= 1; q += 2) {
      var m0x = 0.075 * L, m0y = q * 0.045 * L, m1x = 0.15 * L, m1y = q * open * L;
      ctx.moveTo(hdx + hc * m0x - hs * m0y, hdy + hs * m0x + hc * m0y);
      ctx.lineTo(hdx + hc * m1x - hs * m1y, hdy + hs * m1x + hc * m1y);
    }
    ctx.stroke();

    // body: mesosoma, petiole, neck
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(0.165 * L, 0, 0.095 * L, 0.078 * L, 0, 0, TAU);
    ctx.moveTo(0.14 * L, 0); ctx.ellipse(0.05 * L, 0, 0.09 * L, 0.058 * L, 0, 0, TAU);
    ctx.moveTo(ptx + 0.034 * L, 0); ctx.ellipse(ptx, 0, 0.034 * L, 0.042 * L, 0, 0, TAU);
    ctx.moveTo(0.295 * L, 0); ctx.ellipse(0.265 * L, 0, 0.03 * L, 0.036 * L, 0, 0, TAU);
    ctx.fill();

    // gaster, with the pale bands between its plates (they stretch when the crop is full)
    ctx.fillStyle = GASTER;
    ctx.beginPath(); ctx.ellipse(gax, gay, grx, gry, gasA, 0, TAU); ctx.fill();
    ctx.strokeStyle = load > 0.05 ? 'rgba(198,160,110,' + (0.26 + 0.24 * load) + ')' : 'rgba(150,128,104,0.3)';
    ctx.lineWidth = (0.014 + 0.016 * load) * L;
    ctx.beginPath();
    for (k = 0; k < 3; k++) {
      var u = -0.5 + k * 0.42, w = gry * Math.sqrt(1 - u * u) * 0.94, ux = u * grx, cxo = ux - 0.05 * L;
      ctx.moveTo(gax + gc * ux + gn * w, gay + gn * ux - gc * w);
      ctx.quadraticCurveTo(gax + gc * cxo, gay + gn * cxo, gax + gc * ux - gn * w, gay + gn * ux + gc * w);
    }
    ctx.stroke();

    // head
    ctx.fillStyle = BODY;
    ctx.beginPath(); ctx.ellipse(hdx, hdy, 0.11 * L, 0.104 * L, headA, 0, TAU); ctx.fill();

    // sheen from the sky, fixed in the world rather than on the ant
    var lx = -0.55 * c - 0.83 * s, ly = 0.55 * s - 0.83 * c;
    ctx.fillStyle = 'rgba(255,238,214,0.14)';
    ctx.beginPath();
    ctx.ellipse(gax + lx * gry * 0.36, gay + ly * gry * 0.36, grx * 0.56, gry * 0.42, gasA, 0, TAU);
    ctx.moveTo(0.21 * L, 0); ctx.ellipse(0.125 * L + lx * 0.02 * L, ly * 0.024 * L, 0.085 * L, 0.03 * L, 0, 0, TAU);
    ctx.moveTo(hdx + 0.05 * L, hdy); ctx.ellipse(hdx + lx * 0.03 * L, hdy + ly * 0.03 * L, 0.05 * L, 0.045 * L, headA, 0, TAU);
    ctx.fill();

    // what it is carrying in its jaws
    if (carry >= CARRY.CRUMB) {
      var mx = hdx + hc * 0.2 * L, my = hdy + hs * 0.2 * L;
      if (carry === CARRY.CRUMB) {
        ctx.fillStyle = CRUMB_COLS[col.uid[i] % 3];
        ctx.beginPath(); crumbPath(ctx, mx, my, 0.13 * L, ph); ctx.fill();
      } else if (carry === CARRY.SOIL) {
        ctx.fillStyle = AH.pelletColor((col.uid[i] % 4) / 4);
        ctx.beginPath(); ctx.arc(mx - 0.02 * L, my, 0.1 * L, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = '#120d0a';
        ctx.beginPath();
        ctx.ellipse(mx + 0.2 * L, my - 0.03 * L, 0.2 * L, 0.11 * L, 0.5, 0, TAU);
        ctx.moveTo(mx + 0.12 * L, my + 0.06 * L); ctx.ellipse(mx + 0.02 * L, my + 0.06 * L, 0.1 * L, 0.06 * L, 0.9, 0, TAU);
        ctx.fill();
      }
    }

    // in the pheromone view, show the dab as it is laid
    if (this.showTrail && col.marking[i] > 0) {
      ctx.fillStyle = 'rgba(170,244,255,' + Math.min(1, col.marking[i] * 4) + ')';
      ctx.beginPath(); ctx.arc(gax - gc * grx, gay - gn * grx, 0.07 * L, 0, TAU); ctx.fill();
    }
  };

  /* A tap on the ground: two rings spreading out and fading. */
  Renderer.prototype.drawRipples = function (dt, Z, ox, oy) {
    var ctx = this.ctx, rs = this.ripples, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (var i = rs.length - 1; i >= 0; i--) {
      var r = rs[i];
      r.t += dt;
      if (r.t > 0.7) { rs.splice(i, 1); continue; }
      var k = r.t / 0.7;
      ctx.strokeStyle = 'rgba(255,246,222,' + (0.7 * (1 - k)) + ')';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(r.x * Z + ox, r.y * Z + oy, (3 + 24 * k) * Z, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(r.x * Z + ox, r.y * Z + oy, (1 + 12 * k) * Z, 0, TAU); ctx.stroke();
    }
  };

  /* ---------- the selected ant ---------- */

  Renderer.prototype.drawSelection = function (i, Z, ox, oy) {
    var ctx = this.ctx, col = this.sim.colony, dpr = this.dpr;
    var x = col.x[i], y = col.y[i], L = col.size[i], th = col.th[i];
    var c = Math.cos(th), s = Math.sin(th), A = C.ant;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    var X = x * Z + ox, Y = y * Z + oy;
    ctx.strokeStyle = 'rgba(255,246,222,0.92)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(X, Y, Math.max(9 * dpr, 0.85 * L * Z), 0, TAU); ctx.stroke();
    if (!this.showSense) return;

    // where it believes the nest is: its own position minus its path-integration estimate
    var hx = (x - col.pix[i]) * Z + ox, hy = (y - col.piy[i]) * Z + oy;
    ctx.setLineDash([5 * dpr, 5 * dpr]);
    ctx.strokeStyle = 'rgba(255,246,222,0.6)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,246,222,0.95)';
    ctx.beginPath(); ctx.arc(hx, hy, 5 * dpr, 0, TAU); ctx.stroke();
    this.label('where it thinks home is', hx, hy - 10 * dpr, 'rgba(255,246,222,0.95)');

    if (col.memQ[i] > 0) {
      var fx = (x - col.pix[i] + col.memX[i]) * Z + ox, fy = (y - col.piy[i] + col.memY[i]) * Z + oy;
      ctx.strokeStyle = 'rgba(240,190,96,0.95)';
      ctx.beginPath();
      ctx.moveTo(fx - 5 * dpr, fy); ctx.lineTo(fx + 5 * dpr, fy); ctx.moveTo(fx, fy - 5 * dpr); ctx.lineTo(fx, fy + 5 * dpr);
      ctx.stroke();
      this.label('food it remembers', fx, fy - 10 * dpr, 'rgba(240,190,96,0.95)');
    }

    // the three points its antennae are sampling, brighter where they smell trail
    if (this.cam.z >= 3) {
      var ah = L * A.senseAhead, al = L * A.senseSide;
      var pts = [ah, al, col.sL[i], ah * 1.1, 0, col.sC[i], ah, -al, col.sR[i]];
      for (var k = 0; k < 9; k += 3) {
        var wx = x + c * pts[k] - s * pts[k + 1], wy = y + s * pts[k] + c * pts[k + 1];
        var v = pts[k + 2], a = v / (v + 1.2);
        ctx.fillStyle = 'rgba(150,240,255,' + (0.18 + 0.8 * a) + ')';
        ctx.beginPath(); ctx.arc(wx * Z + ox, wy * Z + oy, Math.max(2.2 * dpr, 0.28 * Z), 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(10,20,26,0.7)'; ctx.lineWidth = dpr;
        ctx.stroke();
      }
    }
  };

  Renderer.prototype.label = function (text, x, y, color) {
    var ctx = this.ctx, dpr = this.dpr;
    ctx.font = (12 * dpr) + 'px "Instrument Sans", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(16,12,8,0.8)'; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };

  AH.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);

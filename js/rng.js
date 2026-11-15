/* Seeded random numbers, so a run can be repeated exactly. */
(function (root) {
  'use strict';
  var AH = root.AH = root.AH || {};

  function Rng(seed) {
    this.s = (seed >>> 0) || 1;
    this.spare = null;
  }

  // mulberry32
  Rng.prototype.next = function () {
    var t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  Rng.prototype.int = function (n) { return (this.next() * n) | 0; };

  Rng.prototype.gauss = function () {
    if (this.spare !== null) { var s = this.spare; this.spare = null; return s; }
    var u = this.next(), v = this.next();
    if (u < 1e-12) u = 1e-12;
    var r = Math.sqrt(-2 * Math.log(u)), a = 6.283185307179586 * v;
    this.spare = r * Math.sin(a);
    return r * Math.cos(a);
  };

  AH.Rng = Rng;

  AH.wrapAngle = function (a) {
    while (a > Math.PI) a -= 6.283185307179586;
    while (a < -Math.PI) a += 6.283185307179586;
    return a;
  };
})(typeof window !== 'undefined' ? window : globalThis);

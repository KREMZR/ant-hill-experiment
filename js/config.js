/*
 * Ant hill simulation: model parameters.
 *
 * Units everywhere: millimetres, seconds, radians.
 * Reference species: Lasius niger (black garden ant), the species most of the
 * trail-foraging literature is based on. Values marked "lit." follow published
 * measurements (rounded); values marked "tuned" were chosen so the model
 * reproduces the published colony-level behaviour.
 */
(function (root) {
  'use strict';
  var AH = root.AH = root.AH || {};

  AH.CONFIG = {
    seed: 7,
    maxAgents: 8000,

    world: {
      w: 1400, h: 900,      // a 1.4 m x 0.9 m patch of ground
      cell: 2,              // pheromone / obstacle grid resolution
      foodCell: 4,
      alarmCell: 10,
      hashCell: 6,
      margin: 3
    },

    nest: {
      fx: 0.47, fy: 0.52,   // position as a fraction of the world
      entranceR: 3.0,       // entrance hole radius
      recogR: 40,           // range at which the mound and nest odour are recognised
      moundR: 30,
      middenDist: 150       // refuse pile distance from the entrance
    },

    colony: {
      workers: 1200,
      foragerFrac: 0.3,     // lit.: only the oldest ~10-30% of workers forage
      lifeAccel: 300,       // colony life cycle runs this much faster than behaviour
      storePerWorker: 0.5,  // food reserve the colony aims for (loads per worker)
      startStore: 0.25,     // fraction of that target present at the start
      consumption: 0.012,   // loads per worker per colony-day (tuned)
      eggRate: 10,          // eggs per colony-day when well fed (tuned)
      devDays: 55,          // lit.: egg to adult takes roughly 8 weeks
      broodCost: 2,         // loads needed to raise one worker (tuned)
      broodReserve: 0.15,   // brood is only raised while this share of the target is in store
      lifespanDays: 400,    // lit.: workers live about 1-2 years
      soilRate: 0.05,       // excavation trips per second (tuned)
      scoutRate: 1 / 5000,  // per idle forager per second (tuned: ~5-10% scouting)
      recruitPerTrip: 2.2,  // nestmates stirred into leaving by one good load
      recruitLag: 20,       // seconds for recruits to get out of the nest
      exciteDecay: 150,
      unload: [25, 70],     // seconds spent passing food to nestmates
      rest: [60, 240],
      returnProb: 0.9       // lit.: foragers reliably go back to a site that paid off
    },

    ant: {
      length: 4.0, lengthSd: 0.3,   // lit.: workers 3-5 mm
      speed: 18, speedSd: 2.0,      // lit.: roughly 1-3 cm/s at room temperature
      accel: 90, decel: 160,
      maxTurn: 6,
      goalGain: 2.6,
      avoidTurn: 5,
      senseAhead: 0.9,              // where the antenna tips touch down, in body lengths
      senseSide: 0.42,
      wanderTau: 0.6,
      wanderScout: 1.15,            // rad/s; sets how winding a search path is
      wanderTrail: 0.3,
      wanderCast: 1.7,
      wanderHome: 0.35,
      wanderSearch: 2.0,
      tripTime: [420, 1100],        // how long a scout searches before heading home
      piBiasSd: 0.035,              // lit.: path integration is good to a few percent
      piOdoSd: 0.03,
      drinkTime: [40, 85],          // lit.: a crop load of sugar water takes ~1 min
      handleTime: [2, 5],
      emergeTime: 0.8, enterTime: 0.6, emergeSpeed: 5,
      personalSpace: 2.4,
      contactRange: 0.9,
      contactPHead: 0.55,           // chance a head-on meeting becomes an antennal check
      contactPSame: 0.12,
      memGiveUp: 2,                 // empty visits before a remembered site is dropped
      avoidTime: 2400,              // how long an ant steers clear of a spot that disappointed it
      avoidRange: 70
    },

    trail: {
      lifetime: 47 * 60,    // lit.: L. niger trail pheromone, mean lifetime ~47 min
      markSpacing: 3,
      markAmount: 3,
      max: 14,
      crowdHalf: 5,         // lit.: ants mark less on an already strong trail
      spread: 0.014,         // how fast a trail's scent spreads sideways (tuned)
      senseSat: 4,          // antennae saturate: very strong trails are not much more attractive
      halfResponse: 2.0,
      gain: 6.5,
      joinThreshold: 0.35,
      joinRate: 3,
      lostThreshold: 0.2,
      lostTime: 5,
      layBase: 0.25,        // lit.: share of ants that mark rises with food quality
      layQuality: 0.65,
      outboundLay: 0.4,     // lit.: ants also mark, more weakly, on the way back out
      hubRadius: 14,
      hubSamples: 24,
      choiceK: 0.6,         // Deneubourg choice function: (k + c)^n
      choiceN: 2
    },

    alarm: {
      lifetime: 14,         // lit.: alarm signals fade within tens of seconds
      diffusion: 0.18,
      threshold: 0.25,
      pokeAmount: 4,
      pokeRadius: 26
    },

    food: {
      sugarDetect: 2,       // found essentially by touch
      crumbDetect: 5,       // solid food gives off a little odour
      spawnEvery: [300, 700],
      maxNatural: 4
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

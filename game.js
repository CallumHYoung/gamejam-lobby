// The Lobby — a 3D portal hub for Ordinary Game Jam #1.
//
// - Three.js world with a ring of portals, one per entry in the jam
//   registry (games.json). Walk into a portal to travel.
// - Trystero P2P for presence (see other players in the lobby) and
//   text chat (speech bubbles above avatars + HTML chat log).
// - Cute procedural bean avatars with idle + walking animations.
// - Persistent display name via localStorage; rename with N key or
//   the pencil button in the HUD.
//
// Runs fully in the browser, no backend, no build step.

import * as THREE from 'https://esm.sh/three@0.160.1';

// ------------------------------------------------------------------
// Portal protocol intake + name resolution
// ------------------------------------------------------------------

const incoming = Portal.readPortalParams();

// Priority: portal arrival URL > localStorage > other URL param > guest
const urlName = new URLSearchParams(location.search).get('username');
let username = incoming.username;
let firstVisit = false;
try {
  const saved = localStorage.getItem('lobby:username');
  if (incoming.fromPortal && urlName) {
    username = urlName;
  } else if (saved) {
    username = saved;
  } else if (!urlName) {
    firstVisit = true;
  }
} catch {}

document.getElementById('username-text').textContent = username;

// ------------------------------------------------------------------
// Three.js scene
// ------------------------------------------------------------------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0514');
scene.fog = new THREE.Fog('#0a0514', 45, 170);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 0.7);
sunLight.position.set(8, 20, 10);
scene.add(sunLight);
const accentLight = new THREE.PointLight(0xc64bff, 1.4, 60);
accentLight.position.set(0, 10, 0);
scene.add(accentLight);
const fillLight = new THREE.PointLight(0x4ff0ff, 0.8, 50);
fillLight.position.set(0, 3, -18);
scene.add(fillLight);

// ------------------------------------------------------------------
// Day / night cycle + skybox + stars
// ------------------------------------------------------------------

const CYCLE_LENGTH = 15 * 60;  // 15 min total
const DAY_LENGTH   = 10 * 60;  // 10 min of day
const TRANSITION   = 60;       // 1 min dawn / 1 min dusk

const DAY_ZENITH   = new THREE.Color('#3f7cd8');
const DAY_HORIZON  = new THREE.Color('#cfe3ff');
const NIGHT_ZENITH = new THREE.Color('#040616');
const NIGHT_HORIZON = new THREE.Color('#100a30');

const DAY_FOG      = new THREE.Color('#9cb3d8');
const NIGHT_FOG    = new THREE.Color('#0a0820');

const DAY_BG       = new THREE.Color('#cfe3ff');
const NIGHT_BG     = new THREE.Color('#040616');

const DAY_AMBIENT_COLOR   = new THREE.Color('#ffffff');
const NIGHT_AMBIENT_COLOR = new THREE.Color('#6880b8');

const DAY_SUN_COLOR   = new THREE.Color('#fff8e0');
const NIGHT_SUN_COLOR = new THREE.Color('#4a60a0');

// Skybox — large inverted sphere with a gradient shader. Ignores fog
// (the ShaderMaterial has no fog uniforms) so it stays visible even
// at the far plane of scene.fog.
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    uTopColor:    { value: new THREE.Color('#3f7cd8') },
    uBottomColor: { value: new THREE.Color('#cfe3ff') },
  },
  vertexShader: `
    varying vec3 vWorldPos;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform vec3 uTopColor;
    uniform vec3 uBottomColor;
    varying vec3 vWorldPos;
    void main() {
      float h = normalize(vWorldPos).y;
      float t = smoothstep(-0.15, 0.45, h);
      gl_FragColor = vec4(mix(uBottomColor, uTopColor, t), 1.0);
    }
  `,
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 20), skyMat);
sky.renderOrder = -1;
scene.add(sky);

// Stars — hidden during the day, revealed at night.
const stars = (() => {
  const starCount = 420;
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.85 + 0.05); // upper-ish hemisphere
    const r = 300;
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.6,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const pts = new THREE.Points(geom, mat);
  pts.renderOrder = 0;
  scene.add(pts);
  return pts;
})();

const streetLamps = [];

function getDayFactor(nowSec) {
  const t = nowSec % CYCLE_LENGTH;
  const duskStart  = DAY_LENGTH - TRANSITION;
  const nightStart = DAY_LENGTH;
  const dawnStart  = CYCLE_LENGTH - TRANSITION;
  if (t < duskStart)  return 1;
  if (t < nightStart) return 1 - (t - duskStart) / TRANSITION;
  if (t < dawnStart)  return 0;
  return (t - dawnStart) / TRANSITION;
}

function updateDayNight(nowSec) {
  const d = getDayFactor(nowSec);
  const n = 1 - d;

  skyMat.uniforms.uTopColor.value.lerpColors(NIGHT_ZENITH, DAY_ZENITH, d);
  skyMat.uniforms.uBottomColor.value.lerpColors(NIGHT_HORIZON, DAY_HORIZON, d);

  scene.background.lerpColors(NIGHT_BG, DAY_BG, d);
  scene.fog.color.lerpColors(NIGHT_FOG, DAY_FOG, d);

  ambientLight.intensity = 0.15 + d * 0.3;
  ambientLight.color.lerpColors(NIGHT_AMBIENT_COLOR, DAY_AMBIENT_COLOR, d);

  sunLight.intensity = d * 0.85 + n * 0.12;
  sunLight.color.lerpColors(NIGHT_SUN_COLOR, DAY_SUN_COLOR, d);

  stars.material.opacity = Math.pow(n, 1.6);

  for (const lamp of streetLamps) {
    lamp.light.intensity = n * 2.0;
    lamp.light.visible = n > 0.02;
    lamp.bulbMat.emissiveIntensity = 0.08 + n * 1.1;
  }
  for (const sky of skyscrapers) {
    sky.mat.emissiveIntensity = 0.08 + n * 1.4;
  }
}

// Floor
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(26, 64),
  new THREE.MeshStandardMaterial({ color: 0x180c2e, roughness: 0.75, metalness: 0.2 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Grid overlay
const grid = new THREE.GridHelper(60, 60, 0xc64bff, 0x3c1866);
grid.position.y = 0.02;
grid.material.transparent = true;
grid.material.opacity = 0.25;
scene.add(grid);

// Multi-story portal atrium — square 48x48 with three walkable floors,
// central open atrium, doorways at each cardinal direction, and stair
// runs at NE + SW corners. Floors and walls are added to
// parkourPlatforms so they reuse the existing AABB collision +
// one-way support logic. Portals can spawn on any floor (see
// setupPortals).
//
// Hoisted up here so the building block below (which references it)
// doesn't TDZ-error at module evaluation. The actual parkour spiral
// pushes onto the same array further down.
const parkourPlatforms = [];
const ladders = []; // { x, z, baseY, topY, faceX, faceZ, range }
const BUILDING_HALF = 24;
const FLOOR_Y = [0, 5, 10];
const BUILDING_ROOF = 14;
const BUILDING_DOOR_HALF = 3;
const BUILDING_DOOR_TOP = 4;
const BUILDING_STRIP_DEPTH = 7;
const BUILDING_WALL_T = 0.4;

{
  // Cool teal/cyan palette so the building reads distinct from the
  // emissive purple parkour spiral nearby.
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x0d1b2e, emissive: 0x1d4a7a, emissiveIntensity: 0.18,
    roughness: 0.7, metalness: 0.3,
  });
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x142a45, emissive: 0x4ff0ff, emissiveIntensity: 0.55,
    roughness: 0.5,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x102338, emissive: 0x1d4a7a, emissiveIntensity: 0.25,
    roughness: 0.6, metalness: 0.25,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x1d4a7a, emissive: 0x4ff0ff, emissiveIntensity: 0.45,
    roughness: 0.45,
  });
  const stairMat = new THREE.MeshStandardMaterial({
    color: 0x163755, emissive: 0x4ff0ff, emissiveIntensity: 0.22,
    roughness: 0.55,
  });

  function addWallSegment(cx, y, cz, sx, sy, sz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx * 2, sy * 2, sz * 2), wallMat);
    m.position.set(cx, y, cz);
    scene.add(m);
    parkourPlatforms.push({ x: cx, y, z: cz, sx, sy, sz });
  }

  // --- Walls: each cardinal side gets two side panels + an over-door header.
  function buildWallPair(axis, side) {
    const halfLen = BUILDING_HALF;
    const sideHalfLen = (halfLen - BUILDING_DOOR_HALF) / 2;
    const sideOffset = (BUILDING_DOOR_HALF + halfLen) / 2;
    for (const dir of [-1, +1]) {
      let cx, cz, sx, sz;
      if (axis === 'x') {
        cx = dir * sideOffset;
        cz = side * (BUILDING_HALF - BUILDING_WALL_T / 2);
        sx = sideHalfLen; sz = BUILDING_WALL_T / 2;
      } else {
        cx = side * (BUILDING_HALF - BUILDING_WALL_T / 2);
        cz = dir * sideOffset;
        sx = BUILDING_WALL_T / 2; sz = sideHalfLen;
      }
      addWallSegment(cx, BUILDING_ROOF / 2, cz, sx, BUILDING_ROOF / 2, sz);
    }
    let hcx, hcz, hsx, hsz;
    if (axis === 'x') {
      hcx = 0;
      hcz = side * (BUILDING_HALF - BUILDING_WALL_T / 2);
      hsx = BUILDING_DOOR_HALF; hsz = BUILDING_WALL_T / 2;
    } else {
      hcx = side * (BUILDING_HALF - BUILDING_WALL_T / 2);
      hcz = 0;
      hsx = BUILDING_WALL_T / 2; hsz = BUILDING_DOOR_HALF;
    }
    const headerH = BUILDING_ROOF - BUILDING_DOOR_TOP;
    addWallSegment(hcx, BUILDING_DOOR_TOP + headerH / 2, hcz, hsx, headerH / 2, hsz);
  }
  buildWallPair('x', -1);
  buildWallPair('x', +1);
  buildWallPair('z', -1);
  buildWallPair('z', +1);

  // --- Corner pillars (visual + accent lighting cue).
  for (const cx of [-BUILDING_HALF, +BUILDING_HALF]) {
    for (const cz of [-BUILDING_HALF, +BUILDING_HALF]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, BUILDING_ROOF, 0.7), pillarMat);
      p.position.set(cx, BUILDING_ROOF / 2, cz);
      scene.add(p);
    }
  }

  // --- Upper-floor balconies (annulus visual + 4 axis-aligned strips
  //     for collision/support).
  function buildFloorRing(floorTopY) {
    const sliceSY = 0.075;
    const center = floorTopY - sliceSY;
    const innerEdge = BUILDING_HALF - BUILDING_STRIP_DEPTH;
    const stripCenter = (BUILDING_HALF + innerEdge) / 2;
    const stripHalfDepth = BUILDING_STRIP_DEPTH / 2;
    const stripHalfLen = BUILDING_HALF;

    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(innerEdge, BUILDING_HALF, 48),
      floorMat
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = floorTopY + 0.002;
    scene.add(ringMesh);

    parkourPlatforms.push({ x: 0, y: center, z: -stripCenter, sx: stripHalfLen, sy: sliceSY, sz: stripHalfDepth });
    parkourPlatforms.push({ x: 0, y: center, z:  stripCenter, sx: stripHalfLen, sy: sliceSY, sz: stripHalfDepth });
    parkourPlatforms.push({ x:  stripCenter, y: center, z: 0, sx: stripHalfDepth, sy: sliceSY, sz: stripHalfLen });
    parkourPlatforms.push({ x: -stripCenter, y: center, z: 0, sx: stripHalfDepth, sy: sliceSY, sz: stripHalfLen });

    const railH = 0.9;
    const railThick = 0.08;
    function makeRail(cx, cz, lenAxis) {
      const w = lenAxis === 'x' ? innerEdge * 2 : railThick;
      const d = lenAxis === 'x' ? railThick : innerEdge * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, railH, d), railMat);
      m.position.set(cx, floorTopY + railH / 2, cz);
      scene.add(m);
    }
    makeRail(0, -innerEdge, 'x');
    makeRail(0,  innerEdge, 'x');
    makeRail( innerEdge, 0, 'z');
    makeRail(-innerEdge, 0, 'z');
  }
  buildFloorRing(FLOOR_Y[1]);
  buildFloorRing(FLOOR_Y[2]);

  // --- Staircases: corner runs of small steps from ground → floor 2 → 3.
  function buildStairs(fromY, toY, cornerX, cornerZ, dirX, dirZ) {
    const steps = 6;
    const stepRise = (toY - fromY) / steps;
    const stepRun = 1.0;
    const stepW = 1.6;
    for (let i = 0; i < steps; i++) {
      const stepTop = fromY + stepRise * (i + 1);
      const half = stepRise / 2;
      const cy = stepTop - half;
      const cx = cornerX + dirX * (i * stepRun + stepRun / 2);
      const cz = cornerZ + dirZ * (i * stepRun + stepRun / 2);
      // Stairs run along whichever axis is non-zero.
      const sx = dirX !== 0 ? stepRun / 2 : stepW / 2;
      const sz = dirZ !== 0 ? stepRun / 2 : stepW / 2;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sx * 2, half * 2, sz * 2),
        stairMat
      );
      m.position.set(cx, cy, cz);
      scene.add(m);
      parkourPlatforms.push({ x: cx, y: cy, z: cz, sx, sy: half, sz });
    }
  }
  // NE corner: stairs run westward along the north balcony edge.
  buildStairs(FLOOR_Y[0], FLOOR_Y[1], BUILDING_HALF - 2, -BUILDING_HALF + 4,  -1, 0);
  buildStairs(FLOOR_Y[1], FLOOR_Y[2], BUILDING_HALF - 2, -BUILDING_HALF + 4,  -1, 0);
  // SW corner: stairs run eastward along the south balcony edge.
  buildStairs(FLOOR_Y[0], FLOOR_Y[1], -BUILDING_HALF + 2, BUILDING_HALF - 4, +1, 0);
  buildStairs(FLOOR_Y[1], FLOOR_Y[2], -BUILDING_HALF + 2, BUILDING_HALF - 4, +1, 0);

  // --- Ladders flush against the inside of the N + S walls, away from
  //     doorways. Visual rails + rungs; gameplay zone is registered in
  //     `ladders` for climb-mode pickup in updatePlayerMovement.
  const ladderRailMat = new THREE.MeshStandardMaterial({
    color: 0x143040, emissive: 0x4ff0ff, emissiveIntensity: 0.55,
    roughness: 0.4, metalness: 0.6,
  });
  function buildLadder(x, z, baseY, topY, faceAxis, faceSign) {
    const height = topY - baseY;
    const tangentOff = 0.35;
    const tangentIsX = faceAxis === 'z'; // perpendicular to face axis
    const railGeom = new THREE.CylinderGeometry(0.06, 0.06, height, 8);
    for (const sign of [-1, +1]) {
      const rail = new THREE.Mesh(railGeom, ladderRailMat);
      rail.position.set(
        x + (tangentIsX ? sign * tangentOff : 0),
        baseY + height / 2,
        z + (tangentIsX ? 0 : sign * tangentOff),
      );
      scene.add(rail);
    }
    const rungGeom = new THREE.CylinderGeometry(0.04, 0.04, tangentOff * 2.2, 8);
    const rungSpacing = 0.5;
    const rungs = Math.floor(height / rungSpacing);
    for (let i = 0; i <= rungs; i++) {
      const rung = new THREE.Mesh(rungGeom, ladderRailMat);
      rung.position.set(x, baseY + i * rungSpacing, z);
      // Default cylinder is along Y; rotate so it aligns with tangent axis.
      if (tangentIsX) rung.rotation.z = Math.PI / 2;
      else            rung.rotation.x = Math.PI / 2;
      scene.add(rung);
    }
    ladders.push({
      x, z, baseY, topY,
      faceX: faceAxis === 'x' ? faceSign : 0,
      faceZ: faceAxis === 'z' ? faceSign : 0,
      range: 0.7,
    });
  }
  // North wall: ladder hangs near the inner face, faces +Z.
  buildLadder(10, -BUILDING_HALF + 1, FLOOR_Y[0], FLOOR_Y[2], 'z', +1);
  // South wall: ladder faces -Z (back into the atrium).
  buildLadder(-10, BUILDING_HALF - 1, FLOOR_Y[0], FLOOR_Y[2], 'z', -1);
}

// ------------------------------------------------------------------
// Parkour course
// ------------------------------------------------------------------
// One-way AABB platforms rising in a spiral. You can jump up through
// them from below and land on their top. A wide top pad is left clear
// as the future home of a "summit" portal.

// Parkour time trial state. Start/end pads are populated inside the
// spiral-build block below and the timer is driven from the main loop.
const parkour = {
  startPad: null, // { x, z, r }
  endPad: null,   // { x, y, z, r }
  startRing: null,
  endRing: null,
  running: false,
  startMs: 0,
  currentMs: 0,
  bestMs: null,
  onStart: false,
  onEnd: false,
};
try {
  const raw = localStorage.getItem('lobby:parkourBest');
  if (raw) parkour.bestMs = parseInt(raw, 10) || null;
} catch {}
function saveParkourBest() {
  try { localStorage.setItem('lobby:parkourBest', String(parkour.bestMs ?? '')); } catch {}
}

function formatTime(ms) {
  if (ms == null) return '--:--';
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

{
  const cx = 9, cz = 3;
  const steps = 12;
  const baseR = 4;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 3;
    const r = baseR + i * 0.08;
    parkourPlatforms.push({
      x: cx + Math.cos(angle) * r,
      y: 0.6 + i * 1.2,
      z: cz + Math.sin(angle) * r,
      sx: Math.max(0.7, 1.15 - i * 0.035),
      sy: 0.15,
      sz: Math.max(0.7, 1.15 - i * 0.035),
    });
  }
  // Wide summit pad for the future portal.
  parkourPlatforms.push({
    x: cx - 1,
    y: 0.6 + steps * 1.2,
    z: cz,
    sx: 2.2, sy: 0.22, sz: 2.2,
  });

  const stepMat = new THREE.MeshStandardMaterial({
    color: 0x331a66,
    emissive: 0x9a3fff,
    emissiveIntensity: 0.55,
    roughness: 0.45,
    metalness: 0.25,
  });
  const summitMat = new THREE.MeshStandardMaterial({
    color: 0x3a1080,
    emissive: 0xff4fd8,
    emissiveIntensity: 0.7,
    roughness: 0.4,
    metalness: 0.3,
  });
  parkourPlatforms.forEach((p, i) => {
    const isSummit = i === parkourPlatforms.length - 1;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(p.sx * 2, p.sy * 2, p.sz * 2),
      isSummit ? summitMat : stepMat
    );
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
  });

  // Time trial pads — start at the base near the first step, end on
  // the summit pad. Visual rings are flat glowing discs; detection
  // lives in the main loop.
  const summit = parkourPlatforms[parkourPlatforms.length - 1];
  parkour.startPad = { x: 15.5, z: 3.5, r: 1.4 };
  parkour.endPad   = { x: summit.x, z: summit.z, y: summit.y + summit.sy + 0.02, r: 1.2 };

  const startRing = new THREE.Mesh(
    new THREE.RingGeometry(parkour.startPad.r * 0.75, parkour.startPad.r, 48),
    new THREE.MeshBasicMaterial({ color: 0x4ff0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  startRing.rotation.x = -Math.PI / 2;
  startRing.position.set(parkour.startPad.x, 0.04, parkour.startPad.z);
  scene.add(startRing);
  parkour.startRing = startRing;

  const endRing = new THREE.Mesh(
    new THREE.RingGeometry(parkour.endPad.r * 0.72, parkour.endPad.r, 48),
    new THREE.MeshBasicMaterial({ color: 0xff4fd8, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  endRing.rotation.x = -Math.PI / 2;
  endRing.position.set(parkour.endPad.x, parkour.endPad.y, parkour.endPad.z);
  scene.add(endRing);
  parkour.endRing = endRing;
}

// ------------------------------------------------------------------
// Outer world — four themed decoration sectors around the lobby
// ------------------------------------------------------------------
// Kept purely visual for this pass. The pillar ring stays as the
// boundary between the "indoor" lobby and the grass outside.

const ducks = [];
const balls = [];
const hoops = [];
const benches = []; // { x, z, yaw, sitY }
let plane = null;   // { group, prop, basePos, baseYaw, pitch }
const cars = [];    // { group, wheels, yaw, velX, velZ, basePos, baseYaw, targetX, targetZ, targetYaw, driverPeerId }
const skyscrapers = []; // window emissive ramps with the night cycle

// ------------------------------------------------------------------
// Type-racing arena
// ------------------------------------------------------------------

const RACE_SENTENCES = [
  "The quick brown fox jumps over the lazy dog near the pond",
  "Portal hopping is the fastest way to travel between worlds",
  "Watch out for the ducks they are plotting something sinister",
  "The parkour course spirals upward into the neon glow above",
  "Kick the ball into the goal before the other team scores",
  "Flying a plane over the lobby feels absolutely magnificent",
  "Type faster and your animal will sprint ahead of the pack",
  "Nothing beats sitting on a bench watching the sunset fade",
  "Every portal leads to a new adventure waiting to begin today",
  "The basketball soars through the air and swishes the net",
  "Stars blink on at dusk while the streetlamps start to glow",
  "Hamsters are surprisingly competitive when it comes to racing",
  "Never underestimate a determined little critter on the track",
  "The finish line is calling and your fingers are the engine",
];

const RACE_CX = 38, RACE_CZ = -38;
const RACE_TRACK_LEN = 24;
const RACE_LANES = 6;
const RACE_LANE_W = 1.2;
const RACE_START_X = RACE_CX - RACE_TRACK_LEN / 2;
const RACE_SPEED_BOOST = 6.5;
const RACE_ERROR_MULT = 0.15;
const RACE_FRICTION = 0.93;
const RACE_PAD_X = RACE_START_X - 3;
const RACE_PAD_R = 1.5;

function laneZ(i) {
  return RACE_CZ - (RACE_LANES * RACE_LANE_W) / 2 + (i + 0.5) * RACE_LANE_W;
}

const race = {
  active: false,
  countdown: 0,
  countdownEnd: 0,
  sentence: '',
  sentenceIdx: 0,
  typed: 0,
  errors: 0,
  pos: 0,         // 0..RACE_TRACK_LEN
  vel: 0,
  finished: false,
  finishTime: 0,
  startTime: 0,
  animal: null,
  lane: 0,
  onPad: false,
  errorFlash: 0,
  peerAnimals: new Map(), // peerId → { animal, lane, pos, targetPos }
  nextPeerLane: 1,
};

// Sentence index cycles by wall clock so independent joiners agree
// when nobody else is racing. Once anyone is racing, joiners inherit
// that sentence so an in-progress race never splits across clients.
const RACE_SENTENCE_ROTATION_MS = 60_000;
function pickSharedSentenceIdx() {
  for (const peer of peers.values()) {
    if (peer.state?.racing
        && typeof peer.state.raceSentence === 'number'
        && peer.state.raceSentence >= 0
        && peer.state.raceSentence < RACE_SENTENCES.length) {
      return peer.state.raceSentence;
    }
  }
  return Math.floor(Date.now() / RACE_SENTENCE_ROTATION_MS) % RACE_SENTENCES.length;
}

function makeRaceAnimal(hexColor) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: hexColor, roughness: 0.55, emissive: hexColor, emissiveIntensity: 0.15,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), mat);
  body.scale.set(1.3, 0.85, 0.9);
  body.position.y = 0.3;
  grp.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat);
  head.position.set(0.42, 0.42, 0);
  grp.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const eyeGeom = new THREE.SphereGeometry(0.04, 8, 6);
  for (const dz of [0.08, -0.08]) {
    const eye = new THREE.Mesh(eyeGeom, eyeMat);
    eye.position.set(0.56, 0.46, dz);
    grp.add(eye);
  }
  const earGeom = new THREE.SphereGeometry(0.07, 8, 6);
  for (const dz of [0.1, -0.1]) {
    const ear = new THREE.Mesh(earGeom, mat);
    ear.position.set(0.38, 0.62, dz);
    grp.add(ear);
  }
  const legGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.15, 8);
  const legs = [];
  for (const [lx, lz] of [[0.15, 0.15], [0.15, -0.15], [-0.15, 0.15], [-0.15, -0.15]]) {
    const leg = new THREE.Mesh(legGeom, mat);
    leg.position.set(lx, 0.07, lz);
    grp.add(leg);
    legs.push(leg);
  }
  grp.userData.legs = legs;
  return grp;
}

function animateRaceAnimal(animal, vel, dt) {
  if (!animal) return;
  const speed = Math.abs(vel);
  const t = performance.now() * 0.001;
  animal.position.y = speed > 0.5 ? Math.abs(Math.sin(t * 14)) * 0.06 : 0;
  const legs = animal.userData.legs;
  if (!legs) return;
  const phase = t * Math.min(speed, 15) * 2.5;
  legs[0].rotation.x =  Math.sin(phase) * 0.7;
  legs[1].rotation.x = -Math.sin(phase) * 0.7;
  legs[2].rotation.x = -Math.sin(phase) * 0.7;
  legs[3].rotation.x =  Math.sin(phase) * 0.7;
}

// Scoring — ball sports. Two soccer goal rectangles (x bounds, y bounds,
// z plane, which side counts as "in") plus the basketball hoops array.
const soccerGoals = [];
const scores = { soccer: 0, basketball: 0 };
try {
  const raw = localStorage.getItem('lobby:scores');
  if (raw) Object.assign(scores, JSON.parse(raw));
} catch {}
function saveScores() {
  try { localStorage.setItem('lobby:scores', JSON.stringify(scores)); } catch {}
}

let sendBallAction = null;
let lastBallBroadcast = 0;
const PICKUP_RANGE = 1.9;

const BALL_GRAVITY = 22;
const BALL_BOUNCE = 0.55;
const BALL_GROUND_FRICTION = 0.35;
const BALL_AIR_DRAG = 0.92;
const BALL_REST_EPS = 0.2;
const BALL_MAX_DRIFT = 45;

function makeBall({ id, radius, color, roughness = 0.5, emissive = 0x000000, emissiveIntensity = 0, spawn, pickupable = false }) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 18),
    new THREE.MeshStandardMaterial({ color, roughness, emissive, emissiveIntensity })
  );
  mesh.position.copy(spawn);
  scene.add(mesh);
  const ball = {
    id,
    radius,
    mesh,
    pos: spawn.clone(),
    prev: spawn.clone(), // previous-frame pos for swept scoring detection
    vel: new THREE.Vector3(),
    home: spawn.clone(),
    pickupable,
    heldLocal: false,
    holderPeerId: null,
    scoredUntil: 0,
  };
  balls.push(ball);
  return ball;
}

function broadcastBall(ball) {
  if (!sendBallAction) return;
  sendBallAction({
    id: ball.id,
    x: ball.pos.x, y: ball.pos.y, z: ball.pos.z,
    vx: ball.vel.x, vy: ball.vel.y, vz: ball.vel.z,
    held: !!ball.heldLocal,
  });
}

function updateHeldBall(ball, dt) {
  // Position the ball at the player's right hip, with a dribble bob
  // when walking and a gentle idle bob when stationary.
  const cosY = Math.cos(player.yaw);
  const sinY = Math.sin(player.yaw);
  // Player's "right" direction: (cos yaw, 0, -sin yaw).
  const rx = cosY;
  const rz = -sinY;
  const now = performance.now();

  let offY;
  if (player.isMoving) {
    // Smooth |sin| gives a bouncing envelope like a dribble.
    const phase = now * 0.014;
    offY = 0.35 + 0.55 * Math.abs(Math.sin(phase));
  } else {
    offY = 0.95 + Math.sin(now * 0.004) * 0.025;
  }

  ball.pos.x = player.pos.x + rx * 0.55;
  ball.pos.y = player.pos.y + offY;
  ball.pos.z = player.pos.z + rz * 0.55;
  ball.mesh.position.copy(ball.pos);
  ball.mesh.rotation.x += dt * 5;
  ball.mesh.rotation.y += dt * 1.5;
}

function tryTogglePickup() {
  // If currently holding a ball, drop it at player's feet.
  const held = balls.find(b => b.heldLocal);
  if (held) {
    held.heldLocal = false;
    held.holderPeerId = null;
    const cosY = Math.cos(player.yaw);
    const sinY = Math.sin(player.yaw);
    held.pos.x = player.pos.x + Math.sin(player.yaw) * 0.8;
    held.pos.y = player.pos.y + held.radius + 0.1;
    held.pos.z = player.pos.z + Math.cos(player.yaw) * 0.8;
    held.vel.set(0, 0, 0);
    broadcastBall(held);
    return;
  }

  // Otherwise try to pick up the nearest pickupable free ball in range.
  let best = null;
  let bestD2 = PICKUP_RANGE * PICKUP_RANGE;
  for (const ball of balls) {
    if (!ball.pickupable) continue;
    if (ball.holderPeerId) continue;
    const dx = player.pos.x - ball.pos.x;
    const dy = (player.pos.y + 0.9) - ball.pos.y;
    const dz = player.pos.z - ball.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = ball; }
  }
  if (!best) return;
  best.heldLocal = true;
  best.holderPeerId = 'local';
  best.vel.set(0, 0, 0);
  broadcastBall(best);
}

// Shot speed is fixed; aim direction comes from where the camera is
// looking, so players control arc + power purely through pitch.
const SHOT_SPEED = 18;
const _shotDirScratch = new THREE.Vector3();

function getShotInitial() {
  const ball = balls.find(b => b.heldLocal);
  if (!ball) return null;
  camera.getWorldDirection(_shotDirScratch);
  const dir = _shotDirScratch.clone();
  // Tiny forward offset so the ball doesn't spawn inside the player.
  const start = new THREE.Vector3(
    player.pos.x + dir.x * 0.45,
    player.pos.y + 1.35,
    player.pos.z + dir.z * 0.45,
  );
  const vel = dir.multiplyScalar(SHOT_SPEED);
  return { ball, start, vel };
}

function shootHeldBall() {
  const init = getShotInitial();
  if (!init) return;
  const { ball, start, vel } = init;
  ball.heldLocal = false;
  ball.holderPeerId = null;
  ball.pos.copy(start);
  ball.prev.copy(start);
  ball.vel.copy(vel);
  broadcastBall(ball);
}

// Trajectory preview — a faint dotted line of where the held ball
// would land if shot right now. Updated each frame from the live
// camera direction so it tracks pitch/yaw in real time.
const AIM_GUIDE_POINTS = 32;
const AIM_GUIDE_DT = 0.05;
const aimGuide = new THREE.Line(
  new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(AIM_GUIDE_POINTS * 3), 3),
  ),
  new THREE.LineBasicMaterial({
    color: 0xffd88a,
    transparent: true,
    opacity: 0.7,
    depthTest: true,
  }),
);
aimGuide.visible = false;
aimGuide.frustumCulled = false;
scene.add(aimGuide);

function updateAimGuide() {
  const init = getShotInitial();
  if (!init) { aimGuide.visible = false; return; }
  aimGuide.visible = true;
  const { start, vel, ball } = init;
  const positions = aimGuide.geometry.attributes.position.array;
  const p = start.clone();
  const v = vel.clone();
  let lastIdx = 0;
  for (let i = 0; i < AIM_GUIDE_POINTS; i++) {
    positions[i * 3 + 0] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    lastIdx = i;
    if (p.y <= ball.radius && i > 0) break;
    v.y -= BALL_GRAVITY * AIM_GUIDE_DT;
    p.x += v.x * AIM_GUIDE_DT;
    p.y += v.y * AIM_GUIDE_DT;
    p.z += v.z * AIM_GUIDE_DT;
  }
  // Collapse trailing slots onto the last real point so the line
  // doesn't shoot off to (0,0,0).
  const lx = positions[lastIdx * 3 + 0];
  const ly = positions[lastIdx * 3 + 1];
  const lz = positions[lastIdx * 3 + 2];
  for (let i = lastIdx + 1; i < AIM_GUIDE_POINTS; i++) {
    positions[i * 3 + 0] = lx;
    positions[i * 3 + 1] = ly;
    positions[i * 3 + 2] = lz;
  }
  aimGuide.geometry.attributes.position.needsUpdate = true;
  aimGuide.geometry.computeBoundingSphere();
}

function updateBall(ball, dt) {
  ball.prev.copy(ball.pos);
  ball.vel.y -= BALL_GRAVITY * dt;
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;
  ball.pos.z += ball.vel.z * dt;

  if (ball.pos.y < ball.radius) {
    ball.pos.y = ball.radius;
    if (ball.vel.y < 0) ball.vel.y = -ball.vel.y * BALL_BOUNCE;
    if (Math.abs(ball.vel.y) < 0.3) ball.vel.y = 0;
    const f = Math.pow(BALL_GROUND_FRICTION, dt);
    ball.vel.x *= f;
    ball.vel.z *= f;
  } else {
    const f = Math.pow(BALL_AIR_DRAG, dt);
    ball.vel.x *= f;
    ball.vel.z *= f;
  }

  const speedH = Math.hypot(ball.vel.x, ball.vel.z);
  if (speedH < BALL_REST_EPS && ball.pos.y <= ball.radius + 0.02 && Math.abs(ball.vel.y) < 0.05) {
    ball.vel.set(0, 0, 0);
  }

  const dxH = ball.pos.x - ball.home.x;
  const dzH = ball.pos.z - ball.home.z;
  if (dxH * dxH + dzH * dzH > BALL_MAX_DRIFT * BALL_MAX_DRIFT || ball.pos.y < -8) {
    ball.pos.copy(ball.home);
    ball.vel.set(0, 0, 0);
    broadcastBall(ball);
  }

  ball.mesh.position.copy(ball.pos);

  // Rolling visual: rotate around the axis perpendicular to horizontal velocity.
  const moveSpeed = ball.vel.length();
  if (moveSpeed > 0.01) {
    const axis = new THREE.Vector3(ball.vel.z, 0, -ball.vel.x);
    const axisLen = axis.length();
    if (axisLen > 0.0001) {
      axis.divideScalar(axisLen);
      const angle = (speedH * dt) / ball.radius;
      ball.mesh.rotateOnWorldAxis(axis, angle);
    }
  }

  checkScoreEvents(ball);
}

function checkScoreEvents(ball) {
  const now = performance.now();
  if (ball.scoredUntil && now < ball.scoredUntil) return;
  // Swept-position detection — large teleports (broadcasts, respawns)
  // can straddle a goal plane spuriously, so skip jumps > 4m.
  const dx = ball.pos.x - ball.prev.x;
  const dy = ball.pos.y - ball.prev.y;
  const dz = ball.pos.z - ball.prev.z;
  if (dx * dx + dy * dy + dz * dz > 16) return;

  if (ball.id === 'soccer') {
    for (const g of soccerGoals) {
      const crossing = (ball.prev.z - g.z) * (ball.pos.z - g.z);
      if (crossing > 0) continue;
      // Only count shots from the playing-field side of the goal line.
      if (g.fromSide * (ball.prev.z - g.z) <= 0) continue;
      const t = Math.abs(ball.prev.z - g.z) /
                Math.max(0.0001, Math.abs(ball.pos.z - ball.prev.z));
      const cx = ball.prev.x + t * dx;
      const cy = ball.prev.y + t * dy;
      if (cx < g.xMin || cx > g.xMax) continue;
      if (cy < 0 || cy > g.yMax) continue;
      registerScore(ball, 'soccer', 'GOAL!');
      return;
    }
  } else if (ball.id === 'basketball') {
    for (const h of hoops) {
      const rimY = h.pos.y;
      if (!(ball.prev.y > rimY && ball.pos.y <= rimY)) continue;
      const t = (ball.prev.y - rimY) / Math.max(0.0001, ball.prev.y - ball.pos.y);
      const cx = ball.prev.x + t * dx;
      const cz = ball.prev.z + t * dz;
      const rdx = cx - h.pos.x;
      const rdz = cz - h.pos.z;
      const limit = (h.radius - ball.radius * 0.6);
      if (rdx * rdx + rdz * rdz > limit * limit) continue;
      // Require a downward motion — otherwise catching the rim from
      // below while dribbling under it would false-trigger.
      if (ball.vel.y > -0.5) continue;
      registerScore(ball, 'basketball', 'BASKET!');
      return;
    }
  }
}

function registerScore(ball, kind, label) {
  ball.scoredUntil = performance.now() + 1500;
  scores[kind] = (scores[kind] || 0) + 1;
  saveScores();
  updateScoresHUD();
  showToast(label);
  // Let the ball finish its trajectory for the visual cheer, then
  // gently respawn it at its home spawn point.
  setTimeout(() => {
    ball.pos.copy(ball.home);
    ball.vel.set(0, 0, 0);
    ball.prev.copy(ball.home);
    ball.scoredUntil = 0;
    broadcastBall(ball);
  }, 1400);
}

function collideBallWithPlayer(ball) {
  const dx = player.pos.x - ball.pos.x;
  const dz = player.pos.z - ball.pos.z;
  const d2 = dx * dx + dz * dz;
  const minDist = PLAYER_RADIUS + ball.radius;
  if (d2 >= minDist * minDist) return;
  if (ball.pos.y + ball.radius < player.pos.y - 0.05) return;
  if (ball.pos.y - ball.radius > player.pos.y + PLAYER_HEIGHT) return;

  const d = Math.sqrt(Math.max(d2, 0.0001));
  const nx = -dx / d; // from player toward ball
  const nz = -dz / d;
  const playerSpeed = player.isMoving ? player.speed : 0;
  const kickStrength = 3.5 + playerSpeed * 2;

  ball.vel.x = nx * kickStrength;
  ball.vel.z = nz * kickStrength;
  ball.vel.y = Math.max(ball.vel.y, 3.8);

  ball.pos.x = player.pos.x + nx * minDist * 1.05;
  ball.pos.z = player.pos.z + nz * minDist * 1.05;

  broadcastBall(ball);
}

{
  // Grass ground extends well beyond the lobby floor.
  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(82, 72),
    new THREE.MeshStandardMaterial({ color: 0x1b3a1a, roughness: 0.95 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.01;
  scene.add(grass);

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // Street lamps at each sector approach — four total to stay within
  // the WebGL light budget. Their PointLight + bulb emissive ramp
  // from off (day) to full (night) via updateDayNight.
  function makeLamp(x, z) {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: 0.75 });
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 4, 10),
      poleMat
    );
    pole.position.y = 2;
    grp.add(pole);

    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.1, 0.1),
      poleMat
    );
    arm.position.set(0.45, 4, 0);
    grp.add(arm);

    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff2c0,
      emissive: 0xffd88a,
      emissiveIntensity: 0.1,
    });
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 10),
      bulbMat
    );
    bulb.position.set(0.85, 3.95, 0);
    grp.add(bulb);

    const light = new THREE.PointLight(0xffd88a, 0, 16, 1.6);
    light.position.set(0.85, 3.7, 0);
    grp.add(light);

    scene.add(grp);
    streetLamps.push({ bulbMat, light });
  }
  makeLamp(0, -30);   // soccer approach
  makeLamp(30, 0);    // basketball approach
  makeLamp(0, 30);    // airfield approach
  makeLamp(-30, 0);   // park approach

  // ---------- Soccer pitch (north, -Z) ----------
  {
    const cx = 0, cz = -48;
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 22),
      new THREE.MeshStandardMaterial({ color: 0x2c6030, roughness: 0.85 })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(cx, 0.02, cz);
    scene.add(pitch);

    const border = new THREE.Mesh(
      new THREE.RingGeometry(0, 0, 0), // placeholder
      lineMat
    );
    // Actual perimeter via four thin planes
    const makeLine = (w, h, x, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx + x, 0.03, cz + z);
      scene.add(m);
    };
    makeLine(32, 0.25, 0, -11);    // top
    makeLine(32, 0.25, 0,  11);    // bottom
    makeLine(0.25, 22, -16, 0);    // left
    makeLine(0.25, 22,  16, 0);    // right
    makeLine(0.25, 22, 0, 0);      // center line

    const centerCircle = new THREE.Mesh(
      new THREE.RingGeometry(2.8, 3.0, 64),
      lineMat
    );
    centerCircle.rotation.x = -Math.PI / 2;
    centerCircle.position.set(cx, 0.03, cz);
    scene.add(centerCircle);

    const goalMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xaaaaff, emissiveIntensity: 0.25,
      roughness: 0.4, metalness: 0.6,
    });
    const postGeom = new THREE.CylinderGeometry(0.1, 0.1, 2.2, 12);
    const barGeom  = new THREE.CylinderGeometry(0.1, 0.1, 6.4, 12);
    function makeGoal(gz) {
      const W = 6.4, H = 2.2;
      const left  = new THREE.Mesh(postGeom, goalMat);
      left.position.set(cx - W / 2, H / 2, gz);
      scene.add(left);
      const right = new THREE.Mesh(postGeom, goalMat);
      right.position.set(cx + W / 2, H / 2, gz);
      scene.add(right);
      const top = new THREE.Mesh(barGeom, goalMat);
      top.rotation.z = Math.PI / 2;
      top.position.set(cx, H, gz);
      scene.add(top);
    }
    makeGoal(cz - 11.2);
    makeGoal(cz + 11.2);

    // Goal rectangles for scoring: +fromSide means the ball enters
    // from the +Z side (i.e. from the playing field), so the north
    // goal (cz - 11.2) counts shots coming from larger z, and the
    // south goal (cz + 11.2) counts shots coming from smaller z.
    soccerGoals.push({
      z: cz - 11.2, xMin: cx - 3.2, xMax: cx + 3.2, yMax: 2.2, fromSide: +1,
    });
    soccerGoals.push({
      z: cz + 11.2, xMin: cx - 3.2, xMax: cx + 3.2, yMax: 2.2, fromSide: -1,
    });

    makeBall({
      id: 'soccer',
      radius: 0.32,
      color: 0xffffff,
      roughness: 0.45,
      spawn: new THREE.Vector3(cx, 0.32, cz),
    });
  }

  // ---------- Basketball court (east, +X) ----------
  {
    const cx = 48, cz = 0;
    const court = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 11),
      new THREE.MeshStandardMaterial({ color: 0x7a4418, roughness: 0.75 })
    );
    court.rotation.x = -Math.PI / 2;
    court.position.set(cx, 0.02, cz);
    scene.add(court);

    const courtLine = (w, h, dx, dz) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx + dx, 0.03, cz + dz);
      scene.add(m);
    };
    courtLine(16, 0.2, 0, -5.5);
    courtLine(16, 0.2, 0,  5.5);
    courtLine(0.2, 11, -8, 0);
    courtLine(0.2, 11,  8, 0);
    courtLine(0.2, 11,  0, 0); // half line

    // Center circle
    const centerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.55, 48),
      lineMat
    );
    centerRing.rotation.x = -Math.PI / 2;
    centerRing.position.set(cx, 0.03, cz);
    scene.add(centerRing);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.5,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xff5a00, emissive: 0xff5a00, emissiveIntensity: 0.9,
    });
    function makeHoop(hx, facingX) {
      // facingX = +1 means the hoop face points toward +X (so its backboard
      // sits on the -X side). Used by the left hoop. facingX = -1 for right.
      const grp = new THREE.Group();
      grp.position.set(hx, 0, cz);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.13, 3.8, 12),
        poleMat
      );
      pole.position.y = 1.9;
      grp.add(pole);

      // Backboard: thin along X so its 2×1.3 face is perpendicular to X,
      // which means it faces the court center.
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 1.3, 2),
        boardMat
      );
      board.position.set(-facingX * 0.15, 3.5, 0);
      grp.add(board);

      // Rim stays horizontal; positioned in front of the board on the
      // facingX side so it hangs over the court.
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.48, 0.05, 12, 32),
        rimMat
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(facingX * 0.5, 3.2, 0);
      grp.add(rim);

      scene.add(grp);
      hoops.push({
        pos: new THREE.Vector3(hx + facingX * 0.5, 3.2, cz),
        radius: 0.48,
      });
    }
    makeHoop(cx - 7.2,  1);
    makeHoop(cx + 7.2, -1);

    makeBall({
      id: 'basketball',
      radius: 0.29,
      color: 0xd85a1a,
      roughness: 0.6,
      emissive: 0x7a2a00,
      emissiveIntensity: 0.15,
      spawn: new THREE.Vector3(cx - 2.5, 0.29, cz + 0.8),
      pickupable: true,
    });
  }

  // ---------- Airfield (south, +Z) ----------
  {
    const cx = 0, cz = 50;
    const runway = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 42),
      new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.85 })
    );
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(cx, 0.02, cz);
    scene.add(runway);

    for (let i = -18; i <= 18; i += 4) {
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, 2),
        lineMat
      );
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(cx, 0.03, cz + i);
      scene.add(dash);
    }

    const planeGrp = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xd4d4dc, metalness: 0.7, roughness: 0.3,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xff3a3a, emissive: 0xff3a3a, emissiveIntensity: 0.25,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x88d7ff, transparent: true, opacity: 0.55,
      metalness: 0.5, roughness: 0.15,
    });

    const fuselage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.35, 6.2, 16),
      bodyMat
    );
    fuselage.rotation.x = Math.PI / 2;
    planeGrp.add(fuselage);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1, 16),
      bodyMat
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0, 3.6);
    planeGrp.add(nose);

    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 14, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      glassMat
    );
    cockpit.position.set(0, 0.45, 0.8);
    planeGrp.add(cockpit);

    const wings = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 0.12, 1.5),
      bodyMat
    );
    wings.position.y = 0.05;
    planeGrp.add(wings);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(7.25, 0.13, 0.3),
      accentMat
    );
    stripe.position.y = 0.06;
    planeGrp.add(stripe);

    const tailV = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1, 1.1),
      bodyMat
    );
    tailV.position.set(0, 0.55, -2.8);
    planeGrp.add(tailV);

    const tailH = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.08, 0.8),
      bodyMat
    );
    tailH.position.set(0, 0.12, -2.85);
    planeGrp.add(tailH);

    const prop = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.09, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
    );
    prop.position.set(0, 0, 4.15);
    planeGrp.add(prop);

    // Landing gear stubs so the plane sits above the runway
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const gearL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), gearMat);
    gearL.position.set(-1.6, -0.55, 0);
    planeGrp.add(gearL);
    const gearR = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), gearMat);
    gearR.position.set(1.6, -0.55, 0);
    planeGrp.add(gearR);
    const wheelGeom = new THREE.CylinderGeometry(0.25, 0.25, 0.15, 14);
    const wheelMat  = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wL = new THREE.Mesh(wheelGeom, wheelMat);
    wL.rotation.z = Math.PI / 2;
    wL.position.set(-1.6, -0.9, 0);
    planeGrp.add(wL);
    const wR = new THREE.Mesh(wheelGeom, wheelMat);
    wR.rotation.z = Math.PI / 2;
    wR.position.set(1.6, -0.9, 0);
    planeGrp.add(wR);

    planeGrp.position.set(cx - 3, 1.15, cz - 15);
    planeGrp.rotation.order = 'YXZ';
    planeGrp.rotation.y = Math.PI * 0.08;
    scene.add(planeGrp);

    plane = {
      group: planeGrp,
      prop,
      basePos: planeGrp.position.clone(),
      baseYaw: planeGrp.rotation.y,
      pitch: 0,
      // When a remote peer is piloting, we lerp our local plane toward
      // their broadcast pose each frame. When they land (or no one is
      // flying), the target just stays put so the plane sits still.
      targetX: planeGrp.position.x,
      targetY: planeGrp.position.y,
      targetZ: planeGrp.position.z,
      targetYaw: planeGrp.rotation.y,
      targetPitch: 0,
    };
  }

  // ---------- Park + pond (west, -X) ----------
  {
    const cx = -48, cz = 0;

    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(15, 48),
      new THREE.MeshStandardMaterial({ color: 0x2e6126, roughness: 0.92 })
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(cx, 0.02, cz);
    scene.add(patch);

    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(5.5, 56),
      new THREE.MeshStandardMaterial({
        color: 0x2f7ec8, emissive: 0x1b55a0, emissiveIntensity: 0.35,
        roughness: 0.2, metalness: 0.3,
      })
    );
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(cx, 0.05, cz);
    scene.add(pond);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b2a14, roughness: 0.9 });
    const leafMat  = new THREE.MeshStandardMaterial({
      color: 0x2a7a32, emissive: 0x164020, emissiveIntensity: 0.18, roughness: 0.85,
    });
    const trunkGeom = new THREE.CylinderGeometry(0.15, 0.22, 1.9, 10);
    const leafGeom  = new THREE.ConeGeometry(1, 2.4, 12);
    function makeTree(x, z) {
      const grp = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      trunk.position.y = 0.95;
      grp.add(trunk);
      const leaves = new THREE.Mesh(leafGeom, leafMat);
      leaves.position.y = 2.6;
      grp.add(leaves);
      grp.position.set(x, 0, z);
      scene.add(grp);
    }
    makeTree(cx - 9, cz - 8);
    makeTree(cx + 10, cz - 6);
    makeTree(cx - 7, cz + 10);
    makeTree(cx + 9, cz + 9);
    makeTree(cx + 1, cz - 13);

    const benchMat = new THREE.MeshStandardMaterial({ color: 0x5a3a14, roughness: 0.85 });
    function makeBench(x, z, rot = 0) {
      const grp = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 0.55), benchMat);
      seat.position.y = 0.48;
      grp.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 0.08), benchMat);
      back.position.set(0, 0.88, -0.24);
      grp.add(back);
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.55), benchMat);
      legL.position.set(-0.88, 0.24, 0);
      grp.add(legL);
      const legR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.55), benchMat);
      legR.position.set(0.88, 0.24, 0);
      grp.add(legR);
      grp.position.set(x, 0, z);
      grp.rotation.y = rot;
      scene.add(grp);
      // Local seat forward is +Z (the bench back sits at local -Z), so the
      // player yaw that looks away from the back is just `rot`. Seat top is
      // at y 0.54; body drops 0.45 in the sit pose (body base 0.8 → 0.35),
      // so anchoring player.pos.y near 0.19 plants the avatar on the seat.
      benches.push({ x, z, yaw: rot, sitY: 0.19 });
    }
    makeBench(cx + 7, cz + 2, -Math.PI * 0.35);
    makeBench(cx - 8, cz - 3, Math.PI * 0.42);
    makeBench(cx + 2, cz - 8, Math.PI);

    const duckBodyMat = new THREE.MeshStandardMaterial({ color: 0xf2efe2, roughness: 0.7 });
    const duckHeadMat = new THREE.MeshStandardMaterial({ color: 0x2a5a30, roughness: 0.6 });
    const beakMat     = new THREE.MeshStandardMaterial({ color: 0xffaa22 });
    const duckBodyGeom = new THREE.SphereGeometry(0.22, 14, 10);
    const duckHeadGeom = new THREE.SphereGeometry(0.14, 12, 10);
    const beakGeom     = new THREE.ConeGeometry(0.05, 0.12, 8);
    for (let i = 0; i < 6; i++) {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(duckBodyGeom, duckBodyMat);
      body.scale.set(1.35, 0.85, 1);
      grp.add(body);
      const head = new THREE.Mesh(duckHeadGeom, duckHeadMat);
      head.position.set(0.22, 0.16, 0);
      grp.add(head);
      const beak = new THREE.Mesh(beakGeom, beakMat);
      beak.rotation.z = -Math.PI / 2;
      beak.position.set(0.34, 0.14, 0);
      grp.add(beak);

      const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.3;
      const r = 1.8 + Math.random() * 2.6;
      grp.position.set(cx + Math.cos(angle) * r, 0.38, cz + Math.sin(angle) * r);
      scene.add(grp);
      ducks.push({
        group: grp,
        cx, cz,
        angle,
        radius: r,
        speed: 0.1 + Math.random() * 0.1,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  // ---------- Parking lot with racecars (SW quadrant) ----------
  {
    const cx = -28, cz = -30;

    // Asphalt pad
    const lot = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 10),
      new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.85 })
    );
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(cx, 0.02, cz);
    scene.add(lot);

    // Parking spot lines
    const spotLineMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, emissive: 0xcccccc, emissiveIntensity: 0.1 });
    for (let i = 0; i < 5; i++) {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 4.5),
        spotLineMat
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(cx - 6 + i * 3, 0.03, cz);
      scene.add(line);
    }

    function makeCar(color, emissive, spawnX, spawnZ, spawnYaw) {
      const grp = new THREE.Group();

      const bodyMat = new THREE.MeshStandardMaterial({
        color, emissive, emissiveIntensity: 0.25, metalness: 0.6, roughness: 0.3,
      });

      // Low body
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.45, 3.4),
        bodyMat
      );
      body.position.y = 0.42;
      grp.add(body);

      // Cabin / windshield
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x88d7ff, transparent: true, opacity: 0.5,
        metalness: 0.5, roughness: 0.15,
      });
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.4, 1.3),
        glassMat
      );
      cabin.position.set(0, 0.87, -0.15);
      grp.add(cabin);

      // Spoiler
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 });
      const spoiler = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.06, 0.35),
        darkMat
      );
      spoiler.position.set(0, 0.95, -1.5);
      grp.add(spoiler);
      const postGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6);
      const pL = new THREE.Mesh(postGeom, darkMat);
      pL.position.set(-0.55, 0.79, -1.5);
      grp.add(pL);
      const pR = new THREE.Mesh(postGeom, darkMat);
      pR.position.set(0.55, 0.79, -1.5);
      grp.add(pR);

      // Front bumper accent
      const bumper = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.15, 0.15),
        darkMat
      );
      bumper.position.set(0, 0.28, 1.75);
      grp.add(bumper);

      // Headlights
      const lightMat = new THREE.MeshStandardMaterial({
        color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: 0.7,
      });
      const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.08), lightMat);
      hlL.position.set(-0.55, 0.45, 1.72);
      grp.add(hlL);
      const hlR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.08), lightMat);
      hlR.position.set(0.55, 0.45, 1.72);
      grp.add(hlR);

      // Taillights
      const tailMat = new THREE.MeshStandardMaterial({
        color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 0.5,
      });
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.08), tailMat);
      tlL.position.set(-0.55, 0.45, -1.72);
      grp.add(tlL);
      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.08), tailMat);
      tlR.position.set(0.55, 0.45, -1.72);
      grp.add(tlR);

      // Wheels
      const wheelGeom = new THREE.CylinderGeometry(0.22, 0.22, 0.18, 14);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
      const wheels = [];
      const wp = [[-0.9, 0.22, 1.05], [0.9, 0.22, 1.05], [-0.9, 0.22, -1.05], [0.9, 0.22, -1.05]];
      for (const [wx, wy, wz] of wp) {
        const w = new THREE.Mesh(wheelGeom, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, wy, wz);
        grp.add(w);
        wheels.push(w);
      }

      grp.position.set(spawnX, 0, spawnZ);
      grp.rotation.y = spawnYaw;
      scene.add(grp);

      cars.push({
        group: grp,
        wheels,
        yaw: spawnYaw,
        velX: 0,
        velZ: 0,
        basePos: new THREE.Vector3(spawnX, 0, spawnZ),
        baseYaw: spawnYaw,
        targetX: spawnX,
        targetZ: spawnZ,
        targetYaw: spawnYaw,
        driverPeerId: null,
      });
    }

    makeCar(0xe02020, 0x801010, cx - 4.5, cz, Math.PI * 0.5);   // red
    makeCar(0x2060e0, 0x103080, cx - 1.5, cz, Math.PI * 0.5);   // blue
    makeCar(0x20b040, 0x106020, cx + 1.5, cz, Math.PI * 0.5);   // green
    makeCar(0xe0c020, 0x806010, cx + 4.5, cz, Math.PI * 0.5);   // yellow
  }

  // ---------- Type-race track (NE quadrant) ----------
  {
    const tw = RACE_TRACK_LEN + 2;
    const td = RACE_LANES * RACE_LANE_W + 2;
    const trackSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(tw, td),
      new THREE.MeshStandardMaterial({ color: 0x3a2020, roughness: 0.85 })
    );
    trackSurface.rotation.x = -Math.PI / 2;
    trackSurface.position.set(RACE_CX, 0.02, RACE_CZ);
    scene.add(trackSurface);

    for (let i = 0; i <= RACE_LANES; i++) {
      const z = laneZ(i) - RACE_LANE_W / 2;
      const ln = new THREE.Mesh(
        new THREE.PlaneGeometry(RACE_TRACK_LEN, 0.06),
        lineMat
      );
      ln.rotation.x = -Math.PI / 2;
      ln.position.set(RACE_CX, 0.03, z);
      scene.add(ln);
    }

    const startLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25, RACE_LANES * RACE_LANE_W),
      new THREE.MeshBasicMaterial({ color: 0x44ff44 })
    );
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.set(RACE_START_X, 0.035, RACE_CZ);
    scene.add(startLine);

    const finishLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25, RACE_LANES * RACE_LANE_W),
      new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    finishLine.rotation.x = -Math.PI / 2;
    finishLine.position.set(RACE_START_X + RACE_TRACK_LEN, 0.035, RACE_CZ);
    scene.add(finishLine);

    const racePad = new THREE.Mesh(
      new THREE.RingGeometry(RACE_PAD_R * 0.75, RACE_PAD_R, 48),
      new THREE.MeshBasicMaterial({ color: 0x44ff44, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    racePad.rotation.x = -Math.PI / 2;
    racePad.position.set(RACE_PAD_X, 0.04, RACE_CZ);
    scene.add(racePad);

    makeLamp(RACE_PAD_X, RACE_CZ + 10);
  }

  // ---------- Skyscrapers (distant ring) ----------
  // Procedural buildings beyond the play area. Each gets a tiled
  // window emissive map; updateDayNight ramps them up at night.
  {
    function makeWindowTexture() {
      const W = 64, H = 128;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const cols = 4, rows = 16;
      const cellW = W / cols, cellH = H / rows;
      for (let r = 0; r < rows; r++) {
        for (let cIdx = 0; cIdx < cols; cIdx++) {
          if (Math.random() < 0.55) {
            // Warm yellows, cool blue-whites, the occasional pink.
            const roll = Math.random();
            ctx.fillStyle = roll < 0.55 ? '#ffd88a'
                           : roll < 0.85 ? '#aedcff'
                           : '#ff8fd8';
            const pad = 3;
            ctx.fillRect(
              cIdx * cellW + pad, r * cellH + pad,
              cellW - pad * 2, cellH - pad * 2,
            );
          }
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    function makeSkyscraper(x, z, w, h, d) {
      const tex = makeWindowTexture();
      // Roughly one window column per 1.5m wide, one row per 2m tall.
      tex.repeat.set(Math.max(1, Math.round(w / 3)), Math.max(2, Math.round(h / 4)));
      tex.needsUpdate = true;
      const baseHue = 0x12101e + Math.floor(Math.random() * 0x101010);
      const mat = new THREE.MeshStandardMaterial({
        color: baseHue,
        roughness: 0.85,
        metalness: 0.15,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.08,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, h / 2, z);
      // Random yaw so faces don't all line up — gives the skyline depth.
      mesh.rotation.y = Math.random() * Math.PI * 2;
      scene.add(mesh);
      // Optional rooftop antenna / spire on the taller buildings.
      if (h > 55 && Math.random() < 0.55) {
        const spire = new THREE.Mesh(
          new THREE.CylinderGeometry(0.25, 0.7, 6, 8),
          new THREE.MeshStandardMaterial({
            color: 0x222033, emissive: 0xff4fd8, emissiveIntensity: 0.4,
          })
        );
        spire.position.set(x, h + 3, z);
        spire.rotation.y = mesh.rotation.y;
        scene.add(spire);
      }
      skyscrapers.push({ mat });
    }

    // Spread ~32 buildings around the perimeter at randomized distances.
    // Skip the wedge facing each existing sector portal so we don't
    // wall off the airfield approach with a tower.
    const COUNT = 36;
    for (let i = 0; i < COUNT; i++) {
      const baseAngle = (i / COUNT) * Math.PI * 2;
      const angle = baseAngle + (Math.random() - 0.5) * 0.18;
      const dist = 92 + Math.random() * 60;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const w = 7 + Math.random() * 12;
      const d = 7 + Math.random() * 12;
      // Inner ring shorter, outer ring taller for skyline depth.
      const tallness = (dist - 92) / 60;
      const h = 22 + Math.random() * 30 + tallness * 50;
      makeSkyscraper(x, z, w, h, d);
    }
  }
}

const PLAYER_RADIUS = 0.4;
const PLAYER_HEIGHT = 1.6;
const COL_EPS = 0.05;

function supportHeightAt(x, z, maxY) {
  let h = 0; // floor
  for (const p of parkourPlatforms) {
    if (Math.abs(x - p.x) < p.sx + PLAYER_RADIUS * 0.5 &&
        Math.abs(z - p.z) < p.sz + PLAYER_RADIUS * 0.5) {
      const top = p.y + p.sy;
      if (top <= maxY + 0.05 && top > h) h = top;
    }
  }
  return h;
}

// Side-hitbox test: does the player's body AABB overlap any platform's
// AABB at the given trial position? Used for separate-axis horizontal
// collision so you can slide along a wall instead of stopping dead.
function collidesAt(x, y, z) {
  const pyBot = y + COL_EPS;
  const pyTop = y + PLAYER_HEIGHT - COL_EPS;
  for (const p of parkourPlatforms) {
    if (Math.abs(x - p.x) >= p.sx + PLAYER_RADIUS) continue;
    if (Math.abs(z - p.z) >= p.sz + PLAYER_RADIUS) continue;
    const platTop = p.y + p.sy;
    const platBot = p.y - p.sy;
    if (pyTop > platBot + COL_EPS && pyBot < platTop - COL_EPS) return true;
  }
  return false;
}

const GRAVITY = 22;
const JUMP_IMPULSE = 10;
const MAX_RADIUS = 72;

function resolveHorizontal(dx, dz) {
  const tryX = player.pos.x + dx;
  if (Math.hypot(tryX, player.pos.z) <= MAX_RADIUS &&
      !collidesAt(tryX, player.pos.y, player.pos.z)) {
    player.pos.x = tryX;
  }
  const tryZ = player.pos.z + dz;
  if (Math.hypot(player.pos.x, tryZ) <= MAX_RADIUS &&
      !collidesAt(player.pos.x, player.pos.y, tryZ)) {
    player.pos.z = tryZ;
  }
}

// ------------------------------------------------------------------
// Label sprites (name tags, portal titles, chat bubbles)
// ------------------------------------------------------------------

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

function makeLabel(text, color = '#ffffff') {
  const str = String(text ?? '').slice(0, 80);
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const cx = c.getContext('2d');
  cx.font = 'bold 72px ui-sans-serif, system-ui, sans-serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  const metrics = cx.measureText(str);
  const pad = 44;
  const boxW = Math.min(c.width - 20, metrics.width + pad * 2);
  const boxH = 140;
  const bx = (c.width - boxW) / 2;
  const by = (c.height - boxH) / 2;
  cx.fillStyle = 'rgba(10, 5, 20, 0.78)';
  roundRect(cx, bx, by, boxW, boxH, 28);
  cx.fill();
  cx.strokeStyle = color;
  cx.lineWidth = 4;
  cx.stroke();
  cx.fillStyle = color;
  cx.fillText(str, c.width / 2, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = c.width / c.height;
  sprite.scale.set(4.5, 4.5 / aspect, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function disposeSprite(sprite) {
  if (!sprite) return;
  if (sprite.material?.map) sprite.material.map.dispose();
  if (sprite.material) sprite.material.dispose();
}

// ------------------------------------------------------------------
// Cute bean avatar
// ------------------------------------------------------------------
//
// Hierarchy:
//   group            — world placement + rotation, bubble + nameTag attach here
//     body (group)   — animated (idle bob + walk bob)
//       torso
//       eyes (whites + pupils)
//       leftArm (group, pivots at shoulder)
//         armMesh
//       rightArm ...
//       leftLeg (group, pivots at hip)
//         legMesh
//       rightLeg ...

function makeAvatar(colorHex, name) {
  const hex = (colorHex || 'ffffff').replace('#', '');
  const color = new THREE.Color('#' + hex);
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    roughness: 0.45,
    metalness: 0.1,
  });

  const group = new THREE.Group();

  const body = new THREE.Group();
  body.position.y = 0.8;
  group.add(body);

  // Torso (slightly tall sphere)
  const torso = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 22, 18),
    bodyMat
  );
  torso.scale.set(1, 1.22, 1);
  body.add(torso);

  // Eyes — whites + pupils, on the front (+Z in local space).
  const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeBlackMat = new THREE.MeshBasicMaterial({ color: 0x120826 });
  const eyeWGeom = new THREE.SphereGeometry(0.1, 14, 12);
  const eyePGeom = new THREE.SphereGeometry(0.048, 10, 8);
  const eyeOffsets = [-0.14, 0.14];
  for (const dx of eyeOffsets) {
    const w = new THREE.Mesh(eyeWGeom, eyeWhiteMat);
    w.position.set(dx, 0.18, 0.34);
    body.add(w);
    const p = new THREE.Mesh(eyePGeom, eyeBlackMat);
    p.position.set(dx, 0.18, 0.42);
    body.add(p);
  }

  // Mouth — a tiny dark ellipse on the front.
  const mouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 10, 8),
    eyeBlackMat
  );
  mouth.scale.set(1.4, 0.55, 0.4);
  mouth.position.set(0, 0.02, 0.43);
  body.add(mouth);

  // Arms — pivot at shoulder, ball mesh hanging below
  const armGeom = new THREE.SphereGeometry(0.13, 14, 12);
  function makeLimb(x, y, z, meshOffsetY) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = new THREE.Mesh(armGeom, bodyMat);
    mesh.position.y = meshOffsetY;
    pivot.add(mesh);
    return pivot;
  }
  const leftArm  = makeLimb(-0.44, 0.05, 0, -0.18);
  const rightArm = makeLimb( 0.44, 0.05, 0, -0.18);
  body.add(leftArm, rightArm);

  // Legs — pivot at hip, stubby cylinder hanging below
  const legGeom = new THREE.CylinderGeometry(0.11, 0.11, 0.34, 12);
  function makeLeg(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.42, 0);
    const mesh = new THREE.Mesh(legGeom, bodyMat);
    mesh.position.y = -0.17;
    pivot.add(mesh);
    return pivot;
  }
  const leftLeg  = makeLeg(-0.18);
  const rightLeg = makeLeg( 0.18);
  body.add(leftLeg, rightLeg);

  // Name tag floats above group (not body), stays steady while body bobs.
  const nameTag = makeLabel(name || '?', '#' + hex);
  nameTag.position.set(0, 2.15, 0);
  nameTag.scale.multiplyScalar(0.55);
  group.add(nameTag);

  group.userData = {
    body,
    leftArm, rightArm,
    leftLeg, rightLeg,
    nameTag,
    colorHex: '#' + hex,
    animTime: Math.random() * 5, // desync idle bobs between peers
    armSwing: 0,
    legSwing: 0,
    bodyBaseY: 0.8,
    bubble: null,
    bubbleExpires: 0,
    emoteName: null,
    emoteStart: 0,
  };
  return group;
}

function setAvatarName(group, name, colorHex) {
  const ud = group.userData;
  if (ud.nameTag) {
    group.remove(ud.nameTag);
    disposeSprite(ud.nameTag);
  }
  const tag = makeLabel(name || '?', colorHex || ud.colorHex);
  tag.position.set(0, 2.15, 0);
  tag.scale.multiplyScalar(0.55);
  group.add(tag);
  ud.nameTag = tag;
}

// ------------------------------------------------------------------
// Emotes
// ------------------------------------------------------------------
// Each emote.apply(ud, t) directly sets pose fields. We call return
// after apply so the normal animation path doesn't overwrite them.
// On cancel (timeout / movement / jump) we zero the extra rotation.z
// so the limbs snap cleanly back into the normal anim envelope.

const EMOTES = {
  wave: {
    label: 'Wave', icon: '👋', duration: 2.6,
    apply(ud, t) {
      ud.rightArm.rotation.x = -2.9;
      ud.rightArm.rotation.y = Math.sin(t * 7) * 0.45;
      ud.rightArm.rotation.z = 0;
      ud.leftArm.rotation.x = 0;
      ud.leftArm.rotation.y = 0;
      ud.leftArm.rotation.z = 0;
      ud.leftLeg.rotation.x = 0;
      ud.rightLeg.rotation.x = 0;
      ud.body.position.y = ud.bodyBaseY + Math.sin(t * 3) * 0.03;
    },
  },
  dance: {
    label: 'Dance', icon: '🕺', duration: 4.2,
    apply(ud, t) {
      const s = Math.sin(t * 6);
      const c = Math.cos(t * 6);
      ud.leftArm.rotation.x = -1.1 + s * 0.8;
      ud.rightArm.rotation.x = -1.1 - s * 0.8;
      ud.leftArm.rotation.z = 0.4 + c * 0.2;
      ud.rightArm.rotation.z = -0.4 - c * 0.2;
      ud.leftArm.rotation.y = 0;
      ud.rightArm.rotation.y = 0;
      ud.leftLeg.rotation.x = s * 0.45;
      ud.rightLeg.rotation.x = -s * 0.45;
      ud.body.position.y = ud.bodyBaseY + Math.abs(s) * 0.12;
    },
  },
  point: {
    label: 'Point', icon: '👉', duration: 2.2,
    apply(ud, t) {
      const lift = Math.min(1, t * 6);
      ud.rightArm.rotation.x = -Math.PI / 2 * lift;
      ud.rightArm.rotation.y = 0;
      ud.rightArm.rotation.z = 0;
      ud.leftArm.rotation.x = 0;
      ud.leftArm.rotation.y = 0;
      ud.leftArm.rotation.z = 0;
      ud.leftLeg.rotation.x = 0;
      ud.rightLeg.rotation.x = 0;
      ud.body.position.y = ud.bodyBaseY;
    },
  },
  shrug: {
    label: 'Shrug', icon: '🤷', duration: 2.2,
    apply(ud, t) {
      const lift = Math.min(1, t * 5) * 0.75;
      ud.leftArm.rotation.x = -0.25;
      ud.rightArm.rotation.x = -0.25;
      ud.leftArm.rotation.z = lift;
      ud.rightArm.rotation.z = -lift;
      ud.leftArm.rotation.y = 0;
      ud.rightArm.rotation.y = 0;
      ud.leftLeg.rotation.x = 0;
      ud.rightLeg.rotation.x = 0;
      ud.body.position.y = ud.bodyBaseY - lift * 0.06;
    },
  },
  cheer: {
    label: 'Cheer', icon: '🙌', duration: 2.8,
    apply(ud, t) {
      const s = Math.abs(Math.sin(t * 7));
      ud.leftArm.rotation.x = -2.8;
      ud.rightArm.rotation.x = -2.8;
      ud.leftArm.rotation.z = 0.3 + s * 0.25;
      ud.rightArm.rotation.z = -0.3 - s * 0.25;
      ud.leftArm.rotation.y = 0;
      ud.rightArm.rotation.y = 0;
      ud.leftLeg.rotation.x = 0;
      ud.rightLeg.rotation.x = 0;
      ud.body.position.y = ud.bodyBaseY + s * 0.14;
    },
  },
  laugh: {
    label: 'Laugh', icon: '😆', duration: 2.4,
    apply(ud, t) {
      const s = Math.sin(t * 14);
      ud.body.position.y = ud.bodyBaseY + Math.abs(s) * 0.09;
      ud.leftArm.rotation.x = -0.4 + s * 0.2;
      ud.rightArm.rotation.x = -0.4 - s * 0.2;
      ud.leftArm.rotation.z = 0.2;
      ud.rightArm.rotation.z = -0.2;
      ud.leftArm.rotation.y = 0;
      ud.rightArm.rotation.y = 0;
      ud.leftLeg.rotation.x = 0;
      ud.rightLeg.rotation.x = 0;
    },
  },
  sit: {
    label: 'Sit', icon: '🪑', duration: 5,
    apply(ud, t) {
      const drop = Math.min(1, t * 4) * 0.45;
      ud.body.position.y = ud.bodyBaseY - drop;
      ud.leftLeg.rotation.x = -Math.PI / 2 * Math.min(1, t * 3);
      ud.rightLeg.rotation.x = -Math.PI / 2 * Math.min(1, t * 3);
      ud.leftArm.rotation.x = 0;
      ud.rightArm.rotation.x = 0;
      ud.leftArm.rotation.z = 0.2;
      ud.rightArm.rotation.z = -0.2;
      ud.leftArm.rotation.y = 0;
      ud.rightArm.rotation.y = 0;
    },
  },
  sleep: {
    label: 'Sleep', icon: '💤', duration: 5,
    apply(ud, t) {
      const drop = Math.min(1, t * 3) * 0.55;
      ud.body.position.y = ud.bodyBaseY - drop + Math.sin(t * 2) * 0.02;
      ud.leftLeg.rotation.x = -0.4;
      ud.rightLeg.rotation.x = -0.4;
      ud.leftArm.rotation.x = -0.2;
      ud.rightArm.rotation.x = -0.2;
      ud.leftArm.rotation.z = 0.5;
      ud.rightArm.rotation.z = -0.5;
      ud.leftArm.rotation.y = 0;
      ud.rightArm.rotation.y = 0;
    },
  },
};

function resetEmotePose(ud) {
  ud.leftArm.rotation.z = 0;
  ud.rightArm.rotation.z = 0;
  ud.leftArm.rotation.y = 0;
  ud.rightArm.rotation.y = 0;
  ud.armSwing = 0;
  ud.legSwing = 0;
}

function animateAvatar(group, dt, isMoving, grounded = true) {
  const ud = group.userData;
  ud.animTime += dt;
  const t = ud.animTime;

  // Emote playback overrides normal animation.
  if (ud.emoteName) {
    const emote = EMOTES[ud.emoteName];
    const elapsed = (performance.now() - ud.emoteStart) / 1000;
    const cancel = !emote || elapsed >= emote.duration || isMoving || !grounded;
    if (!cancel) {
      emote.apply(ud, elapsed);
      return;
    }
    ud.emoteName = null;
    resetEmotePose(ud);
  }

  if (!grounded) {
    // Airborne: hold pose, no bob.
    ud.body.position.y = ud.bodyBaseY;
    const k = Math.min(1, dt * 6);
    ud.armSwing += (0 - ud.armSwing) * k;
    ud.legSwing += (0 - ud.legSwing) * k;
  } else if (isMoving) {
    // Walking: faster swing + bob
    const freq = 9;
    const s = Math.sin(t * freq);
    const targetArm = s * 0.85;
    const targetLeg = s * 0.65;
    const k = Math.min(1, dt * 18);
    ud.armSwing += (targetArm - ud.armSwing) * k;
    ud.legSwing += (targetLeg - ud.legSwing) * k;
    ud.body.position.y = ud.bodyBaseY + Math.abs(s) * 0.08;
  } else {
    // Idle: gentle bob, ease limbs back to rest
    const bob = Math.sin(t * 2.2) * 0.045;
    ud.body.position.y = ud.bodyBaseY + bob;
    const k = Math.min(1, dt * 6);
    ud.armSwing += (0 - ud.armSwing) * k;
    ud.legSwing += (0 - ud.legSwing) * k;
  }

  ud.leftArm.rotation.x  =  ud.armSwing;
  ud.rightArm.rotation.x = -ud.armSwing;
  ud.leftLeg.rotation.x  = -ud.legSwing;
  ud.rightLeg.rotation.x =  ud.legSwing;
}

// ------------------------------------------------------------------
// Player setup
// ------------------------------------------------------------------

const player = {
  group: makeAvatar(incoming.color, username),
  pos: new THREE.Vector3(0, 0, 0),
  velY: 0,
  grounded: true,
  yaw: 0,
  speed: incoming.speed || 5,
  isMoving: false,
  seatedBench: null,
  piloting: false,
  flipping: false,
  flipPitch: 0,
  flipAngVel: 0,
  flipBackVx: 0,
  flipBackVz: 0,
  ragdolling: false,
  ragdollEnd: 0,
  ragdollPitch: 0,
  knockVx: 0,
  knockVz: 0,
  climbingLadder: null,
  driving: null, // index into cars[], or null
};

const CLIMB_SPEED = 4;
// YXZ order so flip-pitch (rotation.x) is applied AFTER yaw, in the
// avatar's facing-relative frame — backflips read as backflips no
// matter which way the player happened to be looking.
player.group.rotation.order = 'YXZ';
scene.add(player.group);

const FLIP_JUMP_IMPULSE = 12;
const FLIP_BACK_SPEED = 5;
// Tuned so a flat-ground flip (flight time ~1.1s) lands almost
// exactly at one full -2π rotation. Flips off taller ledges have
// longer flight time → over-rotation → ragdoll on landing, which
// is the intended skill curve.
const FLIP_ANG_VEL = -5.7;
const FLIP_LAND_TOLERANCE = Math.PI / 3.5;
const RAGDOLL_DURATION = 2400;

function tryBackflip() {
  if (player.flipping || player.ragdolling) return;
  if (!player.grounded) return;
  if (player.seatedBench || player.piloting || player.driving !== null || race.active) return;
  dropHeldBallIfAny();
  player.flipping = true;
  player.flipPitch = 0;
  player.flipAngVel = FLIP_ANG_VEL;
  player.velY = FLIP_JUMP_IMPULSE;
  player.grounded = false;
  // Backward in player's facing frame
  player.flipBackVx = -Math.sin(player.yaw) * FLIP_BACK_SPEED;
  player.flipBackVz = -Math.cos(player.yaw) * FLIP_BACK_SPEED;
}

function startRagdoll(landingPitch) {
  player.ragdolling = true;
  player.ragdollEnd = performance.now() + RAGDOLL_DURATION;
  player.ragdollPitch = landingPitch;
  player.flipping = false;
  player.flipBackVx = 0;
  player.flipBackVz = 0;
  showToast('OOF');
}

function startCarHitRagdoll(nx, nz, carSpeed) {
  if (player.ragdolling || player.driving !== null) return;
  if (player.seatedBench) return;
  dropHeldBallIfAny();
  if (player.flipping) {
    player.flipping = false;
    player.flipBackVx = 0;
    player.flipBackVz = 0;
  }
  const hitForce = Math.max(6, carSpeed * 0.9);
  player.knockVx = nx * hitForce;
  player.knockVz = nz * hitForce;
  player.velY = Math.min(8, carSpeed * 0.4);
  player.grounded = false;
  // Tumble pitch: tilt forward in the hit direction
  const hitAngle = Math.atan2(nx, nz);
  startRagdoll(hitAngle > 0 ? 1.2 : -1.2);
}

function endRagdoll() {
  player.ragdolling = false;
  player.knockVx = 0;
  player.knockVz = 0;
  player.flipPitch = 0;
  player.group.rotation.x = 0;
}

const SIT_RANGE = 2.2;
const PLANE_RANGE = 4.5;
const PLANE_CRUISE = 16;
const PLANE_BOOST = 30;
const PLANE_TURN_RATE = 1.0;
const PLANE_PITCH_RATE = 0.9;
const PLANE_MIN_Y = 1.5;
const PLANE_MAX_Y = 60;
const PLANE_MAX_RADIUS = 240;

function dropHeldBallIfAny() {
  if (balls.some(b => b.heldLocal)) tryTogglePickup();
}

function trySitDown() {
  let best = null;
  let bestD2 = SIT_RANGE * SIT_RANGE;
  for (const b of benches) {
    const dx = player.pos.x - b.x;
    const dz = player.pos.z - b.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = b; }
  }
  if (!best) return false;
  dropHeldBallIfAny();
  player.seatedBench = best;
  player.velY = 0;
  player.grounded = true;
  return true;
}

function standUp() {
  const b = player.seatedBench;
  if (!b) return;
  player.seatedBench = null;
  // Step off the front of the bench so the player isn't clipping it.
  const fx = Math.sin(b.yaw);
  const fz = Math.cos(b.yaw);
  player.pos.set(b.x + fx * 1.2, 0, b.z + fz * 1.2);
  player.yaw = b.yaw;
  player.velY = 0;
  player.grounded = true;
  const ud = player.group.userData;
  ud.emoteName = null;
  resetEmotePose(ud);
}

function tryEnterPlane() {
  if (!plane) return false;
  const dx = player.pos.x - plane.group.position.x;
  const dz = player.pos.z - plane.group.position.z;
  if (dx * dx + dz * dz > PLANE_RANGE * PLANE_RANGE) return false;
  dropHeldBallIfAny();
  player.piloting = true;
  player.group.visible = false;
  return true;
}

function exitPlane() {
  if (!plane) return;
  player.piloting = false;
  player.group.visible = true;
  // Drop the player onto the ground at the plane's XZ so they don't fall from altitude.
  player.pos.set(plane.group.position.x, 0, plane.group.position.z);
  player.yaw = plane.group.rotation.y;
  player.velY = 0;
  player.grounded = true;
  // Reset the plane back to its parked pose and re-peg the lerp targets
  // so the non-local-pilot path doesn't fight us back toward old targets.
  plane.group.position.copy(plane.basePos);
  plane.group.rotation.set(0, plane.baseYaw, 0);
  plane.pitch = 0;
  plane.targetX = plane.basePos.x;
  plane.targetY = plane.basePos.y;
  plane.targetZ = plane.basePos.z;
  plane.targetYaw = plane.baseYaw;
  plane.targetPitch = 0;
  // Push one broadcast right now so peers see the final piloting=false
  // + reset pose immediately instead of waiting up to ~80ms.
  broadcastSelf();
}

function updatePlane(dt) {
  const p = plane;
  const boosting = !!(keys[' '] || keys['spacebar']);
  const speed = boosting ? PLANE_BOOST : PLANE_CRUISE;

  if (!isMenuOpen()) {
    if (keys['a'] || keys['arrowleft'])  p.group.rotation.y += PLANE_TURN_RATE * dt;
    if (keys['d'] || keys['arrowright']) p.group.rotation.y -= PLANE_TURN_RATE * dt;
    if (keys['w'] || keys['arrowup'])    p.pitch -= PLANE_PITCH_RATE * dt;
    if (keys['s'] || keys['arrowdown'])  p.pitch += PLANE_PITCH_RATE * dt;
  }
  if (p.pitch >  0.7) p.pitch =  0.7;
  if (p.pitch < -0.7) p.pitch = -0.7;
  p.group.rotation.x = p.pitch;

  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(p.group.quaternion);
  p.group.position.addScaledVector(fwd, speed * dt);

  if (p.group.position.y < PLANE_MIN_Y) {
    p.group.position.y = PLANE_MIN_Y;
    if (p.pitch < 0) p.pitch = 0;
  }
  if (p.group.position.y > PLANE_MAX_Y) {
    p.group.position.y = PLANE_MAX_Y;
    if (p.pitch > 0) p.pitch = 0;
  }
  const r = Math.hypot(p.group.position.x, p.group.position.z);
  if (r > PLANE_MAX_RADIUS) {
    const k = PLANE_MAX_RADIUS / r;
    p.group.position.x *= k;
    p.group.position.z *= k;
  }

  p.prop.rotation.z += (boosting ? 60 : 35) * dt;
}

// ------------------------------------------------------------------
// Racecar driving
// ------------------------------------------------------------------

const CAR_RANGE = 3.5;
const CAR_ACCEL = 20;
const CAR_BRAKE = 28;
const CAR_MAX_SPEED = 22;
const CAR_STEER_RATE = 2.8;
const CAR_FWD_DRAG = 0.6;   // mild forward drag
const CAR_LAT_DRAG = 3.5;   // higher lateral drag = grip, but loose enough to drift
const CAR_MAX_RADIUS = 68;

let sendCarAction = null;
let lastCarIdx = null;       // track which car we just exited for one final broadcast

function tryEnterCar() {
  if (player.driving !== null) return false;
  let bestIdx = -1;
  let bestD2 = CAR_RANGE * CAR_RANGE;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (c.driverPeerId) continue; // someone else is driving
    const dx = player.pos.x - c.group.position.x;
    const dz = player.pos.z - c.group.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
  }
  if (bestIdx < 0) return false;
  dropHeldBallIfAny();
  player.driving = bestIdx;
  player.group.visible = false;
  cars[bestIdx].driverPeerId = 'local';
  cars[bestIdx].velX = 0;
  cars[bestIdx].velZ = 0;
  return true;
}

function exitCar() {
  if (player.driving === null) return;
  const car = cars[player.driving];
  car.driverPeerId = null;
  car.velX = 0;
  car.velZ = 0;
  // Drop player to the side of the car
  const sideX = -Math.cos(car.yaw);
  const sideZ = Math.sin(car.yaw);
  player.pos.set(
    car.group.position.x + sideX * 2.2,
    0,
    car.group.position.z + sideZ * 2.2,
  );
  player.yaw = car.yaw;
  player.velY = 0;
  player.grounded = true;
  player.group.visible = true;
  // Broadcast the parked car position
  lastCarIdx = player.driving;
  player.driving = null;
  broadcastCarState(lastCarIdx, false);
  broadcastSelf();
}

function broadcastCarState(idx, driving) {
  if (!sendCarAction) return;
  const car = cars[idx];
  sendCarAction({
    idx,
    x: car.group.position.x,
    z: car.group.position.z,
    yaw: car.yaw,
    driving,
  });
}

function updateCar(dt) {
  const car = cars[player.driving];

  let accel = 0, steer = 0;
  if (!isMenuOpen()) {
    if (keys['w'] || keys['arrowup'])    accel += 1;
    if (keys['s'] || keys['arrowdown'])  accel -= 1;
    if (keys['a'] || keys['arrowleft'])  steer += 1;
    if (keys['d'] || keys['arrowright']) steer -= 1;
  }

  // Speed-dependent steering: can't turn when stopped
  const speed = Math.hypot(car.velX, car.velZ);
  const steerFactor = Math.min(1, speed / 4);
  car.yaw += steer * CAR_STEER_RATE * steerFactor * dt;

  // Forward / backward thrust in car's facing direction
  const fwdX = Math.sin(car.yaw);
  const fwdZ = Math.cos(car.yaw);

  if (accel > 0) {
    car.velX += fwdX * CAR_ACCEL * dt;
    car.velZ += fwdZ * CAR_ACCEL * dt;
  } else if (accel < 0) {
    car.velX -= fwdX * CAR_BRAKE * dt;
    car.velZ -= fwdZ * CAR_BRAKE * dt;
  }

  // Decompose velocity into forward and lateral components for drift physics
  const fwdDot = car.velX * fwdX + car.velZ * fwdZ;
  const latX = car.velX - fwdDot * fwdX;
  const latZ = car.velZ - fwdDot * fwdZ;

  const fwdFric = Math.exp(-CAR_FWD_DRAG * dt);
  const latFric = Math.exp(-CAR_LAT_DRAG * dt);
  car.velX = fwdDot * fwdX * fwdFric + latX * latFric;
  car.velZ = fwdDot * fwdZ * fwdFric + latZ * latFric;

  // Speed cap
  const newSpeed = Math.hypot(car.velX, car.velZ);
  if (newSpeed > CAR_MAX_SPEED) {
    const s = CAR_MAX_SPEED / newSpeed;
    car.velX *= s;
    car.velZ *= s;
  }

  // Move
  car.group.position.x += car.velX * dt;
  car.group.position.z += car.velZ * dt;
  car.group.position.y = 0;

  // World boundary
  const r = Math.hypot(car.group.position.x, car.group.position.z);
  if (r > CAR_MAX_RADIUS) {
    const k = CAR_MAX_RADIUS / r;
    car.group.position.x *= k;
    car.group.position.z *= k;
    const nx = car.group.position.x / CAR_MAX_RADIUS;
    const nz = car.group.position.z / CAR_MAX_RADIUS;
    const dot = car.velX * nx + car.velZ * nz;
    if (dot > 0) { car.velX -= dot * nx; car.velZ -= dot * nz; }
  }

  car.group.rotation.y = car.yaw;

  // Spin wheels
  const wheelAngVel = fwdDot / 0.22;
  for (const w of car.wheels) w.rotation.x += wheelAngVel * dt;
}

// ------------------------------------------------------------------
// Type-racing logic
// ------------------------------------------------------------------

const raceOverlay = document.getElementById('race-overlay');
const raceCountdownEl = document.getElementById('race-countdown');
const raceTypedEl = document.getElementById('race-typed');
const raceCursorEl = document.getElementById('race-cursor');
const raceRemainingEl = document.getElementById('race-remaining');
const raceStatsEl = document.getElementById('race-stats');

function joinRace() {
  if (race.active) return;
  dropHeldBallIfAny();
  race.active = true;
  race.countdown = 3;
  race.countdownEnd = performance.now() + 3000;
  race.sentenceIdx = pickSharedSentenceIdx();
  race.sentence = RACE_SENTENCES[race.sentenceIdx];
  race.typed = 0;
  race.errors = 0;
  race.pos = 0;
  race.vel = 0;
  race.finished = false;
  race.finishTime = 0;
  race.startTime = 0;
  race.errorFlash = 0;
  race.lane = 0;
  race.nextPeerLane = 1;

  const hex = parseInt(incoming.color, 16) || 0xff4444;
  race.animal = makeRaceAnimal(hex);
  race.animal.position.set(RACE_START_X, 0, laneZ(0));
  scene.add(race.animal);

  player.group.visible = false;
  player.isMoving = false;
  if (raceOverlay) raceOverlay.hidden = false;
  updateRaceUI();
}

function forfeitRace() {
  endRace();
}

function finishRace() {
  race.finished = true;
  race.finishTime = performance.now() - race.startTime;
  const wpm = computeWPM();
  showToast('FINISHED — ' + Math.round(race.finishTime / 10) / 100 + 's · ' + wpm + ' WPM');
  setTimeout(endRace, 2000);
}

function endRace() {
  race.active = false;
  race.finished = false;
  if (race.animal) { scene.remove(race.animal); race.animal = null; }
  for (const [, pa] of race.peerAnimals) { scene.remove(pa.animal); }
  race.peerAnimals.clear();
  race.nextPeerLane = 1;
  player.group.visible = true;
  if (raceOverlay) raceOverlay.hidden = true;
}

function computeWPM() {
  if (!race.startTime) return 0;
  const minutes = (performance.now() - race.startTime) / 60000;
  return minutes > 0.001 ? Math.round((race.typed / 5) / minutes) : 0;
}

function handleRaceKey(e) {
  if (!race.active) return false;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); forfeitRace(); return true; }
  if (race.countdown > 0 || race.finished) return true; // swallow
  if (k.length !== 1) return true; // ignore modifier-only presses

  const expected = race.sentence[race.typed];
  if (k === expected) {
    race.typed++;
    race.vel += RACE_SPEED_BOOST;
    race.errorFlash = 0;
    if (race.typed >= race.sentence.length) finishRace();
  } else {
    race.errors++;
    race.vel *= RACE_ERROR_MULT;
    race.errorFlash = performance.now() + 250;
  }
  updateRaceUI();
  return true;
}

function updateRaceUI() {
  if (!raceOverlay || !race.active) return;
  if (race.countdown > 0) {
    const remaining = Math.max(0, race.countdownEnd - performance.now());
    const digit = Math.ceil(remaining / 1000);
    if (raceCountdownEl) raceCountdownEl.textContent = digit > 0 ? String(digit) : 'GO!';
  } else {
    if (raceCountdownEl) raceCountdownEl.textContent = '';
  }
  if (raceTypedEl) raceTypedEl.textContent = race.sentence.slice(0, race.typed);
  if (raceCursorEl) raceCursorEl.textContent = race.sentence[race.typed] || '';
  if (raceRemainingEl) raceRemainingEl.textContent = race.sentence.slice(race.typed + 1);
  const flash = race.errorFlash && performance.now() < race.errorFlash;
  if (raceOverlay) raceOverlay.classList.toggle('race-error', flash);
  if (raceStatsEl) {
    const wpm = computeWPM();
    raceStatsEl.textContent =
      (race.startTime ? wpm + ' WPM' : '') +
      (race.errors ? ' · ' + race.errors + ' error' + (race.errors > 1 ? 's' : '') : '');
  }
}

function updateRace(dt) {
  if (!race.active) return;
  // Countdown phase
  if (race.countdown > 0) {
    const remaining = race.countdownEnd - performance.now();
    if (remaining <= 0) {
      race.countdown = 0;
      race.startTime = performance.now();
    }
    updateRaceUI();
  }
  // Physics
  race.vel *= RACE_FRICTION;
  race.pos += race.vel * dt;
  if (race.pos < 0) race.pos = 0;
  if (race.animal) {
    race.animal.position.x = RACE_START_X + race.pos;
    animateRaceAnimal(race.animal, race.vel, dt);
  }
  // Peer animals: lerp toward their target
  for (const [, pa] of race.peerAnimals) {
    const k = Math.min(1, dt * 8);
    pa.pos += (pa.targetPos - pa.pos) * k;
    pa.animal.position.x = RACE_START_X + pa.pos;
    animateRaceAnimal(pa.animal, (pa.targetPos - pa.pos) * 8, dt);
  }
  // Snap player pos to track during race so camera/broadcast make sense.
  player.pos.set(RACE_CX, 0, RACE_CZ);
  player.velY = 0;
  player.grounded = true;
}

function checkRacePad() {
  const dx = player.pos.x - RACE_PAD_X;
  const dz = player.pos.z - RACE_CZ;
  const on = (dx * dx + dz * dz) < (RACE_PAD_R * RACE_PAD_R) && player.pos.y < 1.5;
  if (on && !race.onPad && !race.active) {
    joinRace();
  }
  race.onPad = on;
}

// Orbit camera — pointer-lock mouse look.
let camYaw = 0;
let camPitch = 0.35;
let camDistance = 6;
const CAM_PITCH_MIN = -0.15;
const CAM_PITCH_MAX = 1.2;
const CAM_DISTANCE_MIN = 3;
const CAM_DISTANCE_MAX = 14;
const MOUSE_SENS = 0.0028;
let pointerLocked = false;

function updateCamera(dt) {
  if (race.active) {
    // Elevated side view of the track.
    const tx = RACE_CX;
    const ty = 12;
    const tz = RACE_CZ + 16;
    const k = Math.min(1, dt * 5);
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (tz - camera.position.z) * k;
    camera.lookAt(RACE_CX, 0, RACE_CZ);
    return;
  }
  if (player.driving !== null) {
    // Chase camera behind the car
    const car = cars[player.driving];
    const behindX = car.group.position.x - Math.sin(car.yaw) * 7;
    const behindZ = car.group.position.z - Math.cos(car.yaw) * 7;
    const k = Math.min(1, dt * 5);
    camera.position.x += (behindX - camera.position.x) * k;
    camera.position.y += (3.5 - camera.position.y) * k;
    camera.position.z += (behindZ - camera.position.z) * k;
    camera.lookAt(car.group.position.x, 0.6, car.group.position.z);
    return;
  }
  if (player.piloting && plane) {
    // Chase camera: sit behind + above the plane, looking at the nose.
    const back = new THREE.Vector3(0, 2.2, -9).applyQuaternion(plane.group.quaternion);
    const targetX = plane.group.position.x + back.x;
    const targetY = plane.group.position.y + back.y;
    const targetZ = plane.group.position.z + back.z;
    const k = Math.min(1, dt * 6);
    camera.position.x += (targetX - camera.position.x) * k;
    camera.position.y += (targetY - camera.position.y) * k;
    camera.position.z += (targetZ - camera.position.z) * k;
    camera.lookAt(plane.group.position.x, plane.group.position.y, plane.group.position.z);
    return;
  }
  const horizR = camDistance * Math.cos(camPitch);
  const targetX = player.pos.x + Math.sin(camYaw) * horizR;
  const targetY = player.pos.y + 1.2 + Math.sin(camPitch) * camDistance;
  const targetZ = player.pos.z + Math.cos(camYaw) * horizR;
  const k = Math.min(1, dt * 14);
  camera.position.x += (targetX - camera.position.x) * k;
  camera.position.y += (targetY - camera.position.y) * k;
  camera.position.z += (targetZ - camera.position.z) * k;
  camera.lookAt(player.pos.x, player.pos.y + 1.2, player.pos.z);
}

// Snap camera on first frame.
{
  const horizR = camDistance * Math.cos(camPitch);
  camera.position.set(
    player.pos.x + Math.sin(camYaw) * horizR,
    player.pos.y + 1.2 + Math.sin(camPitch) * camDistance,
    player.pos.z + Math.cos(camYaw) * horizR
  );
  camera.lookAt(player.pos.x, player.pos.y + 1.2, player.pos.z);
}

// ------------------------------------------------------------------
// Portals
// ------------------------------------------------------------------

const portals = [];

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

function makePortal({ title, url, colorHex, position, radius = 1.8, thumbnailUrl = null, flipThumbY = false }) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.lookAt(new THREE.Vector3(0, position.y, 0));

  const color = new THREE.Color(colorHex);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.24, 20, 64),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.6,
      roughness: 0.3,
      metalness: 0.4,
    })
  );
  group.add(ring);

  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(radius - 0.15, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    })
  );
  group.add(disk);

  const light = new THREE.PointLight(color, 0.9, 10);
  light.position.set(0, 0, 0.5);
  group.add(light);

  const label = makeLabel(title, colorHex);
  label.position.set(0, radius + 1.1, 0);
  group.add(label);

  scene.add(group);
  const entry = { group, ring, disk, label, url, title, radius, thumbLoaded: false };
  portals.push(entry);

  if (thumbnailUrl) {
    textureLoader.load(
      thumbnailUrl,
      tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        if (flipThumbY) {
          tex.center.set(0.5, 0.5);
          tex.repeat.set(1, -1);
        }
        disk.material.map = tex;
        disk.material.color.set(0xffffff);
        disk.material.opacity = 0.92;
        disk.material.needsUpdate = true;
        entry.thumbLoaded = true;
      },
      undefined,
      err => console.warn('[lobby] thumbnail failed for', title, err)
    );
  }

  return group;
}

function resolveThumb(game) {
  if (!game || !game.thumbnail) return null;
  try { return new URL(game.thumbnail, Portal.REGISTRY_URL).href; } catch { return null; }
}

function normalizeUrl(u) {
  return String(u || '').split('?')[0].replace(/\/$/, '');
}

async function setupPortals() {
  const games = await Portal.fetchJamRegistry();
  const here = normalizeUrl(window.location.href);
  const entries = games.filter(g => g && g.url && !here.startsWith(normalizeUrl(g.url)));

  // Walk the inner perimeter of the building square. Returns a position
  // hugging the inside of one of the four walls plus the world point
  // the portal should face (the atrium center at the same height).
  const PORTAL_INSET = BUILDING_HALF - 2.0;
  const PORTAL_TANGENT_HALF = BUILDING_HALF - BUILDING_DOOR_HALF - 2.0;
  function perimeterSlot(t, y) {
    // t in [0,1) walks N → E → S → W
    const u = (t * 4) % 4;
    const side = Math.floor(u);
    const local = (u - side) * 2 - 1; // -1..+1
    const along = local * PORTAL_TANGENT_HALF;
    let x, z;
    if (side === 0)      { x = along; z = -PORTAL_INSET; }
    else if (side === 1) { x = PORTAL_INSET; z = along; }
    else if (side === 2) { x = along; z = PORTAL_INSET; }
    else                 { x = -PORTAL_INSET; z = along; }
    return new THREE.Vector3(x, y, z);
  }

  // Round-robin across the three floors, spread evenly within each floor.
  const FLOORS = FLOOR_Y.length;
  const buckets = Array.from({ length: FLOORS }, () => []);
  entries.forEach((g, i) => buckets[i % FLOORS].push(g));

  const totalN = Math.max(entries.length, 1);
  let order = 0;
  buckets.forEach((floorGames, floorIdx) => {
    const py = FLOOR_Y[floorIdx] + 2.4;
    floorGames.forEach((g, j) => {
      // Stagger starting offsets per floor so portals don't stack vertically.
      const t = ((j + 0.5) / floorGames.length + floorIdx * 0.08) % 1;
      const hue = Math.round((order / totalN) * 360);
      const color = new THREE.Color(`hsl(${hue}, 85%, 62%)`);
      const colorHex = '#' + color.getHexString();
      makePortal({
        title: g.title || g.id || 'mystery game',
        url: g.url,
        colorHex,
        position: perimeterSlot(t, py),
        thumbnailUrl: resolveThumb(g),
        flipThumbY: !!g.thumbnailFlipY,
      });
      order++;
    });
  });

  if (incoming.ref) {
    const refNorm = normalizeUrl(incoming.ref);
    const refGame = games.find(g => g && g.url && normalizeUrl(g.url) === refNorm);
    const refTitle = refGame ? `← ${refGame.title || refGame.id}` : '← Return';
    makePortal({
      title: refTitle,
      url: incoming.ref,
      colorHex: '#4ff0ff',
      position: new THREE.Vector3(0, 2.2, -4),
      radius: 1.5,
      thumbnailUrl: resolveThumb(refGame),
      flipThumbY: !!(refGame && refGame.thumbnailFlipY),
    });
  }
}

// Default third-person orientation: face away from the camera.
player.yaw = Math.PI;
player.group.position.copy(player.pos);
player.group.rotation.y = player.yaw;

// Grace window after spawning so arrivals don't instantly re-trigger
// the return portal they just came through.
const spawnGraceUntil = performance.now() + (incoming.fromPortal ? 1500 : 0);

// ------------------------------------------------------------------
// Input
// ------------------------------------------------------------------

const keys = {};
const chatInput = document.getElementById('chat-input');
const nameInput = document.getElementById('name-input');
const renameBtn = document.getElementById('rename-btn');
const chatLog = document.getElementById('chat-log');
const usernameText = document.getElementById('username-text');
const emoteWheel = document.getElementById('emote-wheel');
let wheelOpen = false;

function isInputFocused() {
  const a = document.activeElement;
  return a === chatInput || a === nameInput;
}
function isMenuOpen() {
  return isInputFocused() || wheelOpen;
}

addEventListener('keydown', e => {
  if (isInputFocused()) return;
  if (race.active) { e.preventDefault(); handleRaceKey(e); return; }
  const k = e.key.toLowerCase();

  if (wheelOpen) {
    if (k === 'escape' || k === 'y') { e.preventDefault(); closeEmoteWheel(); return; }
    if (k >= '1' && k <= '9') {
      const idx = parseInt(k, 10) - 1;
      const names = Object.keys(EMOTES);
      if (idx < names.length) {
        e.preventDefault();
        playEmote(names[idx]);
        closeEmoteWheel();
      }
      return;
    }
    return;
  }

  if (k === 'enter' || k === 't') { e.preventDefault(); openChat(); return; }
  if (k === 'n')                   { e.preventDefault(); openNameInput(); return; }
  if (k === 'y')                   { e.preventDefault(); openEmoteWheel(); return; }
  if (k === 'm')                   { e.preventDefault(); toggleMute(); return; }
  if (k === 'q')                   { e.preventDefault(); tryBackflip(); return; }
  if (k === 'e') {
    e.preventDefault();
    if (player.driving !== null)  { exitCar(); return; }
    if (player.piloting)          { exitPlane(); return; }
    if (player.seatedBench)       { standUp(); return; }
    if (tryEnterCar())            { return; }
    if (tryEnterPlane())          { return; }
    if (trySitDown())             { return; }
    tryTogglePickup();
    return;
  }
  if (k === ' ' || k === 'spacebar') {
    if (player.piloting) { keys[k] = true; return; } // boost throttle while flying
    e.preventDefault();
    if (player.driving !== null) return; // no jump while driving
    if (player.seatedBench) return;
    if (player.grounded) {
      player.velY = JUMP_IMPULSE;
      player.grounded = false;
    }
    return;
  }
  keys[k] = true;
});
addEventListener('keyup', e => {
  if (isMenuOpen()) return;
  keys[e.key.toLowerCase()] = false;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ------------------------------------------------------------------
// Pointer lock (mouse look)
// ------------------------------------------------------------------

canvas.addEventListener('click', () => {
  if (isMenuOpen()) return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});
document.addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  camYaw   -= e.movementX * MOUSE_SENS;
  camPitch += e.movementY * MOUSE_SENS;
  if (camPitch < CAM_PITCH_MIN) camPitch = CAM_PITCH_MIN;
  if (camPitch > CAM_PITCH_MAX) camPitch = CAM_PITCH_MAX;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  camDistance += e.deltaY * 0.008;
  if (camDistance < CAM_DISTANCE_MIN) camDistance = CAM_DISTANCE_MIN;
  if (camDistance > CAM_DISTANCE_MAX) camDistance = CAM_DISTANCE_MAX;
}, { passive: false });

// Left click while pointer-locked shoots if we're holding a ball.
// (The "click to lock" flow is on canvas click, fires on mouseup so it
// doesn't race with this mousedown path.)
document.addEventListener('mousedown', e => {
  if (!pointerLocked || isMenuOpen()) return;
  if (e.button !== 0) return;
  const held = balls.find(b => b.heldLocal);
  if (held) shootHeldBall();
});

function releasePointerLock() {
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

// ------------------------------------------------------------------
// Chat UI
// ------------------------------------------------------------------

const MAX_LOG_LINES = 10;
const MAX_HISTORY_LINES = 80;
const chatBox = document.getElementById('chat-box');
const chatHistory = document.getElementById('chat-history');
const chatToggle = document.getElementById('chat-toggle');
let chatBoxOpen = true;

chatToggle.addEventListener('click', e => {
  e.stopPropagation();
  chatBoxOpen = !chatBoxOpen;
  chatBox.classList.toggle('collapsed', !chatBoxOpen);
  chatToggle.textContent = chatBoxOpen ? '💬' : '💬';
  if (chatBoxOpen) chatHistory.scrollTop = chatHistory.scrollHeight;
});
// Prevent chat box from stealing pointer lock
chatHistory.addEventListener('mousedown', e => e.stopPropagation());
chatHistory.addEventListener('click', e => e.stopPropagation());

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatChatTime(d) {
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function appendToHistory(name, color, text) {
  const line = document.createElement('div');
  line.className = 'history-line';
  line.innerHTML =
    `<span class="history-name" style="color:${escapeHtml(color)}">${escapeHtml(name)}:</span>` +
    `<span>${escapeHtml(text)}</span>` +
    `<span class="history-time">${formatChatTime(new Date())}</span>`;
  chatHistory.appendChild(line);
  while (chatHistory.children.length > MAX_HISTORY_LINES) {
    chatHistory.removeChild(chatHistory.firstChild);
  }
  // Auto-scroll if near the bottom
  const atBottom = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight < 40;
  if (atBottom) chatHistory.scrollTop = chatHistory.scrollHeight;
}

function appendChatLine(name, color, text) {
  // Floating notification (fades)
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML =
    `<span class="chat-name" style="color:${escapeHtml(color)}">${escapeHtml(name)}:</span>` +
    `<span class="chat-text">${escapeHtml(text)}</span>`;
  chatLog.appendChild(line);
  while (chatLog.children.length > MAX_LOG_LINES) {
    chatLog.removeChild(chatLog.firstChild);
  }
  setTimeout(() => line.classList.add('fade'), 7000);
  setTimeout(() => line.remove(), 10000);

  // Persistent history
  appendToHistory(name, color, text);
}

function setBubble(avatarGroup, text, color) {
  const ud = avatarGroup.userData;
  if (ud.bubble) {
    avatarGroup.remove(ud.bubble);
    disposeSprite(ud.bubble);
  }
  const sprite = makeLabel(text, color || '#ffffff');
  sprite.position.set(0, 3.0, 0);
  sprite.scale.multiplyScalar(0.7);
  avatarGroup.add(sprite);
  ud.bubble = sprite;
  ud.bubbleExpires = performance.now() + 4500;
}

function clearExpiredBubble(avatarGroup) {
  const ud = avatarGroup.userData;
  if (ud.bubbleExpires && performance.now() > ud.bubbleExpires) {
    if (ud.bubble) {
      avatarGroup.remove(ud.bubble);
      disposeSprite(ud.bubble);
    }
    ud.bubble = null;
    ud.bubbleExpires = 0;
  }
}

function handleChat(msg, peerId, isSelf) {
  if (!msg || !msg.text) return;
  const text = String(msg.text).slice(0, 140);
  const name = String(msg.name || '?').slice(0, 24);
  const color = /^#[0-9a-fA-F]{6}$/.test(msg.color || '') ? msg.color : '#ffffff';
  appendChatLine(name, color, text);
  if (isSelf) {
    setBubble(player.group, text, '#' + incoming.color);
  } else {
    const peer = peers.get(peerId);
    if (peer?.group) setBubble(peer.group, text, color);
  }
}

function openChat() {
  releasePointerLock();
  for (const k in keys) keys[k] = false;
  chatInput.style.display = 'block';
  chatInput.value = '';
  requestAnimationFrame(() => chatInput.focus());
}
function closeChat(send) {
  const text = chatInput.value.trim();
  chatInput.style.display = 'none';
  chatInput.blur();
  if (send && text) {
    const msg = { name: username, color: '#' + incoming.color, text };
    handleChat(msg, null, true);
    if (sendChat) sendChat(msg);
  }
}
chatInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter')       { e.preventDefault(); closeChat(true); }
  else if (e.key === 'Escape') { e.preventDefault(); closeChat(false); }
});

// ------------------------------------------------------------------
// Name UI
// ------------------------------------------------------------------

function openNameInput() {
  releasePointerLock();
  for (const k in keys) keys[k] = false;
  nameInput.style.display = 'block';
  nameInput.value = username.startsWith('guest-') ? '' : username;
  requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
}
function closeNameInput(commit) {
  const text = nameInput.value.trim().slice(0, 24);
  nameInput.style.display = 'none';
  nameInput.blur();
  if (commit && text && text !== username) {
    setUsername(text);
  }
}
function setUsername(next) {
  username = next;
  usernameText.textContent = username;
  setAvatarName(player.group, username, '#' + incoming.color);
  try { localStorage.setItem('lobby:username', username); } catch {}
  broadcastSelf();
}
nameInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter')       { e.preventDefault(); closeNameInput(true); }
  else if (e.key === 'Escape') { e.preventDefault(); closeNameInput(false); }
});
renameBtn.addEventListener('click', () => openNameInput());

// ------------------------------------------------------------------
// Emote wheel UI
// ------------------------------------------------------------------

function buildEmoteWheel() {
  const names = Object.keys(EMOTES);
  const count = names.length;
  const radius = 130;

  const center = document.createElement('div');
  center.className = 'emote-wheel-center';
  center.innerHTML =
    '<div class="emote-wheel-title">Emotes</div>' +
    '<div class="emote-wheel-hint">1&ndash;' + count + ' or click<br>Y or Esc to close</div>';
  emoteWheel.appendChild(center);

  names.forEach((name, i) => {
    const em = EMOTES[name];
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const slot = document.createElement('button');
    slot.className = 'emote-slot';
    slot.type = 'button';
    slot.style.left = `calc(50% + ${Math.cos(angle) * radius}px)`;
    slot.style.top  = `calc(50% + ${Math.sin(angle) * radius}px)`;
    slot.innerHTML =
      `<span class="emote-slot-index">${i + 1}</span>` +
      `<span class="emote-icon">${em.icon}</span>` +
      `<span class="emote-label">${em.label}</span>`;
    slot.addEventListener('click', ev => {
      ev.stopPropagation();
      playEmote(name);
      closeEmoteWheel();
    });
    emoteWheel.appendChild(slot);
  });

  emoteWheel.addEventListener('click', ev => {
    if (ev.target === emoteWheel) closeEmoteWheel();
  });
}
buildEmoteWheel();

function openEmoteWheel() {
  releasePointerLock();
  wheelOpen = true;
  for (const k in keys) keys[k] = false;
  emoteWheel.hidden = false;
}
function closeEmoteWheel() {
  wheelOpen = false;
  emoteWheel.hidden = true;
}

function playEmote(name) {
  if (!EMOTES[name]) return;
  const ud = player.group.userData;
  ud.emoteName = name;
  ud.emoteStart = performance.now();
  if (sendEmote) sendEmote({ name });
}

// Auto-prompt once on true first visit (no URL param, no saved name)
if (firstVisit) {
  setTimeout(openNameInput, 600);
}

// ------------------------------------------------------------------
// Multiplayer — Trystero
// ------------------------------------------------------------------

const peers = new Map(); // peerId -> { state, group }
const peerCountEl = document.getElementById('peers');
let sendState = null;
let sendChat = null;
let sendEmote = null;
let room = null;

function setPeerStatus(text, isError = false) {
  if (!peerCountEl) return;
  peerCountEl.textContent = text;
  peerCountEl.style.color = isError ? '#ff6b6b' : '';
}
function refreshPeerCount() {
  setPeerStatus(`${peers.size + 1} in lobby`);
}

const scoreSoccerEl = document.getElementById('score-soccer');
const scoreBasketEl = document.getElementById('score-basket');
const parkourBestEl = document.getElementById('parkour-best');
const parkourCurrentEl = document.getElementById('parkour-current');
const toastEl = document.getElementById('toast');
let toastHideTimer = 0;

function updateScoresHUD() {
  if (scoreSoccerEl) scoreSoccerEl.textContent = String(scores.soccer || 0);
  if (scoreBasketEl) scoreBasketEl.textContent = String(scores.basketball || 0);
  if (parkourBestEl) parkourBestEl.textContent = formatTime(parkour.bestMs);
}

function showToast(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
}

function updateParkourHUD() {
  if (!parkourCurrentEl) return;
  if (parkour.running) {
    parkourCurrentEl.hidden = false;
    parkourCurrentEl.textContent = '· ' + formatTime(parkour.currentMs);
  } else {
    parkourCurrentEl.hidden = true;
  }
}

const leaderboardRowsEl = document.getElementById('leaderboard-rows');
function renderLeaderboard() {
  if (!leaderboardRowsEl) return;
  const rows = [{
    name: username || '?',
    ms: parkour.bestMs,
    self: true,
  }];
  for (const peer of peers.values()) {
    if (!peer.state) continue;
    rows.push({
      name: peer.state.username || '?',
      ms: typeof peer.state.parkourBest === 'number' ? peer.state.parkourBest : null,
      self: false,
    });
  }
  rows.sort((a, b) => {
    const am = a.ms == null ? Infinity : a.ms;
    const bm = b.ms == null ? Infinity : b.ms;
    return am - bm;
  });
  const top = rows.slice(0, 5);
  if (top.every(r => r.ms == null)) {
    leaderboardRowsEl.innerHTML = '<div class="lb-empty">no runs yet</div>';
    return;
  }
  leaderboardRowsEl.innerHTML = top.map(r => {
    const selfCls = r.self ? ' self' : '';
    const name = escapeHtml(r.name || '?');
    const time = r.ms == null ? '—' : formatTime(r.ms);
    return `<div class="lb-row${selfCls}"><span class="lb-name">${name}</span><span class="lb-time">${time}</span></div>`;
  }).join('');
}

function updateParkour(dt) {
  if (!parkour.startPad || !parkour.endPad) return;
  // Flying or sitting shouldn't register parkour checkpoints.
  if (player.piloting || player.seatedBench) {
    parkour.onStart = false;
    parkour.onEnd = false;
    updateParkourHUD();
    return;
  }
  const sp = parkour.startPad;
  const ep = parkour.endPad;
  const sdx = player.pos.x - sp.x;
  const sdz = player.pos.z - sp.z;
  const onStart = (sdx * sdx + sdz * sdz) < (sp.r * sp.r) && player.pos.y < 1.5;
  const edx = player.pos.x - ep.x;
  const edz = player.pos.z - ep.z;
  const onEnd = (edx * edx + edz * edz) < (ep.r * ep.r) && player.pos.y > ep.y - 1.2;

  // Edge-triggered: fire only on first frame of entry.
  if (onStart && !parkour.onStart) {
    parkour.running = true;
    parkour.startMs = performance.now();
    parkour.currentMs = 0;
    showToast('GO!');
  }
  if (onEnd && !parkour.onEnd && parkour.running) {
    parkour.running = false;
    const finalMs = performance.now() - parkour.startMs;
    parkour.currentMs = finalMs;
    if (parkour.bestMs == null || finalMs < parkour.bestMs) {
      parkour.bestMs = Math.round(finalMs);
      saveParkourBest();
      showToast('NEW BEST — ' + formatTime(parkour.bestMs));
      // Push a fresh broadcast so the rest of the lobby sees the new
      // best without waiting for the next 80ms tick, then redraw.
      broadcastSelf();
      renderLeaderboard();
    } else {
      showToast('FINISH — ' + formatTime(finalMs));
    }
    updateScoresHUD();
  }
  parkour.onStart = onStart;
  parkour.onEnd = onEnd;

  if (parkour.running) {
    parkour.currentMs = performance.now() - parkour.startMs;
  }
  updateParkourHUD();

  // Gentle pulse on the rings so the pads read as interactive.
  const t = performance.now() / 1000;
  if (parkour.startRing) parkour.startRing.material.opacity = 0.55 + Math.sin(t * 3) * 0.25;
  if (parkour.endRing)   parkour.endRing.material.opacity   = 0.55 + Math.sin(t * 3 + 1.2) * 0.25;
}

updateScoresHUD();
renderLeaderboard();

// Background music — loops quietly, mute via M or the button, volume
// via the slider next to it. Browser autoplay rules need a user
// gesture, so we also kick playback off on the first pointerdown /
// keydown after load.
const bgmEl = document.getElementById('bgm');
const muteBtn = document.getElementById('mute-btn');
const volumeSlider = document.getElementById('volume-slider');
let bgmMuted = false;
let bgmVolume = 0.35;
try { bgmMuted = localStorage.getItem('lobby:bgmMuted') === '1'; } catch {}
try {
  const v = parseFloat(localStorage.getItem('lobby:bgmVolume') ?? '');
  if (!Number.isNaN(v) && v >= 0 && v <= 1) bgmVolume = v;
} catch {}

function applyAudio() {
  if (bgmEl) {
    bgmEl.muted = bgmMuted;
    bgmEl.volume = bgmVolume;
  }
  if (muteBtn) {
    muteBtn.textContent = bgmMuted ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', bgmMuted);
    muteBtn.title = bgmMuted ? 'unmute music (M)' : 'mute music (M)';
    muteBtn.setAttribute('aria-label', muteBtn.title);
  }
  if (volumeSlider) {
    if (parseFloat(volumeSlider.value) !== bgmVolume) volumeSlider.value = String(bgmVolume);
    volumeSlider.classList.toggle('muted', bgmMuted);
  }
}
function toggleMute() {
  bgmMuted = !bgmMuted;
  try { localStorage.setItem('lobby:bgmMuted', bgmMuted ? '1' : '0'); } catch {}
  applyAudio();
  // Re-kick playback if the user unmutes before the first real gesture
  // has landed on the <audio> element.
  if (!bgmMuted) tryPlayBgm();
}
function setBgmVolume(v) {
  bgmVolume = Math.max(0, Math.min(1, v));
  try { localStorage.setItem('lobby:bgmVolume', String(bgmVolume)); } catch {}
  applyAudio();
}
function tryPlayBgm() {
  if (!bgmEl) return;
  bgmEl.volume = bgmVolume;
  const p = bgmEl.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}
applyAudio();
tryPlayBgm();

const bgmGestureKick = () => {
  tryPlayBgm();
  removeEventListener('pointerdown', bgmGestureKick);
  removeEventListener('keydown', bgmGestureKick);
};
addEventListener('pointerdown', bgmGestureKick);
addEventListener('keydown', bgmGestureKick);

if (muteBtn) muteBtn.addEventListener('click', e => {
  e.stopPropagation();
  toggleMute();
});

if (volumeSlider) {
  volumeSlider.addEventListener('input', e => {
    setBgmVolume(parseFloat(e.target.value));
  });
  // Don't let drags on the slider start/stop pointer-lock or count
  // as a "first gesture" that flips game state.
  volumeSlider.addEventListener('pointerdown', e => e.stopPropagation());
  volumeSlider.addEventListener('mousedown', e => e.stopPropagation());
}

function broadcastSelf() {
  if (!sendState) return;
  const payload = {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z,
    yaw: player.yaw,
    color: '#' + incoming.color,
    username,
    moving: player.isMoving,
    grounded: player.grounded,
    seated: !!player.seatedBench,
    piloting: !!player.piloting,
    parkourBest: parkour.bestMs,
    racing: race.active && !race.finished,
    racePos: race.pos,
    raceSentence: race.active ? race.sentenceIdx : null,
    // Avatar pitch — backflip in flight or slumped angle while ragdolled.
    pitch: player.flipping ? player.flipPitch
         : player.ragdolling ? player.ragdollPitch
         : 0,
    drivingCar: player.driving,
  };
  // Only the current pilot broadcasts plane pose. On exit we still
  // send one final frame (piloting=false) carrying the reset base
  // pose, so peers lerp the plane back to the parked spot.
  if (plane) {
    payload.planeX = plane.group.position.x;
    payload.planeY = plane.group.position.y;
    payload.planeZ = plane.group.position.z;
    payload.planeYaw = plane.group.rotation.y;
    payload.planePitch = plane.pitch;
  }
  // Car pose rides on the state channel (like the plane) so it's
  // always in sync with the drivingCar flag — no cross-channel races.
  if (player.driving !== null) {
    const car = cars[player.driving];
    payload.carX = car.group.position.x;
    payload.carZ = car.group.position.z;
    payload.carYaw = car.yaw;
    payload.carVx = car.velX;
    payload.carVz = car.velZ;
  }
  sendState(payload);
}

async function loadTrystero() {
  const urls = [
    'https://esm.run/trystero@0.23',
    'https://cdn.jsdelivr.net/npm/trystero@0.23/+esm',
    'https://esm.sh/trystero@0.23',
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const mod = await import(url);
      if (mod && typeof mod.joinRoom === 'function') {
        console.log('[lobby] loaded trystero from', url);
        return mod;
      }
      lastErr = new Error(`module from ${url} has no joinRoom export`);
    } catch (err) {
      console.warn('[lobby] cdn failed:', url, err.message);
      lastErr = err;
    }
  }
  throw lastErr || new Error('could not load trystero');
}

async function setupMultiplayer() {
  try {
    setPeerStatus('connecting…');
    const { joinRoom } = await loadTrystero();
    room = joinRoom({ appId: 'ordinary-game-jam-lobby' }, 'lobby-main');
    const [sendS, getS] = room.makeAction('state');
    const [sendC, getC] = room.makeAction('chat');
    const [sendE, getE] = room.makeAction('emote');
    const [sendB, getB] = room.makeAction('ball');
    sendState = sendS;
    sendChat = sendC;
    sendEmote = sendE;
    sendBallAction = sendB;

    const [sendCR, getCR] = room.makeAction('car');
    sendCarAction = sendCR;

    getCR((data, peerId) => {
      if (typeof data.idx !== 'number') return;
      const car = cars[data.idx];
      if (!car) return;
      car.targetX = data.x;
      car.targetZ = data.z;
      car.targetYaw = data.yaw;
      car.driverPeerId = data.driving ? peerId : null;
      // If not driving, snap immediately so parked position is accurate
      if (!data.driving) {
        car.group.position.x = data.x;
        car.group.position.z = data.z;
        car.group.rotation.y = data.yaw;
        car.yaw = data.yaw;
      }
    });

    getB((data, peerId) => {
      if (!data || !data.id) return;
      const ball = balls.find(b => b.id === data.id);
      if (!ball) return;
      ball.pos.set(data.x, data.y, data.z);
      if (data.held) {
        // Remote peer is holding this ball — yield if we thought we had it.
        ball.heldLocal = false;
        ball.holderPeerId = peerId;
        ball.vel.set(0, 0, 0);
      } else {
        ball.vel.set(data.vx || 0, data.vy || 0, data.vz || 0);
        ball.holderPeerId = null;
        // If this update comes from a remote peer shooting, we stop holding.
        if (peerId) ball.heldLocal = false;
      }
    });

    room.onPeerJoin(id => {
      if (!peers.has(id)) peers.set(id, { state: null, group: null });
      broadcastSelf();
      refreshPeerCount();
    });
    room.onPeerLeave(id => {
      const p = peers.get(id);
      if (p?.group) scene.remove(p.group);
      peers.delete(id);
      // Clean up race animal if the peer was racing.
      if (race.peerAnimals.has(id)) {
        const pa = race.peerAnimals.get(id);
        scene.remove(pa.animal);
        race.peerAnimals.delete(id);
      }
      // Free any car the departed peer was driving.
      for (const car of cars) {
        if (car.driverPeerId === id) car.driverPeerId = null;
      }
      // Free any ball the departed peer was holding so it isn't stuck.
      for (const ball of balls) {
        if (ball.holderPeerId === id) {
          ball.holderPeerId = null;
          ball.pos.copy(ball.home);
          ball.vel.set(0, 0, 0);
        }
      }
      refreshPeerCount();
    });

    getS((data, peerId) => {
      if (!data) return;
      let peer = peers.get(peerId);
      if (!peer) {
        peer = { state: null, group: null };
        peers.set(peerId, peer);
      }
      const prevRX = peer.state?.renderX ?? data.x ?? 0;
      const prevRY = peer.state?.renderY ?? data.y ?? 0;
      const prevRZ = peer.state?.renderZ ?? data.z ?? 0;
      const prevName = peer.state?.username;
      const prevPiloting = !!peer.state?.piloting;
      peer.state = {
        x: data.x ?? 0,
        y: data.y ?? 0,
        z: data.z ?? 0,
        yaw: data.yaw ?? 0,
        color: data.color || '#ffffff',
        username: data.username || '?',
        moving: !!data.moving,
        grounded: data.grounded !== false,
        seated: !!data.seated,
        piloting: !!data.piloting,
        parkourBest: typeof data.parkourBest === 'number' ? data.parkourBest : null,
        racing: !!data.racing,
        racePos: typeof data.racePos === 'number' ? data.racePos : 0,
        raceSentence: typeof data.raceSentence === 'number' ? data.raceSentence : null,
        pitch: typeof data.pitch === 'number' ? data.pitch : 0,
        drivingCar: typeof data.drivingCar === 'number' ? data.drivingCar : null,
        renderX: prevRX,
        renderY: prevRY,
        renderZ: prevRZ,
      };
      if (!peer.group) {
        peer.group = makeAvatar(peer.state.color, peer.state.username);
        peer.group.rotation.order = 'YXZ';
        peer.group.position.set(peer.state.x, peer.state.y, peer.state.z);
        peer.group.rotation.y = peer.state.yaw;
        scene.add(peer.group);
        refreshPeerCount();
      } else if (prevName !== peer.state.username) {
        setAvatarName(peer.group, peer.state.username, peer.state.color);
      }
      peer.group.visible = !peer.state.piloting && !peer.state.racing && peer.state.drivingCar === null;

      // Peer race animals — show when they're racing and we're racing too.
      if (peer.state.racing && race.active) {
        if (!race.peerAnimals.has(peerId)) {
          const c = parseInt((peer.state.color || '#ffffff').replace('#',''), 16) || 0xffffff;
          const a = makeRaceAnimal(c);
          const lane = race.nextPeerLane++;
          a.position.set(RACE_START_X + peer.state.racePos, 0, laneZ(lane));
          scene.add(a);
          race.peerAnimals.set(peerId, { animal: a, lane, pos: 0, targetPos: peer.state.racePos });
        } else {
          race.peerAnimals.get(peerId).targetPos = peer.state.racePos;
        }
      } else if (!peer.state.racing && race.peerAnimals.has(peerId)) {
        const pa = race.peerAnimals.get(peerId);
        scene.remove(pa.animal);
        race.peerAnimals.delete(peerId);
      }

      // Relay the pilot's plane pose into our local plane so everyone
      // sees the same aircraft. Accept updates from a peer who is
      // piloting — or was on the previous frame (so the "just landed"
      // broadcast, which carries piloting=false + the reset base
      // pose, still resyncs the plane back to the runway).
      if (plane && !player.piloting
          && typeof data.planeX === 'number'
          && (peer.state.piloting || prevPiloting)) {
        plane.targetX = data.planeX;
        plane.targetY = data.planeY;
        plane.targetZ = data.planeZ;
        plane.targetYaw = data.planeYaw ?? plane.targetYaw;
        plane.targetPitch = data.planePitch ?? plane.targetPitch;
      }

      // Relay the driver's car pose. Uses the state channel so it's
      // always in sync with the drivingCar flag.
      const carIdx = peer.state.drivingCar;
      if (typeof carIdx === 'number' && carIdx >= 0 && carIdx < cars.length
          && typeof data.carX === 'number') {
        const car = cars[carIdx];
        // Only accept if we're not the one driving this car
        if (car.driverPeerId !== 'local') {
          car.driverPeerId = peerId;
          car.targetX = data.carX;
          car.targetZ = data.carZ;
          car.targetYaw = data.carYaw ?? car.targetYaw;
          car.velX = data.carVx ?? 0;
          car.velZ = data.carVz ?? 0;
        }
      }
      // If peer stopped driving, free the car
      if (carIdx === null) {
        for (const car of cars) {
          if (car.driverPeerId === peerId) car.driverPeerId = null;
        }
      }
    });

    getC((data, peerId) => handleChat(data, peerId, false));

    getE((data, peerId) => {
      if (!data || !data.name || !EMOTES[data.name]) return;
      const peer = peers.get(peerId);
      if (peer?.group) {
        peer.group.userData.emoteName = data.name;
        peer.group.userData.emoteStart = performance.now();
      }
    });

    refreshPeerCount();
    broadcastSelf();
    console.log('[lobby] multiplayer ready');
  } catch (err) {
    console.error('[lobby] multiplayer setup failed:', err);
    setPeerStatus('multiplayer offline', true);
  }
}

setupPortals();
setupMultiplayer();

addEventListener('beforeunload', () => {
  if (room) { try { room.leave(); } catch {} }
});

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------

const clock = new THREE.Clock();
let redirecting = false;
let lastBroadcast = 0;
let lastLeaderboardRender = 0;

function update(dt) {
  // Seated / piloting states short-circuit the normal player physics path.
  if (player.seatedBench) {
    const b = player.seatedBench;
    player.isMoving = false;
    player.pos.set(b.x, b.sitY, b.z);
    player.yaw = b.yaw;
    player.velY = 0;
    player.grounded = true;
    player.group.position.copy(player.pos);
    player.group.rotation.y = player.yaw;
    const ud = player.group.userData;
    ud.emoteName = 'sit';
    ud.emoteStart = performance.now() - 500; // hold mid-pose, never expire
    animateAvatar(player.group, dt, false, true);
  } else if (race.active) {
    updateRace(dt);
  } else if (player.piloting) {
    updatePlane(dt);
    player.pos.set(
      plane.group.position.x,
      plane.group.position.y,
      plane.group.position.z,
    );
    player.yaw = plane.group.rotation.y;
    player.isMoving = false;
    player.velY = 0;
    player.grounded = true;
  } else if (player.driving !== null) {
    updateCar(dt);
    const car = cars[player.driving];
    player.pos.set(car.group.position.x, 0, car.group.position.z);
    player.yaw = car.yaw;
    player.isMoving = Math.hypot(car.velX, car.velZ) > 0.5;
    player.velY = 0;
    player.grounded = true;
  } else {
    updatePlayerMovement(dt);
    checkRacePad();
    // When a remote peer is piloting, ease the local plane toward the
    // broadcast pose so everyone sees it fly. The prop keeps spinning
    // until it's (nearly) back on the parked spot.
    if (plane) {
      const k = Math.min(1, dt * 8);
      plane.group.position.x += (plane.targetX - plane.group.position.x) * k;
      plane.group.position.y += (plane.targetY - plane.group.position.y) * k;
      plane.group.position.z += (plane.targetZ - plane.group.position.z) * k;
      let dyaw = plane.targetYaw - plane.group.rotation.y;
      while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      plane.group.rotation.y += dyaw * k;
      plane.pitch += (plane.targetPitch - plane.pitch) * k;
      plane.group.rotation.x = plane.pitch;
      const parkedDx = plane.group.position.x - plane.basePos.x;
      const parkedDy = plane.group.position.y - plane.basePos.y;
      const parkedDz = plane.group.position.z - plane.basePos.z;
      const airborne = (parkedDx * parkedDx + parkedDy * parkedDy + parkedDz * parkedDz) > 0.25;
      if (airborne) plane.prop.rotation.z += 35 * dt;
    }
  }

  // Lerp peer-driven cars toward their broadcast poses. Runs
  // unconditionally so cars keep moving even when the local player
  // is in a different car, seated, racing, etc.
  for (const car of cars) {
    if (car.driverPeerId && car.driverPeerId !== 'local') {
      // Predict forward using last-known velocity, then lerp toward target
      car.group.position.x += car.velX * dt;
      car.group.position.z += car.velZ * dt;
      const ck = Math.min(1, dt * 10);
      car.group.position.x += (car.targetX - car.group.position.x) * ck;
      car.group.position.z += (car.targetZ - car.group.position.z) * ck;
      let cyaw = car.targetYaw - car.group.rotation.y;
      while (cyaw >  Math.PI) cyaw -= Math.PI * 2;
      while (cyaw < -Math.PI) cyaw += Math.PI * 2;
      car.group.rotation.y += cyaw * ck;
      car.yaw = car.group.rotation.y;
      // Spin wheels proportional to speed
      const carSpd = Math.hypot(car.velX, car.velZ);
      if (carSpd > 0.1) {
        for (const w of car.wheels) w.rotation.x += (carSpd / 0.22) * dt;
      }
    }
  }

  // Balls: held balls attach to the local player (and get broadcast
  // periodically), remotely-held balls just sit at the last received
  // position, and free balls run full physics + collision.
  for (const ball of balls) {
    if (ball.heldLocal) {
      updateHeldBall(ball, dt);
    } else if (ball.holderPeerId) {
      ball.mesh.position.copy(ball.pos);
    } else {
      collideBallWithPlayer(ball);
      updateBall(ball, dt);
    }
  }
  if (performance.now() - lastBallBroadcast > 100) {
    lastBallBroadcast = performance.now();
    for (const ball of balls) {
      if (ball.heldLocal) broadcastBall(ball);
    }
  }

  updateParkour(dt);

  // Car-vs-player collision: any moving car knocks the player flying.
  if (player.driving === null && !player.ragdolling && !player.seatedBench) {
    for (const car of cars) {
      const carSpeed = Math.hypot(car.velX, car.velZ);
      if (carSpeed < 2) continue; // only hit at meaningful speed
      const dx = player.pos.x - car.group.position.x;
      const dz = player.pos.z - car.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.0 && dist > 0.01) {
        const nx = dx / dist;
        const nz = dz / dist;
        startCarHitRagdoll(nx, nz, carSpeed);
        // Push player out of the car
        player.pos.x = car.group.position.x + nx * 2.1;
        player.pos.z = car.group.position.z + nz * 2.1;
        break;
      }
    }
  }

  // Ducks drift around the pond.
  const nowS = performance.now() / 1000;
  for (const d of ducks) {
    const prevX = d.group.position.x;
    const prevZ = d.group.position.z;
    d.angle += d.speed * dt;
    const nx = d.cx + Math.cos(d.angle) * d.radius;
    const nz = d.cz + Math.sin(d.angle) * d.radius;
    d.group.position.x = nx;
    d.group.position.z = nz;
    d.group.position.y = 0.38 + Math.sin(nowS * 1.6 + d.bobPhase) * 0.035;
    const dx = nx - prevX;
    const dz = nz - prevZ;
    if (dx * dx + dz * dz > 1e-6) {
      d.group.rotation.y = Math.atan2(-dz, dx);
    }
  }

  // Portal pulse + trigger
  const t = performance.now() / 1000;
  for (const p of portals) {
    if (!p.thumbLoaded) {
      p.disk.material.opacity = 0.2 + Math.sin(t * 2 + p.group.position.x) * 0.08;
    }
    p.group.rotation.z = Math.sin(t * 1.2 + p.group.position.z) * 0.04;
  }

  if (!redirecting && !player.piloting && !player.seatedBench && player.driving === null && !race.active && performance.now() > spawnGraceUntil) {
    for (const p of portals) {
      const dx = player.pos.x - p.group.position.x;
      const dz = player.pos.z - p.group.position.z;
      // Player chest height vs portal centre — keeps an upper-floor
      // portal from triggering when the player walks under it.
      const dy = (player.pos.y + 1.0) - p.group.position.y;
      if (Math.hypot(dx, dz) < p.radius && Math.abs(dy) < p.radius) {
        redirecting = true;
        Portal.sendPlayerThroughPortal(p.url, {
          username,
          color: incoming.color,
          speed: player.speed,
        });
        break;
      }
    }
  }

  // Interpolate peers + animate
  for (const peer of peers.values()) {
    if (!peer.state || !peer.group) continue;
    const k = Math.min(1, dt * 12);
    peer.state.renderX += (peer.state.x - peer.state.renderX) * k;
    peer.state.renderY += (peer.state.y - peer.state.renderY) * k;
    peer.state.renderZ += (peer.state.z - peer.state.renderZ) * k;
    peer.group.position.x = peer.state.renderX;
    peer.group.position.y = peer.state.renderY;
    peer.group.position.z = peer.state.renderZ;
    peer.group.rotation.y = peer.state.yaw;
    peer.group.rotation.x = peer.state.pitch || 0;
    if (peer.state.seated) {
      const pud = peer.group.userData;
      pud.emoteName = 'sit';
      pud.emoteStart = performance.now() - 500;
    }
    animateAvatar(peer.group, dt, !!peer.state.moving, !!peer.state.grounded);
    clearExpiredBubble(peer.group);
  }
  clearExpiredBubble(player.group);

  const now = performance.now();
  if (now - lastBroadcast > 80) {
    lastBroadcast = now;
    broadcastSelf();
  }
  if (now - lastLeaderboardRender > 500) {
    lastLeaderboardRender = now;
    renderLeaderboard();
  }
}

function updatePlayerMovement(dt) {
  // Climb mode: hold position on the ladder, W/S to scale up/down,
  // jump (or top dismount) to release.
  if (player.climbingLadder) {
    const l = player.climbingLadder;
    // Ease the player onto the ladder's centerline.
    const k = Math.min(1, dt * 10);
    player.pos.x += (l.x - player.pos.x) * k;
    player.pos.z += (l.z - player.pos.z) * k;
    // Face away from the wall (look at the atrium).
    player.yaw = Math.atan2(l.faceX, l.faceZ);

    let vy = 0;
    if (!isMenuOpen()) {
      if (keys['w'] || keys['arrowup']) vy =  CLIMB_SPEED;
      else if (keys['s'] || keys['arrowdown']) vy = -CLIMB_SPEED;
    }
    player.pos.y += vy * dt;
    player.velY = 0;
    player.isMoving = vy !== 0;
    player.grounded = false;

    let dismounted = false;
    // Top dismount: nudge player onto the platform above the ladder.
    if (player.pos.y >= l.topY) {
      player.pos.y = l.topY + 0.05;
      player.pos.x += l.faceX * 0.7;
      player.pos.z += l.faceZ * 0.7;
      dismounted = true;
    }
    // Bottom dismount when descending past the base.
    if (player.pos.y <= l.baseY - 0.05) {
      player.pos.y = l.baseY;
      dismounted = true;
    }
    // Jump release — push outward so we don't immediately re-engage.
    if ((keys[' '] || keys['spacebar']) && !dismounted) {
      player.velY = JUMP_IMPULSE;
      player.pos.x += l.faceX * 0.6;
      player.pos.z += l.faceZ * 0.6;
      dismounted = true;
    }
    if (dismounted) player.climbingLadder = null;

    player.group.position.copy(player.pos);
    player.group.rotation.y = player.yaw;
    player.group.rotation.x = 0;
    animateAvatar(player.group, dt, player.isMoving, true);
    return;
  }

  // Auto-engage when the player walks into a ladder zone, while
  // grounded or falling. Skip if any other state mode is active.
  if (!player.flipping && !player.ragdolling && !player.seatedBench && !player.piloting) {
    for (const l of ladders) {
      const dx = player.pos.x - l.x;
      const dz = player.pos.z - l.z;
      if (Math.abs(dx) < l.range && Math.abs(dz) < l.range
          && player.pos.y >= l.baseY - 0.5 && player.pos.y < l.topY) {
        player.climbingLadder = l;
        player.velY = 0;
        return updatePlayerMovement(dt); // re-enter with climb branch
      }
    }
  }

  // Ragdoll: locked out, just apply gravity + render the slumped pose.
  if (player.ragdolling) {
    if (performance.now() > player.ragdollEnd) {
      endRagdoll();
    } else {
      // Apply knockback velocity with friction
      if (Math.abs(player.knockVx) > 0.01 || Math.abs(player.knockVz) > 0.01) {
        const kfric = player.grounded ? Math.exp(-4 * dt) : Math.exp(-0.5 * dt);
        player.knockVx *= kfric;
        player.knockVz *= kfric;
        resolveHorizontal(player.knockVx * dt, player.knockVz * dt);
      }
      player.velY -= GRAVITY * dt;
      const desiredY = player.pos.y + player.velY * dt;
      const support = supportHeightAt(player.pos.x, player.pos.z, player.pos.y);
      if (desiredY <= support) {
        player.pos.y = support; player.velY = 0; player.grounded = true;
      } else {
        player.pos.y = desiredY; player.grounded = false;
      }
      player.isMoving = false;
      player.group.position.copy(player.pos);
      player.group.rotation.y = player.yaw;
      // Lock the avatar at whatever angle they crashed in, with a
      // tiny jiggle so it reads as "floored" rather than frozen.
      const jig = Math.sin(performance.now() * 0.012) * 0.04;
      player.group.rotation.x = player.ragdollPitch + jig;
      animateAvatar(player.group, dt, false, true);
      return;
    }
  }

  // Movement is camera-relative: W = toward where the camera looks.
  let iFwd = 0, iRight = 0;
  if (!isMenuOpen() && !player.flipping) {
    if (keys['w'] || keys['arrowup'])    iFwd  += 1;
    if (keys['s'] || keys['arrowdown'])  iFwd  -= 1;
    if (keys['d'] || keys['arrowright']) iRight += 1;
    if (keys['a'] || keys['arrowleft'])  iRight -= 1;
  }
  player.isMoving = (iFwd !== 0 || iRight !== 0);
  if (player.isMoving) {
    // Camera forward on XZ plane (from camera toward player).
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    // Right = forward × up = (-fz, 0, fx).
    const rx = -fz;
    const rz =  fx;
    let mx = iFwd * fx + iRight * rx;
    let mz = iFwd * fz + iRight * rz;
    const len = Math.hypot(mx, mz);
    mx /= len; mz /= len;

    resolveHorizontal(mx * player.speed * dt, mz * player.speed * dt);

    const targetYaw = Math.atan2(mx, mz);
    let diff = targetYaw - player.yaw;
    while (diff > Math.PI)  diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    player.yaw += diff * Math.min(1, dt * 12);
  }

  // Backflip in flight: spin pitch and drift backward.
  if (player.flipping) {
    player.flipPitch += player.flipAngVel * dt;
    resolveHorizontal(player.flipBackVx * dt, player.flipBackVz * dt);
  }

  // Vertical physics — gravity + one-way platform collision.
  player.velY -= GRAVITY * dt;
  const desiredY = player.pos.y + player.velY * dt;
  const support = supportHeightAt(player.pos.x, player.pos.z, player.pos.y);
  if (desiredY <= support) {
    player.pos.y = support;
    player.velY = 0;
    const wasAirborne = !player.grounded;
    player.grounded = true;
    // Resolve flip on landing: feet-down within ±FLIP_LAND_TOLERANCE
    // of any 2π multiple → safe; otherwise bail into a ragdoll.
    if (player.flipping && wasAirborne) {
      const twoPi = Math.PI * 2;
      const norm = ((player.flipPitch % twoPi) + twoPi) % twoPi;
      const distToUp = Math.min(norm, twoPi - norm);
      if (distToUp <= FLIP_LAND_TOLERANCE) {
        player.flipping = false;
        player.flipPitch = 0;
        player.flipBackVx = 0;
        player.flipBackVz = 0;
      } else {
        startRagdoll(norm > Math.PI ? norm - twoPi : norm);
      }
    }
  } else {
    player.pos.y = desiredY;
    player.grounded = false;
  }

  player.group.position.copy(player.pos);
  player.group.rotation.y = player.yaw;
  player.group.rotation.x = player.flipping ? player.flipPitch : 0;
  animateAvatar(player.group, dt, player.isMoving, player.grounded);
}

function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt);
  updateDayNight(performance.now() / 1000);
  updateCamera(dt);
  updateAimGuide();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

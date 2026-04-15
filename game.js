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

// Boundary pillars
{
  const pillarGeom = new THREE.CylinderGeometry(0.25, 0.25, 3.2, 12);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x220a44,
    emissive: 0x4b1fa0,
    emissiveIntensity: 0.5,
    roughness: 0.6,
  });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const p = new THREE.Mesh(pillarGeom, pillarMat);
    p.position.set(Math.cos(a) * 25, 1.6, Math.sin(a) * 25);
    scene.add(p);
  }
}

// ------------------------------------------------------------------
// Parkour course
// ------------------------------------------------------------------
// One-way AABB platforms rising in a spiral. You can jump up through
// them from below and land on their top. A wide top pad is left clear
// as the future home of a "summit" portal.

const parkourPlatforms = [];
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
}

// ------------------------------------------------------------------
// Outer world — four themed decoration sectors around the lobby
// ------------------------------------------------------------------
// Kept purely visual for this pass. The pillar ring stays as the
// boundary between the "indoor" lobby and the grass outside.

const ducks = [];
const balls = [];
const hoops = [];
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
    vel: new THREE.Vector3(),
    home: spawn.clone(),
    pickupable,
    heldLocal: false,
    holderPeerId: null,
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

function shootHeldBall() {
  const ball = balls.find(b => b.heldLocal);
  if (!ball || hoops.length === 0) return;

  // Autoaim: prefer the hoop the player is facing, lightly penalize distance.
  const fwdX = -Math.sin(camYaw);
  const fwdZ = -Math.cos(camYaw);
  let target = null;
  let bestScore = -Infinity;
  for (const h of hoops) {
    const dx = h.pos.x - player.pos.x;
    const dz = h.pos.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) continue;
    const dot = (fwdX * dx + fwdZ * dz) / dist;
    const score = dot - dist * 0.01;
    if (score > bestScore) { bestScore = score; target = h; }
  }
  if (!target) return;

  // Projectile arc: solve for initial velocity given a fixed flight time.
  const sx = player.pos.x;
  const sy = player.pos.y + 1.35;
  const sz = player.pos.z;
  const tx = target.pos.x;
  const ty = target.pos.y;
  const tz = target.pos.z;

  const horiz = Math.hypot(tx - sx, tz - sz);
  const T = Math.max(0.7, Math.min(1.5, 0.45 + horiz * 0.09));
  const vx = (tx - sx) / T;
  const vz = (tz - sz) / T;
  const vy = (ty - sy + 0.5 * BALL_GRAVITY * T * T) / T;

  ball.heldLocal = false;
  ball.holderPeerId = null;
  ball.pos.set(sx, sy, sz);
  ball.vel.set(vx, vy, vz);
  broadcastBall(ball);
}

function updateBall(ball, dt) {
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
    planeGrp.rotation.y = Math.PI * 0.08;
    scene.add(planeGrp);
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
};
scene.add(player.group);

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

function makePortal({ title, url, colorHex, position, radius = 1.8, thumbnailUrl = null }) {
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

  const n = Math.max(entries.length, 1);
  const radius = 18;
  entries.forEach((g, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const hue = Math.round((i / n) * 360);
    const color = new THREE.Color(`hsl(${hue}, 85%, 62%)`);
    const colorHex = '#' + color.getHexString();
    makePortal({
      title: g.title || g.id || 'mystery game',
      url: g.url,
      colorHex,
      position: new THREE.Vector3(Math.cos(angle) * radius, 2.4, Math.sin(angle) * radius),
      thumbnailUrl: resolveThumb(g),
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
  if (k === 'e')                   { e.preventDefault(); tryTogglePickup(); return; }
  if (k === ' ' || k === 'spacebar') {
    e.preventDefault();
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

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function appendChatLine(name, color, text) {
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
function broadcastSelf() {
  if (!sendState) return;
  sendState({
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z,
    yaw: player.yaw,
    color: '#' + incoming.color,
    username,
    moving: player.isMoving,
    grounded: player.grounded,
  });
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
      peer.state = {
        x: data.x ?? 0,
        y: data.y ?? 0,
        z: data.z ?? 0,
        yaw: data.yaw ?? 0,
        color: data.color || '#ffffff',
        username: data.username || '?',
        moving: !!data.moving,
        grounded: data.grounded !== false,
        renderX: prevRX,
        renderY: prevRY,
        renderZ: prevRZ,
      };
      if (!peer.group) {
        peer.group = makeAvatar(peer.state.color, peer.state.username);
        peer.group.position.set(peer.state.x, peer.state.y, peer.state.z);
        peer.group.rotation.y = peer.state.yaw;
        scene.add(peer.group);
        refreshPeerCount();
      } else if (prevName !== peer.state.username) {
        setAvatarName(peer.group, peer.state.username, peer.state.color);
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

function update(dt) {
  // Movement is camera-relative: W = toward where the camera looks.
  let iFwd = 0, iRight = 0;
  if (!isMenuOpen()) {
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

  // Vertical physics — gravity + one-way platform collision.
  player.velY -= GRAVITY * dt;
  const desiredY = player.pos.y + player.velY * dt;
  const support = supportHeightAt(player.pos.x, player.pos.z, player.pos.y);
  if (desiredY <= support) {
    player.pos.y = support;
    player.velY = 0;
    player.grounded = true;
  } else {
    player.pos.y = desiredY;
    player.grounded = false;
  }

  player.group.position.copy(player.pos);
  player.group.rotation.y = player.yaw;
  animateAvatar(player.group, dt, player.isMoving, player.grounded);

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

  if (!redirecting && performance.now() > spawnGraceUntil) {
    for (const p of portals) {
      const dx = player.pos.x - p.group.position.x;
      const dz = player.pos.z - p.group.position.z;
      if (Math.hypot(dx, dz) < p.radius) {
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
    animateAvatar(peer.group, dt, !!peer.state.moving, !!peer.state.grounded);
    clearExpiredBubble(peer.group);
  }
  clearExpiredBubble(player.group);

  const now = performance.now();
  if (now - lastBroadcast > 80) {
    lastBroadcast = now;
    broadcastSelf();
  }
}

function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt);
  updateDayNight(performance.now() / 1000);
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

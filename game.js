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
scene.fog = new THREE.Fog('#0a0514', 28, 75);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
keyLight.position.set(8, 20, 10);
scene.add(keyLight);
const accentLight = new THREE.PointLight(0xc64bff, 1.4, 60);
accentLight.position.set(0, 10, 0);
scene.add(accentLight);
const fillLight = new THREE.PointLight(0x4ff0ff, 0.8, 50);
fillLight.position.set(0, 3, -18);
scene.add(fillLight);

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
const MAX_RADIUS = 24;

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

async function setupPortals() {
  const games = await Portal.fetchJamRegistry();
  const here = window.location.href.replace(/\/$/, '');
  const entries = games.filter(g => g && g.url && !here.startsWith(g.url.replace(/\/$/, '')));

  const n = Math.max(entries.length, 1);
  const radius = 18;
  entries.forEach((g, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const hue = Math.round((i / n) * 360);
    const color = new THREE.Color(`hsl(${hue}, 85%, 62%)`);
    const colorHex = '#' + color.getHexString();
    let thumbnailUrl = null;
    if (g.thumbnail) {
      try { thumbnailUrl = new URL(g.thumbnail, Portal.REGISTRY_URL).href; } catch {}
    }
    makePortal({
      title: g.title || g.id || 'mystery game',
      url: g.url,
      colorHex,
      position: new THREE.Vector3(Math.cos(angle) * radius, 2.4, Math.sin(angle) * radius),
      thumbnailUrl,
    });
  });

  if (incoming.ref) {
    makePortal({
      title: '← Return',
      url: incoming.ref,
      colorHex: '#4ff0ff',
      position: new THREE.Vector3(0, 2.2, -4),
      radius: 1.5,
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
    sendState = sendS;
    sendChat = sendC;
    sendEmote = sendE;

    room.onPeerJoin(id => {
      if (!peers.has(id)) peers.set(id, { state: null, group: null });
      broadcastSelf();
      refreshPeerCount();
    });
    room.onPeerLeave(id => {
      const p = peers.get(id);
      if (p?.group) scene.remove(p.group);
      peers.delete(id);
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
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

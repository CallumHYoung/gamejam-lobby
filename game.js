// The Lobby — a 3D portal hub for Ordinary Game Jam #1.
//
// - Three.js world with a ring of portals, one per entry in the jam
//   registry (games.json). Walk into a portal to travel.
// - Trystero P2P for presence (see other players in the lobby) and
//   text chat (speech bubbles above avatars + HTML chat log).
//
// Runs fully in the browser, no backend, no build step.

import * as THREE from 'https://esm.sh/three@0.160.1';

// ------------------------------------------------------------------
// Portal protocol intake
// ------------------------------------------------------------------

const incoming = Portal.readPortalParams();
document.getElementById('username').textContent = incoming.username;

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

scene.add(new THREE.AmbientLight(0xffffff, 0.35));
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
// Avatars
// ------------------------------------------------------------------

function makeAvatar(colorHex, name) {
  const hex = (colorHex || 'ffffff').replace('#', '');
  const color = new THREE.Color('#' + hex);
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 0.9, 4, 12),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.4,
      roughness: 0.45,
      metalness: 0.15,
    })
  );
  body.position.y = 0.83;
  group.add(body);

  const nameTag = makeLabel(name || '?', '#' + hex);
  nameTag.position.set(0, 2.1, 0);
  nameTag.scale.multiplyScalar(0.55);
  group.add(nameTag);
  group.userData.nameTag = nameTag;

  return group;
}

const player = {
  group: makeAvatar(incoming.color, incoming.username),
  pos: new THREE.Vector3(0, 0, 0),
  yaw: 0,
  speed: incoming.speed || 5,
};
scene.add(player.group);

// Camera follow
const camOffset = new THREE.Vector3(0, 7.5, 11);
const camLookOffset = new THREE.Vector3(0, 1.2, 0);
const tmpCamTarget = new THREE.Vector3();
function updateCamera(dt) {
  tmpCamTarget.copy(player.pos).add(camOffset);
  camera.position.lerp(tmpCamTarget, Math.min(1, dt * 5));
  const look = player.pos.clone().add(camLookOffset);
  camera.lookAt(look);
}
// Snap camera on first frame
camera.position.copy(player.pos).add(camOffset);
camera.lookAt(player.pos.clone().add(camLookOffset));

// ------------------------------------------------------------------
// Portals
// ------------------------------------------------------------------

const portals = [];

function makePortal({ title, url, colorHex, position, radius = 1.8 }) {
  const group = new THREE.Group();
  group.position.copy(position);
  // Face the center of the room
  const look = new THREE.Vector3(0, position.y, 0);
  group.lookAt(look);

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
  portals.push({ group, ring, disk, label, url, title, radius });
  return group;
}

// ------------------------------------------------------------------
// Portal registry load
// ------------------------------------------------------------------

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
    makePortal({
      title: g.title || g.id || 'mystery game',
      url: g.url,
      colorHex,
      position: new THREE.Vector3(Math.cos(angle) * radius, 2.4, Math.sin(angle) * radius),
    });
  });

  // Return portal near spawn
  if (incoming.ref) {
    makePortal({
      title: '← Return',
      url: incoming.ref,
      colorHex: '#4ff0ff',
      position: new THREE.Vector3(0, 2.2, -5),
      radius: 1.5,
    });
  }
}

// Spawn offset if coming from a portal
if (incoming.fromPortal) {
  player.pos.set(0, 0, -1.5);
  player.yaw = Math.PI; // face away from return portal
}
player.group.position.copy(player.pos);
player.group.rotation.y = player.yaw;

// ------------------------------------------------------------------
// Input
// ------------------------------------------------------------------

const keys = {};
let chatting = false;

addEventListener('keydown', e => {
  if (chatting) return;
  if (e.key === 'Enter' || e.key.toLowerCase() === 't') {
    e.preventDefault();
    openChat();
    return;
  }
  keys[e.key.toLowerCase()] = true;
});
addEventListener('keyup', e => {
  if (chatting) return;
  keys[e.key.toLowerCase()] = false;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ------------------------------------------------------------------
// Chat UI
// ------------------------------------------------------------------

const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
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
  const old = avatarGroup.userData.bubble;
  if (old) {
    avatarGroup.remove(old);
    disposeSprite(old);
  }
  const sprite = makeLabel(text, color || '#ffffff');
  sprite.position.set(0, 3.1, 0);
  sprite.scale.multiplyScalar(0.7);
  avatarGroup.add(sprite);
  avatarGroup.userData.bubble = sprite;
  avatarGroup.userData.bubbleExpires = performance.now() + 4500;
}

function clearExpiredBubble(avatarGroup) {
  const expires = avatarGroup.userData.bubbleExpires || 0;
  if (expires && performance.now() > expires) {
    const b = avatarGroup.userData.bubble;
    if (b) {
      avatarGroup.remove(b);
      disposeSprite(b);
    }
    avatarGroup.userData.bubble = null;
    avatarGroup.userData.bubbleExpires = 0;
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
  chatting = true;
  for (const k in keys) keys[k] = false;
  chatInput.style.display = 'block';
  chatInput.value = '';
  requestAnimationFrame(() => chatInput.focus());
}
function closeChat(send) {
  const text = chatInput.value.trim();
  chatInput.style.display = 'none';
  chatInput.blur();
  chatting = false;
  if (send && text) {
    const msg = {
      name: incoming.username,
      color: '#' + incoming.color,
      text,
    };
    handleChat(msg, null, true);
    if (sendChat) sendChat(msg);
  }
}
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); closeChat(true); }
  else if (e.key === 'Escape') { e.preventDefault(); closeChat(false); }
  e.stopPropagation();
});

// ------------------------------------------------------------------
// Multiplayer — Trystero
// ------------------------------------------------------------------

const peers = new Map(); // peerId -> { state, group }
const peerCountEl = document.getElementById('peers');
let sendState = null;
let sendChat = null;
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
    z: player.pos.z,
    yaw: player.yaw,
    color: '#' + incoming.color,
    username: incoming.username,
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
    sendState = sendS;
    sendChat = sendC;

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
      const prevRZ = peer.state?.renderZ ?? data.z ?? 0;
      peer.state = {
        x: data.x ?? 0,
        z: data.z ?? 0,
        yaw: data.yaw ?? 0,
        color: data.color || '#ffffff',
        username: data.username || '?',
        renderX: prevRX,
        renderZ: prevRZ,
      };
      if (!peer.group) {
        peer.group = makeAvatar(peer.state.color, peer.state.username);
        peer.group.position.set(peer.state.x, 0, peer.state.z);
        peer.group.rotation.y = peer.state.yaw;
        scene.add(peer.group);
        refreshPeerCount();
      }
    });

    getC((data, peerId) => handleChat(data, peerId, false));

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
const MAX_RADIUS = 24;

function update(dt) {
  if (!chatting) {
    let mx = 0, mz = 0;
    if (keys['w'] || keys['arrowup'])    mz -= 1;
    if (keys['s'] || keys['arrowdown'])  mz += 1;
    if (keys['a'] || keys['arrowleft'])  mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (mx || mz) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      player.pos.x += mx * player.speed * dt;
      player.pos.z += mz * player.speed * dt;
      const r = Math.hypot(player.pos.x, player.pos.z);
      if (r > MAX_RADIUS) {
        player.pos.x *= MAX_RADIUS / r;
        player.pos.z *= MAX_RADIUS / r;
      }
      const targetYaw = Math.atan2(mx, mz);
      let diff = targetYaw - player.yaw;
      while (diff > Math.PI)  diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      player.yaw += diff * Math.min(1, dt * 12);
    }
  }

  player.group.position.copy(player.pos);
  player.group.rotation.y = player.yaw;

  // Portal pulse + trigger
  const t = performance.now() / 1000;
  for (const p of portals) {
    p.disk.material.opacity = 0.2 + Math.sin(t * 2 + p.group.position.x) * 0.08;
    p.group.rotation.z = Math.sin(t * 1.2 + p.group.position.z) * 0.04;
  }

  if (!redirecting) {
    for (const p of portals) {
      const dx = player.pos.x - p.group.position.x;
      const dz = player.pos.z - p.group.position.z;
      if (Math.hypot(dx, dz) < p.radius) {
        redirecting = true;
        Portal.sendPlayerThroughPortal(p.url, {
          username: incoming.username,
          color: incoming.color,
          speed: player.speed,
        });
        break;
      }
    }
  }

  // Interpolate peers
  for (const peer of peers.values()) {
    if (!peer.state || !peer.group) continue;
    const k = Math.min(1, dt * 12);
    peer.state.renderX += (peer.state.x - peer.state.renderX) * k;
    peer.state.renderZ += (peer.state.z - peer.state.renderZ) * k;
    peer.group.position.x = peer.state.renderX;
    peer.group.position.z = peer.state.renderZ;
    peer.group.rotation.y = peer.state.yaw;
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

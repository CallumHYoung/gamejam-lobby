# The Lobby — Ordinary Game Jam #1

A 3D hub world for the jam. Portals around the room are generated live from
`games.json` — one per entry. Walk into a ring to travel. Everyone in the
lobby sees everyone else and can chat via speech bubbles.

Built on Three.js + [Trystero](https://github.com/dmotz/trystero) (P2P over
Nostr relays — no backend). Forked from the jam starter template.

## Controls

- **WASD / arrow keys** — move
- **T** or **Enter** — open chat, type, **Enter** to send, **Esc** to cancel
- Walk into a glowing ring to portal into that game

## Run locally

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Because the registry is fetched live from
`https://callumhyoung.github.io/gamejam/games.json`, you'll see real portals
the moment other entries land.

## What's wired up

- `game.js` — Three.js scene, camera follow, portal generation, chat, Trystero presence
- `portal.js` — the jam's Portal Protocol helper (unchanged from the starter)
- `index.html` / `style.css` — HUD, chat overlay, fullscreen canvas

## Entry for `games.json`

Once deployed, add something like this to the jam registry:

```json
{
  "id": "lobby",
  "title": "The Lobby",
  "author": "CallumHYoung",
  "description": "3D hub world with live portals to every jam entry and P2P text chat.",
  "url": "https://callumhyoung.github.io/gamejam-lobby/",
  "repo": "CallumHYoung/gamejam-lobby",
  "type": "3d",
  "tags": ["hub", "three.js", "trystero", "chat"],
  "status": "wip",
  "multiplayer": true
}
```

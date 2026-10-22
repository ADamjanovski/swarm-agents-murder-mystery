# Cut to Black — Investigation Replay UI

A static, framework-free replay viewer for finished AI murder-mystery games.
Plain HTML + Tailwind (Play CDN) + vanilla ES modules. Renders entirely from
each game's `record.json`; there is no server or game logic.

## Run it

`fetch` is blocked on `file://`, so serve over http. Two options:

**A. Node server (recommended — enables ElevenLabs narration).**
```bash
cd frontend
node server.js            # http://localhost:8137/frontend/index.html
```

**B. Any static server** (no narration proxy — free Web Speech voices only),
served from the **project root** so `../murder_mystery/` and `../images/` resolve:
```bash
cd ..                     # project root
python3 -m http.server 8137
```

## Narration (audio)

Toggle **🔊 Narration** (header, or on the cold-open). The narrator reads the
case briefing; each intern reads their statements in a distinct voice.

- **Free (default):** the browser's built-in Web Speech voices — zero setup,
  works offline, quality depends on the OS.
- **ElevenLabs (cinematic):** run `node server.js` with an API key. The key
  stays server-side; generated audio is cached to `frontend/.tts-cache/` so
  re-watching a game costs nothing after the first pass.

  ```bash
  # option 1: environment variable
  ELEVENLABS_API_KEY=sk_your_key node server.js

  # option 2: a local key file (gitignored)
  echo 'sk_your_key' > frontend/.tts-key
  node server.js
  ```

  With a key, `/tts/health` reports `enabled:true` and the frontend switches to
  ElevenLabs automatically (deep "George" narrator + distinct premade character
  voices). No key → it silently falls back to Web Speech. Both `.tts-key` and
  `.tts-cache/` are gitignored — the key is never committed or sent to the browser.

## Regenerate the game list

The picker reads `frontend/manifest.json`. Regenerate it whenever a game is
added or changed (dependency-free Node script):

```bash
cd frontend
node build-manifest.js
```

It globs `../murder_mystery/games/*/`, pulls title + victim from each game,
resolves headshots in `../images/`, and deliberately omits culprit/verdict so
the picker never spoils an outcome.

## Layout

- `index.html` — shell: fonts, Tailwind config (design tokens), mounts `#app`.
- `css/styles.css` — noir/corkboard design system, paper textures, string SVG,
  entrance beats, `prefers-reduced-motion` fallbacks.
- `js/data.js` — data loading, path resolution, avatar + document helpers.
- `js/state.js` — the single state object, event navigation, and `derive()`
  (a pure view-model computed from `events.filter(e => e.t <= currentT)`).
- `js/render.js` — the one `render()` entry point (picker vs. war room).
- `js/picker.js` — the case-file cabinet entry screen.
- `js/warroom.js` — the incident-room replay + Dossier view; `drawBoardStrings()`
  measures desk positions after layout to draw the red string.
- `js/main.js` — bootstrap, event delegation, keyboard, phase auto-advance.

## Controls

- `←` / `→` — step one event (includes tool calls, beliefs, phase markers).
- `Shift + ←/→` — jump between statements/accusations only.
- Timeline rail — click any tick; brackets mark Opening / Rounds / Accuse.
- Replay / Dossier toggle; `p` toggles private-thoughts (belief notebooks).
- Click any document reference or pinned card to open the evidence drawer.

The true culprit is never revealed until the final `win` beat is reached.

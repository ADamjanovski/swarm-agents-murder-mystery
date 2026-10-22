#!/usr/bin/env node
/*
 * build-manifest.js — tiny, dependency-free manifest generator.
 *
 * Scans the games directory and the shared images directory and writes
 * `frontend/manifest.json`, which the picker screen reads instead of
 * hardcoding game ids.
 *
 * IMPORTANT: this file deliberately excludes anything that would spoil the
 * outcome (culprit, convicted, winner). Those live in record.json /
 * meta.json and are only surfaced by the app during the final reveal beat.
 *
 * Run it whenever a game is added:  node build-manifest.js
 */
const fs = require('fs');
const path = require('path');

// Paths are resolved relative to this script (frontend/), matching the
// relative-path rule the app itself uses at runtime.
const HERE = __dirname;
const GAMES_DIR = path.resolve(HERE, '..', 'murder_mystery', 'games');
const IMAGES_DIR = path.resolve(HERE, '..', 'images');
const OUT = path.join(HERE, 'manifest.json');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Map lowercased first-name -> actual image filename that exists on disk.
function buildImageMap() {
  const map = {};
  let entries = [];
  try {
    entries = fs.readdirSync(IMAGES_DIR);
  } catch (e) {
    console.warn('! no images dir at', IMAGES_DIR);
  }
  for (const file of entries) {
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) continue;
    const key = path.basename(file, ext).toLowerCase();
    // Prefer the first extension we hit deterministically by ext priority.
    if (!map[key] || IMAGE_EXTS.indexOf(ext) < IMAGE_EXTS.indexOf(path.extname(map[key]).toLowerCase())) {
      map[key] = file;
    }
  }
  return map;
}

// Langfuse session export (one JSON object per line) — cost/token/duration
// telemetry per game. Joined to games by the game_id embedded in the session id.
function loadTraces() {
  const map = {};
  const file = path.join(GAMES_DIR, 'langfuse-games.jsonl');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return map; }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch (e) { continue; }
    const m = /game_\d+/.exec(d.id || '');
    if (!m) continue;
    const num = (x) => (x == null ? null : Number(x));
    map[m[0]] = {
      sessionId: d.id,
      tokens: num(d.totalTokens),
      cost: { input: num(d.inputCost), output: num(d.outputCost), total: num(d.totalCost) },
      sessionDuration: num(d.sessionDuration),
      countTraces: num(d.countTraces),
      tags: d.traceTags || [],
      createdAt: d.createdAt || null,
    };
  }
  return map;
}

function buildGames() {
  const traces = loadTraces();
  let dirs = [];
  try {
    dirs = fs.readdirSync(GAMES_DIR).filter((d) => /^game_\d+$/.test(d)).sort();
  } catch (e) {
    console.error('! no games dir at', GAMES_DIR);
    return [];
  }

  const games = [];
  for (const id of dirs) {
    const dir = path.join(GAMES_DIR, id);
    const meta = readJson(path.join(dir, 'meta.json')) || {};
    const record = readJson(path.join(dir, 'record.json'));
    if (!Array.isArray(record) || record.length === 0) {
      console.warn('~ skipping', id, '(empty or missing record.json)');
      continue;
    }

    const gameStart = record.find((e) => e && e.type === 'game_start') || {};
    const victim = gameStart.victim || null;

    // Cast: names only (no culprit flag) — safe for the picker.
    const castSource = meta.suspects || gameStart.suspects || [];
    const suspects = castSource.map((s) => s.name).filter(Boolean);

    // Rounds count is not a spoiler; grab it from result if present, else
    // count distinct discuss rounds.
    let rounds = meta.result && typeof meta.result.rounds === 'number'
      ? meta.result.rounds
      : new Set(
          record
            .filter((e) => e.type === 'phase' && e.phase === 'discuss')
            .map((e) => e.round)
        ).size;

    games.push({
      id,
      title: meta.title || gameStart.title || id,
      storyId: meta.story_id || null,
      victim, // {name, role, found, cause}
      suspects,
      suspectCount: suspects.length,
      rounds,
      eventCount: record.length,
      hasEvaluation: fs.existsSync(path.join(dir, 'evaluation.json')),
      trace: traces[id] || null, // Langfuse telemetry, if this game is in the export
    });
  }
  return games;
}

const manifest = {
  images: buildImageMap(),
  games: buildGames(),
};

fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `wrote ${OUT}\n  ${manifest.games.length} games, ${Object.keys(manifest.images).length} headshots`
);

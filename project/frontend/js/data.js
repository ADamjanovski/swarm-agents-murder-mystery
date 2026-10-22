// data.js — loading, path resolution, and small pure helpers.
// The frontend resolves game data relative to itself: games live one level
// up in the engine package, images share a single folder at the repo layer.

export const GAMES_BASE = '../murder_mystery/games';
export const IMAGES_BASE = '../images';
export const STORIES_BASE = '../murder_mystery/stories';

// ---- loading --------------------------------------------------------------

export async function loadManifest() {
  const res = await fetch('./manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest.json ${res.status}`);
  return res.json();
}

export async function loadGame(id) {
  const [recordRes, metaRes] = await Promise.all([
    fetch(`${GAMES_BASE}/${id}/record.json`, { cache: 'no-cache' }),
    fetch(`${GAMES_BASE}/${id}/meta.json`, { cache: 'no-cache' }).catch(() => null),
  ]);
  if (!recordRes.ok) throw new Error(`record.json ${recordRes.status}`);
  const records = await recordRes.json();
  let meta = null;
  if (metaRes && metaRes.ok) meta = await metaRes.json();

  // The LLM-judge evaluation of the finished game (new games only). Optional.
  let evaluation = null;
  try {
    const er = await fetch(`${GAMES_BASE}/${id}/evaluation.json`, { cache: 'no-cache' });
    if (er.ok) evaluation = await er.json();
  } catch (e) { /* no evaluation for this game */ }

  // The story's case.json carries the narrator briefing + setting used for the
  // cold-open situation beat. Optional — degrade gracefully if absent.
  let caseInfo = null;
  const storyId = meta && meta.story_id;
  if (storyId) {
    try {
      const cr = await fetch(`${STORIES_BASE}/${storyId}/case.json`, { cache: 'no-cache' });
      if (cr.ok) {
        const c = await cr.json();
        caseInfo = { narrator: c.narrator || null, setting: c.setting || null };
      }
    } catch (e) { /* no briefing available */ }
  }

  return { records, meta, caseInfo, evaluation };
}

// ---- names & avatars ------------------------------------------------------

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0].toLowerCase();
}

// Deterministic, pleasant color per name (for initials-avatar fallback).
export function colorForName(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 42% 38%)`;
}

// Resolve a headshot for a suspect from the manifest image map, or fall back
// to a deterministic initials avatar. Runs per selected game's cast.
export function avatarFor(name, imageMap) {
  const key = firstName(name);
  const file = imageMap && imageMap[key];
  if (file) return { type: 'img', src: `${IMAGES_BASE}/${file}` };
  const letter = (String(name || '?').trim()[0] || '?').toUpperCase();
  return { type: 'initial', letter, color: colorForName(name) };
}

// ---- documents ------------------------------------------------------------

const DOC_TYPES = [
  [/coroner/i, 'Coroner report'],
  [/cctv/i, 'CCTV notes'],
  [/wifi/i, 'Wi-Fi log'],
  [/badge/i, 'Badge log'],
  [/phone/i, 'Phone records'],
  [/walkie|radio/i, 'Walkie / radio log'],
  [/physical/i, 'Physical evidence'],
  [/finance|memo/i, 'Memo'],
  [/witness/i, 'Witness statement'],
  [/interview/i, 'Interview'],
  [/alibi/i, 'Alibi statement'],
];

export function docLabel(docId) {
  if (!docId) return 'Document';
  for (const [re, label] of DOC_TYPES) if (re.test(docId)) return label;
  return 'Document';
}

// Is this document an unforgeable instrumented log, or testimonial?
export function docIsInstrumented(docId) {
  return /coroner|cctv|wifi|badge|phone|walkie|radio|physical/i.test(docId || '');
}

export function prettyDocId(docId) {
  // "05_cctv_camera_notes.md" -> "cctv camera notes"
  return String(docId || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\d+[_-]?/, '')
    .replace(/[_-]+/g, ' ')
    .trim() || docId;
}

// Detect which of the given names appear in a block of text (word-boundary,
// case-insensitive) — used to pulse mentioned-but-not-speaking desks.
export function mentionsIn(text, names) {
  const t = String(text || '');
  const hit = new Set();
  for (const n of names) {
    const first = String(n).split(/\s+/)[0];
    const re = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(t)) hit.add(n);
  }
  return hit;
}

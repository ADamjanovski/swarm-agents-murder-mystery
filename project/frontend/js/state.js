// state.js — one plain state object + navigation + a pure derive() selector.
// Every user action mutates `state` then calls render(); render never mutates.

import { mentionsIn } from './data.js';

export const state = {
  manifest: null,
  loading: true,
  error: null,

  selectedGame: null, // game id, or null => picker
  records: [],
  meta: null,
  caseInfo: null, // { narrator, setting } from the story's case.json (cold-open briefing)
  evaluation: null, // LLM-judge evaluation.json for the game (or null)

  currentT: 0,
  viewMode: 'replay', // 'replay' | 'dossier'
  showPrivateThoughts: false,
  audioOn: false, // narrate briefing + statements via Web Speech
  focusedIntern: null, // name; drives private-corner focus + dossier subject
  drawerDocId: null, // evidence drawer target, or null

  coldOpen: false, // showing the one-time game_start intro
  playing: false, // autoplay is stepping through events on a timer
  lastStepDir: 0, // +1 fwd / -1 back / 0 none — lets render animate only fresh beats
};

// Events we never render during replay navigation.
const HIDDEN_TYPES = new Set(['ground_truth']);
// Events the "speaker skip" jumps between.
const SPEAKER_TYPES = new Set(['opening_statement', 'statement', 'accusation']);

// ---- navigation over the ordered event array ------------------------------

export function orderedTs() {
  return state.records.map((e) => e.t).sort((a, b) => a - b);
}

export function eventAtT(t) {
  return state.records.find((e) => e.t === t) || null;
}

function stepT(fromT, dir, predicate) {
  const ts = orderedTs();
  let i = ts.indexOf(fromT);
  if (i === -1) i = dir > 0 ? -1 : ts.length;
  for (let j = i + dir; j >= 0 && j < ts.length; j += dir) {
    const ev = eventAtT(ts[j]);
    if (!ev) continue;
    if (HIDDEN_TYPES.has(ev.type)) continue; // never land on ground_truth
    if (predicate && !predicate(ev)) continue;
    return ts[j];
  }
  return fromT; // clamp at ends
}

export function nextT(fromT = state.currentT) { return stepT(fromT, +1); }
export function prevT(fromT = state.currentT) { return stepT(fromT, -1); }
export function nextSpeakerT(fromT = state.currentT) {
  return stepT(fromT, +1, (e) => SPEAKER_TYPES.has(e.type));
}
export function prevSpeakerT(fromT = state.currentT) {
  return stepT(fromT, -1, (e) => SPEAKER_TYPES.has(e.type));
}

export function firstNavigableT() {
  const ts = orderedTs();
  for (const t of ts) {
    const ev = eventAtT(t);
    if (ev && !HIDDEN_TYPES.has(ev.type) && ev.type !== 'game_start') return t;
  }
  return ts[0] ?? 0;
}

export function lastT() {
  const ts = orderedTs();
  return ts[ts.length - 1] ?? 0;
}

// ---- derived view model (pure function of state) --------------------------

export function derive() {
  const recs = state.records;
  const shownAll = recs.filter((e) => e.t <= state.currentT);
  const shown = shownAll.filter((e) => !HIDDEN_TYPES.has(e.type));

  const gameStart = recs.find((e) => e.type === 'game_start') || null;
  const suspects = (gameStart?.suspects || state.meta?.suspects || []).map((s) =>
    typeof s === 'string' ? { name: s } : s
  );
  const names = suspects.map((s) => s.name);
  const victim = gameStart?.victim || null;
  const title = gameStart?.title || state.meta?.title || state.selectedGame;

  const current = eventAtT(state.currentT);

  // End state: a win event has been reached.
  const winEvent = recs.find((e) => e.type === 'win') || null;
  const resolutionEvent = recs.find((e) => e.type === 'resolution') || null;
  const hasReachedEnd = !!winEvent && state.currentT >= winEvent.t;
  const groundTruth = recs.find((e) => e.type === 'ground_truth') || null;

  // Current phase / round chapter.
  const phaseEvents = shown.filter((e) => e.type === 'phase');
  const currentPhase = phaseEvents[phaseEvents.length - 1] || null;

  // Active speaker + mentioned desks (from current event only).
  const activeActor = current && current.actor ? current.actor : null;
  let mentioned = new Set();
  if (current && (current.text || current.reason)) {
    mentioned = mentionsIn(current.text || current.reason, names);
    if (activeActor) mentioned.delete(activeActor);
  }
  if (current && current.type === 'accusation' && current.target) {
    mentioned.add(current.target);
  }

  // Board: pinned evidence from tool_calls, deduped by doc id, earliest first.
  const pinned = [];
  const pinIndex = new Map();
  for (const e of shown) {
    if (e.type !== 'tool_call') continue;
    const ids = Array.from(new Set(e.result_doc_ids || []));
    for (const id of ids) {
      if (!pinIndex.has(id)) {
        const entry = { docId: id, byActor: e.actor, tool: e.tool, firstT: e.t, ts: [e.t] };
        pinIndex.set(id, entry);
        pinned.push(entry);
      } else {
        pinIndex.get(id).ts.push(e.t);
      }
    }
  }

  // Board strings: mention edges (grey, undirected-ish) + accusation edges (red).
  const mentionPairs = new Map(); // key "a||b" -> {from,to,t}
  const accusationEdges = []; // {from,to,reason,docId,t}
  const accusationsSoFar = [];
  for (const e of shown) {
    if (e.type === 'statement' || e.type === 'opening_statement') {
      if (!e.actor || !e.text) continue;
      const hits = mentionsIn(e.text, names);
      hits.delete(e.actor);
      for (const to of hits) {
        const key = `${e.actor}||${to}`;
        if (!mentionPairs.has(key)) mentionPairs.set(key, { from: e.actor, to, t: e.t });
      }
    } else if (e.type === 'accusation') {
      accusationsSoFar.push(e);
      if (e.target) {
        accusationEdges.push({ from: e.actor, to: e.target, reason: e.reason, docId: e.doc_id, t: e.t });
      }
    }
  }

  // Per-suspect private state: latest belief notes + own event lists.
  const bySuspect = {};
  for (const n of names) bySuspect[n] = { belief: null, statements: [], toolCalls: [], accusation: null };
  for (const e of shown) {
    const who = e.actor;
    if (!who || !(who in bySuspect)) continue;
    if (e.type === 'belief') bySuspect[who].belief = e; // keep latest
    else if (e.type === 'statement' || e.type === 'opening_statement') bySuspect[who].statements.push(e);
    else if (e.type === 'tool_call') bySuspect[who].toolCalls.push(e);
    else if (e.type === 'accusation') bySuspect[who].accusation = e;
  }

  const inAccusePhase = currentPhase && currentPhase.phase === 'accuse';

  return {
    shown, gameStart, suspects, names, victim, title,
    current, currentPhase, activeActor, mentioned,
    pinned, mentionPairs: [...mentionPairs.values()], accusationEdges, accusationsSoFar,
    bySuspect, inAccusePhase,
    hasReachedEnd, winEvent, resolutionEvent, groundTruth,
  };
}

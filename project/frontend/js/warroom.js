// warroom.js — the incident-room replay view (and its Dossier variant).
// Exposes renderWarRoom(dv) -> HTML string, plus drawBoardStrings() which runs
// after the markup is in the DOM to draw the red string between desks.

import { state } from './state.js';
import {
  avatarFor, docLabel, prettyDocId, docIsInstrumented, mentionsIn,
} from './data.js';

// ---------- small shared bits ----------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function images() { return state.manifest?.images || {}; }

// every doc id that appears anywhere in the transcript (for link resolution)
function allDocIds() {
  const set = new Set();
  for (const e of state.records) {
    for (const d of e.result_doc_ids || []) set.add(d);
    if (e.doc_id) set.add(e.doc_id);
  }
  return set;
}

// Which doc ids does a block of prose actually reference? Mirrors linkifyDocs'
// resolution: exact filenames, "Document ID: NN" by numeric prefix, and the
// human doc name (e.g. "coroner report"). Used by the evidence drawer so
// "cited in statements" reflects real references, not raw filenames.
function refsInText(text) {
  const t = String(text || '');
  const ids = [...allDocIds()];
  const found = new Set();
  for (const id of ids) {
    if (t.includes(id)) { found.add(id); continue; }
    const name = prettyDocId(id);
    if (name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) found.add(id);
  }
  let m;
  const re = /\bDocument\s*ID:?\s*(\d{1,2})\b/gi;
  while ((m = re.exec(t))) {
    const num = m[1];
    const n = num.padStart(2, '0');
    const match = ids.find((id) => id.startsWith(n + '_') || id.startsWith(num + '_'));
    if (match) found.add(match);
  }
  return found;
}

// Turn a block of statement text into HTML with clickable doc references.
function linkifyDocs(text) {
  let html = esc(text);
  const ids = [...allDocIds()];
  // 1) exact doc-id filenames present in the text
  for (const id of ids) {
    if (!html.includes(esc(id))) continue;
    const re = new RegExp(esc(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    html = html.replace(re, `<button class="doc-link" data-action="doc" data-doc="${esc(id)}">${esc(prettyDocId(id))}</button>`);
  }
  // 2) "Document ID: 01" style references -> resolve to id sharing that number
  html = html.replace(/\(?\bDocument\s*ID:?\s*(\d{1,2})\b\)?/gi, (m, num) => {
    const n = num.padStart(2, '0');
    const match = ids.find((id) => id.startsWith(n + '_') || id.startsWith(num + '_'));
    if (!match) return m;
    return `<button class="doc-link" data-action="doc" data-doc="${esc(match)}">${esc(prettyDocId(match))}</button>`;
  });
  return html;
}

function avatarInner(name, sizeClass) {
  const a = avatarFor(name, images());
  if (a.type === 'img') {
    return `<img src="${esc(a.src)}" alt="${esc(name)}"
      class="${sizeClass} object-cover w-full h-full"
      onerror="this.onerror=null;this.style.display='none';this.parentElement.classList.add('avatar-initial');this.parentElement.style.background='${a.color}';this.parentElement.textContent='${esc((name[0]||'?').toUpperCase())}'" />`;
  }
  return `<span class="avatar-initial w-full h-full text-xl" style="background:${a.color}">${esc(a.letter)}</span>`;
}

// ---------- desks -----------------------------------------------------------

function desk(sus, dv) {
  const name = sus.name;
  const isActive = dv.activeActor === name && state.viewMode === 'replay';
  const isMentioned = dv.mentioned.has(name);
  const isFocused = state.focusedIntern === name;

  let cls = 'desk relative flex flex-col items-center gap-1 select-none';
  if (isActive) cls += ' active';
  else if (dv.activeActor) cls += ' dimmed';
  if (isMentioned) cls += ' mentioned';

  // final reveal flags
  if (dv.hasReachedEnd && dv.groundTruth) {
    if (name === dv.groundTruth.culprit) cls += ' culprit-final';
    if (dv.winEvent && name === dv.winEvent.convicted && name !== dv.groundTruth.culprit) cls += ' convicted-final';
  }

  const ring = isFocused ? 'ring-2 ring-gold' : 'ring-1 ring-black/40';
  const investigating = isActive && dv.current && dv.current.type === 'tool_call';

  return `
  <button type="button" data-action="focus" data-name="${esc(name)}" data-desk="${esc(name)}"
    class="${cls}" title="${esc(sus.personality || name)}">
    <span class="lamp"></span>
    <div class="desk-photo relative w-16 h-16 md:w-[72px] md:h-[72px] rounded-full overflow-hidden ${ring} bg-noir-800">
      ${avatarInner(name)}
      ${investigating ? '<span class="absolute -bottom-1 -right-1 text-sm">🔎</span>' : ''}
    </div>
    <span class="font-display uppercase tracking-wide text-[13px] ${isActive ? 'text-gold-bright' : 'text-white/70'}">${esc(name)}</span>
  </button>`;
}

// ---------- evidence pins on the board --------------------------------------

function evidencePin(entry, dv, i) {
  const fresh = entry.firstT === state.currentT ? 'pin-in' : '';
  const rot = ((entry.docId.charCodeAt(0) + i) % 7) - 3;
  const instrumented = docIsInstrumented(entry.docId);
  return `
  <button type="button" data-action="doc" data-doc="${esc(entry.docId)}"
    class="paper relative rounded-sm px-3 py-2 text-left w-[132px] ${fresh}"
    style="--rot:${rot}deg; transform:rotate(${rot}deg)">
    <span class="pin ${instrumented ? '' : 'gold'}"></span>
    <div class="font-type text-[10px] tracking-wide ${instrumented ? 'text-crimson' : 'text-cork-dark'}">
      ${instrumented ? 'LOG · SEALED' : 'TESTIMONY'}
    </div>
    <div class="font-type text-[11px] leading-tight text-ink mt-1">${esc(prettyDocId(entry.docId))}</div>
    <div class="text-[10px] text-ink/50 mt-1">via ${esc(entry.byActor || '—')}</div>
  </button>`;
}

// ---------- the center stage card (current event) ---------------------------

function actorTag(name, dv) {
  const sus = dv.suspects.find((s) => s.name === name);
  const persona = sus?.personality ? esc(sus.personality).slice(0, 70) + '…' : '';
  return `
  <div class="flex items-center gap-3">
    <div class="w-11 h-11 rounded-full overflow-hidden ring-2 ring-gold/60 bg-noir-800 shrink-0">
      ${avatarInner(name)}
    </div>
    <div>
      <div class="font-display uppercase tracking-wide text-gold-bright text-lg leading-none">${esc(name)}</div>
      <div class="text-[11px] text-white/40 mt-0.5">${persona}</div>
    </div>
  </div>`;
}

function stageCard(dv) {
  const e = dv.current;
  if (!e) return '';

  // header eyebrow varies by type
  const wrap = (eyebrow, accent, body, extraClass = '') =>
    `<div class="stage-card beat-in ${extraClass}" data-beat="${e.t}">
       <div class="font-type text-[11px] tracking-wider2 ${accent}">${eyebrow}</div>
       <div class="mt-3">${body}</div>
     </div>`;

  switch (e.type) {
    case 'game_start':
      return wrap('CASE FILE OPENED', 'text-gold',
        `<p class="text-white/70 text-sm">The room has assembled. Step forward with → to begin
          the opening statements.</p>`);

    case 'phase': {
      const label = `${e.phase === 'opening' ? 'OPENING STATEMENTS'
        : e.phase === 'accuse' ? 'THE ACCUSATION'
        : `ROUND ${e.round} · DISCUSS`}`;
      return `<div class="stage-card phase-beat text-center" data-beat="${e.t}">
          <div class="font-type text-crimson text-xs tracking-wider2">— SECTION —</div>
          <div class="font-display text-4xl md:text-5xl tracking-wide text-paper mt-2">${label}</div>
        </div>`;
    }

    case 'opening_statement':
    case 'statement': {
      const eyebrow = e.type === 'opening_statement' ? 'OPENING STATEMENT · ON RECORD' : `STATEMENT · ROUND ${e.round ?? ''}`;
      return wrap(eyebrow, 'text-gold',
        `${actorTag(e.actor, dv)}
         <div class="mt-3 text-[15px] leading-relaxed text-white/85 max-h-[34vh] overflow-y-auto pr-2 whitespace-pre-line">${linkifyDocs(e.text)}</div>`);
    }

    case 'tool_call': {
      const ids = [...new Set(e.result_doc_ids || [])];
      const args = Object.entries(e.args || {})
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `<span class="text-white/45">${esc(k)}:</span> <span class="text-white/80">${esc(v)}</span>`)
        .join(' &nbsp;·&nbsp; ');
      const chips = ids.length
        ? ids.map((id) => `<button data-action="doc" data-doc="${esc(id)}"
              class="doc-chip">${esc(prettyDocId(id))}</button>`).join('')
        : '<span class="text-white/40 text-sm">no documents returned</span>';
      return wrap('INVESTIGATING · PRIVATE LINE OF INQUIRY', 'text-white/50',
        `${actorTag(e.actor, dv)}
         <div class="mt-3 font-type text-sm text-white/80">
           pulled <span class="text-gold-bright">${esc(e.tool)}</span>(${args})
         </div>
         <div class="mt-3 text-[11px] text-white/40 tracking-wide">RETRIEVED & PINNED TO BOARD</div>
         <div class="mt-2 flex flex-wrap gap-2">${chips}</div>`);
    }

    case 'belief': {
      if (!state.showPrivateThoughts) {
        return wrap('PRIVATE NOTEBOOK · HIDDEN', 'text-private',
          `<p class="text-white/55 text-sm">${esc(e.actor)} jotted private suspicions.
             These are metagame notes the other interns never hear.</p>
           <button data-action="toggle-private" class="mt-3 text-sm px-3 py-1.5 rounded
             bg-private/20 text-private hover:bg-private/30 border border-private/40">
             Reveal private thoughts
           </button>`);
      }
      const notes = e.notes && typeof e.notes === 'object'
        ? Object.entries(e.notes).map(([who, note]) =>
            `<div class="mb-2"><span class="font-hand text-lg text-private-ink">${esc(who)}:</span>
              <span class="font-hand text-lg text-private-ink/85"> ${esc(note)}</span></div>`).join('')
        : `<div class="font-hand text-lg text-private-ink">${esc(e.notes)}</div>`;
      return `<div class="stage-card beat-in" data-beat="${e.t}">
          <div class="font-type text-[11px] tracking-wider2 text-private">${esc(e.actor)}'S PRIVATE NOTEBOOK</div>
          <div class="index-card rounded-sm p-4 mt-3 max-h-[34vh] overflow-y-auto">${notes}</div>
        </div>`;
    }

    case 'accusation': {
      const target = e.target
        ? `<span class="text-crimson-bright font-display text-2xl uppercase">${esc(e.target)}</span>`
        : `<span class="text-white/50 italic">no one — undirected</span>`;
      const cite = e.doc_id
        ? `<button data-action="doc" data-doc="${esc(e.doc_id)}" class="doc-chip mt-2">cites: ${esc(prettyDocId(e.doc_id))}</button>`
        : `<div class="text-white/40 text-xs mt-2">no document cited</div>`;
      return wrap('ACCUSATION', 'text-crimson-bright',
        `${actorTag(e.actor, dv)}
         <div class="mt-3 text-white/70">points the finger at → ${target}</div>
         ${e.reason ? `<p class="mt-2 text-sm text-white/70 leading-relaxed">${linkifyDocs(e.reason)}</p>` : ''}
         ${cite}`, 'ring-1 ring-crimson/40');
    }

    case 'resolution': {
      const tally = e.tally || {};
      const max = Math.max(1, ...Object.values(tally));
      const rows = dv.names
        .map((n) => ({ n, v: tally[n] || 0 }))
        .sort((a, b) => b.v - a.v)
        .map(({ n, v }) => `
          <div class="flex items-center gap-2 mb-1.5">
            <div class="w-16 text-right text-[13px] ${n === e.convicted ? 'text-gold-bright font-semibold' : 'text-white/60'}">${esc(n)}</div>
            <div class="flex-1 h-5 bg-black/30 rounded-sm overflow-hidden">
              <div class="tally-fill h-full ${n === e.convicted ? 'bg-gold' : 'bg-crimson/70'}"
                   style="width:${(v / max) * 100}%"></div>
            </div>
            <div class="w-6 text-white/70 text-sm">${v}</div>
          </div>`).join('');
      return wrap('THE VOTE', 'text-gold',
        `${rows}
         <div class="mt-3 text-sm text-white/70">Convicted:
           <span class="text-gold-bright font-semibold">${esc(e.convicted || 'no one')}</span></div>`);
    }

    case 'win':
      return wrap('VERDICT', 'text-gold', `<p class="text-white/70 text-sm">See the reveal.</p>`);

    default:
      return wrap(esc(e.type).toUpperCase(), 'text-white/50', '');
  }
}

// ---------- private corner (belief peek for the active/focused actor) -------

function privateCorner(dv) {
  if (!state.showPrivateThoughts) return '';
  const who = state.focusedIntern || dv.activeActor;
  if (!who) return '';
  const b = dv.bySuspect[who]?.belief;
  if (!b || dv.current?.type === 'belief') return ''; // don't double up with stage
  const notes = b.notes && typeof b.notes === 'object'
    ? Object.entries(b.notes).slice(0, 4).map(([w, note]) =>
        `<div class="mb-1"><span class="font-hand text-base text-private-ink">${esc(w)}:</span>
          <span class="font-hand text-base text-private-ink/80"> ${esc(note)}</span></div>`).join('')
    : '';
  if (!notes) return '';
  return `
  <div class="absolute bottom-3 left-3 w-60 index-card rounded-sm p-3 rotate-[-2deg] z-20 fade-in">
    <div class="font-type text-[10px] text-private tracking-wide mb-1">${esc(who)}'S NOTEBOOK</div>
    ${notes}
  </div>`;
}

// ---------- reveal overlay (win) --------------------------------------------

function revealOverlay(dv) {
  if (!dv.hasReachedEnd || dv.current?.type !== 'win') return '';
  const w = dv.winEvent;
  const correct = w.convicted === w.culprit;
  const grounded = w.grounded_accusations ?? 0;
  const total = w.total_accusations ?? 0;
  return `
  <div class="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
    <div class="reveal-card paper rounded-lg max-w-lg w-full p-8 text-center relative">
      <div class="font-type text-crimson tracking-wider2 text-sm">— CASE CLOSED —</div>
      <div class="mt-4 grid grid-cols-2 gap-4">
        <div class="rounded-md bg-black/5 p-4">
          <div class="text-[11px] font-type text-ink/50">CONVICTED</div>
          <div class="font-display text-3xl text-ink mt-1">${esc(w.convicted || 'no one')}</div>
        </div>
        <div class="rounded-md ${correct ? 'bg-gold/20' : 'bg-crimson/15'} p-4">
          <div class="text-[11px] font-type text-ink/50">TRUE CULPRIT</div>
          <div class="font-display text-3xl mt-1 ${correct ? 'text-cork-dark' : 'text-crimson'}">${esc(w.culprit)}</div>
        </div>
      </div>
      <div class="mt-5 font-display text-2xl uppercase tracking-wide ${correct ? 'text-cork-dark' : 'text-crimson'}">
        ${correct ? 'The interns got it right' : 'The culprit walked'}
      </div>
      <div class="mt-1 text-sm text-ink/60">
        Winner: <span class="font-semibold">${esc(w.winner)}</span>
      </div>
      <div class="mt-4 inline-block font-type text-[12px] text-ink/70 border border-ink/20 rounded px-3 py-1.5">
        verdict solidity — ${grounded}/${total} accusations grounded in hard evidence
      </div>
    </div>
  </div>`;
}

// ---------- header + rail + nav ---------------------------------------------

function headerBar(dv) {
  const phase = dv.currentPhase
    ? (dv.currentPhase.phase === 'discuss'
        ? `ROUND ${dv.currentPhase.round} · DISCUSS`
        : dv.currentPhase.phase.toUpperCase())
    : 'PRELUDE';
  const modeBtn = (m, label) =>
    `<button data-action="mode" data-mode="${m}"
       class="px-3 py-1 text-sm rounded ${state.viewMode === m ? 'bg-gold text-noir-900 font-semibold' : 'text-white/60 hover:text-white'}">${label}</button>`;
  return `
  <header class="flex items-center gap-4 px-5 py-3 border-b border-noir-line bg-noir-900/80 backdrop-blur z-30">
    <button data-action="to-picker" class="font-type text-sm text-white/60 hover:text-gold-bright shrink-0">‹ ALL CASES</button>
    <div class="min-w-0">
      <div class="font-display text-xl leading-none text-paper truncate">${esc(dv.title)}</div>
      <div class="text-[11px] text-white/40 truncate">
        ${dv.victim ? `victim: ${esc(dv.victim.name)} · ${esc(dv.victim.role || '')}` : ''}
      </div>
    </div>
    <div class="ml-auto flex items-center gap-3 shrink-0">
      <span class="font-type text-[11px] tracking-wide text-crimson border border-crimson/40 rounded px-2 py-1">${phase}</span>
      <div class="flex items-center rounded bg-black/30 p-0.5">${modeBtn('replay', 'Replay')}${modeBtn('dossier', 'Dossier')}${state.evaluation ? modeBtn('evaluation', '⚖ Verdict') : ''}</div>
      <button data-action="toggle-audio" title="Read the briefing and statements aloud"
        class="px-3 py-1.5 text-sm rounded border ${state.audioOn ? 'bg-gold/25 border-gold/50 text-gold-bright' : 'border-white/15 text-white/50 hover:text-white'}">
        ${state.audioOn ? '🔊 Narration' : '🔇 Narration'}
      </button>
      <button data-action="toggle-private"
        class="px-3 py-1.5 text-sm rounded border ${state.showPrivateThoughts ? 'bg-private/25 border-private/50 text-private' : 'border-white/15 text-white/50 hover:text-white'}">
        ${state.showPrivateThoughts ? '👁 Private thoughts on' : 'Private thoughts off'}
      </button>
    </div>
  </header>`;
}

const TICK_COLORS = {
  statement: 'bg-sky-500', opening_statement: 'bg-sky-400',
  tool_call: 'bg-white/25', belief: 'bg-private', accusation: 'bg-crimson',
  resolution: 'bg-gold', win: 'bg-gold-bright', phase: 'bg-white/40', game_start: 'bg-white/40',
};

function timelineRail(dv) {
  const evs = state.records.filter((e) => e.type !== 'ground_truth').sort((a, b) => a.t - b.t);

  // phase brackets: group events by the phase that precedes them
  const brackets = [];
  let label = 'Prelude', startIdx = 0;
  evs.forEach((e, i) => {
    if (e.type === 'phase') {
      if (i > startIdx) brackets.push({ label, from: startIdx, to: i - 1 });
      label = e.phase === 'discuss' ? `Round ${e.round}` : e.phase[0].toUpperCase() + e.phase.slice(1);
      startIdx = i;
    }
  });
  brackets.push({ label, from: startIdx, to: evs.length - 1 });

  const total = evs.length;
  const bracketBar = brackets.map((b) => {
    const w = ((b.to - b.from + 1) / total) * 100;
    return `<div class="text-center text-[9px] font-type tracking-wide text-white/35 border-l border-white/10 truncate px-1"
             style="width:${w}%">${esc(b.label)}</div>`;
  }).join('');

  const ticks = evs.map((e) => {
    const active = e.t === state.currentT;
    const past = e.t < state.currentT;
    const color = TICK_COLORS[e.type] || 'bg-white/30';
    return `<button data-action="goto" data-t="${e.t}" title="${esc(e.type)} · t${e.t}"
      class="group relative flex-1 min-w-[3px] h-full flex items-end justify-center"
      >
      <span class="w-full ${active ? 'h-full' : 'h-2/3'} ${color} rounded-sm
        ${active ? 'ring-2 ring-gold-bright' : past ? 'opacity-90' : 'opacity-30'}
        group-hover:opacity-100 transition-opacity"></span>
    </button>`;
  }).join('');

  return `
  <div class="px-5 pt-2">
    <div class="flex w-full mb-1">${bracketBar}</div>
    <div class="flex items-stretch gap-[1px] h-8 w-full">${ticks}</div>
  </div>`;
}

function navBar(dv) {
  const btn = (action, label, title, big = false) =>
    `<button data-action="${action}" title="${title}"
      class="px-3 ${big ? 'py-2 text-lg' : 'py-2 text-sm'} rounded bg-noir-800 hover:bg-noir-700
             text-white/80 border border-noir-line disabled:opacity-30">${label}</button>`;
  const pos = `t ${state.currentT} / ${dv.shown.length ? Math.max(...state.records.map(r=>r.t)) : 0}`;
  const playing = state.playing;
  const playBtn = `<button data-action="toggle-play"
    title="${playing ? 'Pause autoplay (space)' : 'Play through the case (space)'}"
    aria-label="${playing ? 'Pause' : 'Play'}"
    class="px-4 py-2 rounded-full font-display text-lg leading-none border
      ${playing
        ? 'bg-gold text-noir-900 border-gold shadow-[0_0_18px_rgba(216,171,84,0.5)]'
        : 'bg-noir-800 text-gold-bright border-gold/50 hover:bg-noir-700'}">
    ${playing ? '❚❚' : '►'}</button>`;
  return `
  <div class="flex items-center justify-center gap-2 px-5 py-3">
    ${btn('prev-speaker', '⏮ speaker', 'Previous statement/accusation')}
    ${btn('prev', '←', 'Previous event (one step)', true)}
    ${playBtn}
    <span class="font-type text-xs text-white/40 w-24 text-center">${pos}</span>
    ${btn('next', '→', 'Next event (one step)', true)}
    ${btn('next-speaker', 'speaker ⏭', 'Next statement/accusation')}
  </div>`;
}

// ---------- evidence drawer -------------------------------------------------

function evidenceDrawer(dv) {
  const id = state.drawerDocId;
  if (!id) return '';
  // gather retrieval + citation info from events shown so far, aggregated by
  // actor so a heavily-pulled doc doesn't produce a hundred rows.
  const retMap = new Map(); // actor -> {count, tools:Set, lastT}
  const citeMap = new Map(); // actor -> {count, lastT}
  for (const e of dv.shown) {
    if (e.type === 'tool_call' && (e.result_doc_ids || []).includes(id)) {
      const r = retMap.get(e.actor) || { count: 0, tools: new Set(), lastT: 0 };
      r.count++; r.tools.add(e.tool); r.lastT = Math.max(r.lastT, e.t);
      retMap.set(e.actor, r);
    }
    const cites = e.type === 'accusation' && e.doc_id === id;
    const inText = (e.type === 'statement' || e.type === 'opening_statement') && refsInText(e.text).has(id);
    if (cites || inText) {
      const c = citeMap.get(e.actor) || { count: 0, lastT: 0 };
      c.count++; c.lastT = Math.max(c.lastT, e.t);
      citeMap.set(e.actor, c);
    }
  }
  const retrievedBy = [...retMap.entries()].sort((a, b) => b[1].count - a[1].count);
  const citedIn = [...citeMap.entries()].sort((a, b) => b[1].count - a[1].count);
  const instrumented = docIsInstrumented(id);
  const list = (arr, empty, fmt) =>
    arr.length ? `<ul class="space-y-1">${arr.map(fmt).join('')}</ul>`
               : `<div class="text-white/35 text-sm">${empty}</div>`;

  return `
  <div class="absolute inset-0 z-50" data-action="close-drawer">
    <div class="absolute inset-0 bg-black/50"></div>
    <div class="drawer absolute top-0 right-0 h-full w-full max-w-md bg-noir-850 border-l border-noir-line
                p-6 overflow-y-auto shadow-2xl" onclick="event.stopPropagation()">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-type text-[11px] tracking-wider2 ${instrumented ? 'text-crimson' : 'text-gold'}">
            ${instrumented ? 'INSTRUMENTED LOG · TAMPER-EVIDENT' : 'TESTIMONIAL EVIDENCE'}
          </div>
          <h2 class="font-display text-2xl text-paper mt-1">${esc(prettyDocId(id))}</h2>
          <div class="font-type text-xs text-white/40 mt-1">${esc(id)} · ${esc(docLabel(id))}</div>
        </div>
        <button data-action="close-drawer" class="text-white/50 hover:text-white text-xl leading-none">✕</button>
      </div>

      <div class="mt-6">
        <div class="font-type text-[11px] text-white/50 tracking-wide mb-2">RETRIEVED BY</div>
        ${list(retrievedBy, 'Not retrieved yet at this point in the replay.',
          ([actor, r]) => `<li class="text-sm text-white/75">${esc(actor)}
            <span class="text-white/40">· ${r.count}× via ${esc([...r.tools].join(', '))}</span></li>`)}
      </div>

      <div class="mt-6">
        <div class="font-type text-[11px] text-white/50 tracking-wide mb-2">CITED IN STATEMENTS</div>
        ${list(citedIn, 'Not cited in public statements yet.',
          ([actor, c]) => `<li class="text-sm text-white/75">${esc(actor)}
            <span class="text-white/40">· ${c.count}×</span></li>`)}
      </div>

      <p class="mt-8 text-xs text-white/30 leading-relaxed border-t border-noir-line pt-4">
        The transcript records evidence by reference only — retrieval and citation
        metadata is shown here rather than fabricated document text.
      </p>
    </div>
  </div>`;
}

// ---------- cold open -------------------------------------------------------

function coldOpen(dv) {
  if (!state.coldOpen || !dv.gameStart) return '';
  const v = dv.victim || {};
  const cast = (dv.gameStart.suspects || []).map((s) => `
    <div class="flex items-center gap-3 py-2">
      <div class="w-12 h-12 rounded-full overflow-hidden ring-1 ring-white/20 bg-noir-800 shrink-0">${avatarInner(s.name)}</div>
      <div class="min-w-0">
        <div class="font-display uppercase tracking-wide text-white/90 text-sm">${esc(s.name)}</div>
        <div class="text-[11px] text-white/45 truncate">${esc((s.personality || '').slice(0, 90))}…</div>
      </div>
    </div>`).join('');
  return `
  <div class="absolute inset-0 z-50 bg-noir-950 overflow-y-auto">
    <div class="max-w-3xl mx-auto px-6 py-12">
      <div class="text-center">
        <div class="font-type text-crimson tracking-wider2 text-sm">— THE CASE —</div>
        <h1 class="font-display text-5xl md:text-6xl text-paper mt-2">${esc(dv.title)}</h1>
      </div>

      ${state.caseInfo && state.caseInfo.narrator ? `
      <figure class="mt-8 border-l-2 border-gold/50 pl-5">
        <div class="font-type text-[11px] text-gold tracking-wider2 mb-2">THE BRIEFING</div>
        <blockquote class="text-white/85 text-lg md:text-xl leading-relaxed italic">${esc(state.caseInfo.narrator)}</blockquote>
      </figure>` : ''}

      ${state.caseInfo && state.caseInfo.setting ? `
      <p class="mt-5 text-sm text-white/50 leading-relaxed">
        <span class="font-type text-[11px] text-white/40 tracking-wider2">SETTING · </span>${esc(state.caseInfo.setting)}
      </p>` : ''}

      <div class="paper rounded-md p-6 mt-8">
        <div class="font-type text-[11px] text-crimson tracking-wider2">VICTIM</div>
        <div class="font-display text-3xl text-ink mt-1">${esc(v.name || 'Unknown')}</div>
        <div class="text-ink/70 text-sm mt-1">${esc(v.role || '')}</div>
        <div class="grid sm:grid-cols-2 gap-3 mt-4 text-sm">
          ${v.found ? `<div><span class="font-type text-[11px] text-ink/50">FOUND</span><br/>${esc(v.found)}</div>` : ''}
          ${v.cause ? `<div><span class="font-type text-[11px] text-ink/50">CAUSE</span><br/>${esc(v.cause)}</div>` : ''}
        </div>
      </div>
      <div class="mt-8">
        <div class="font-type text-[11px] text-white/50 tracking-wider2 mb-2">THE ROOM · ${dv.suspects.length} INTERNS</div>
        <div class="grid sm:grid-cols-2 gap-x-8">${cast}</div>
      </div>
      <div class="text-center mt-10 flex flex-col items-center gap-3">
        <button data-action="toggle-audio"
          class="px-4 py-2 rounded-full text-sm border ${state.caseInfo && state.caseInfo.narrator ? '' : 'hidden'}
            ${state.audioOn ? 'bg-gold/20 border-gold/50 text-gold-bright' : 'border-white/20 text-white/60 hover:text-white'}">
          ${state.audioOn ? '🔊 Narration on — read the briefing aloud' : '🔇 Read the briefing aloud'}
        </button>
        <button data-action="begin"
          class="px-6 py-3 rounded bg-gold text-noir-900 font-display uppercase tracking-wide text-lg hover:bg-gold-bright">
          Enter the War Room ▸
        </button>
      </div>
    </div>
  </div>`;
}

// ---------- dossier mode ----------------------------------------------------

function dossierView(dv) {
  const who = state.focusedIntern;
  if (!who) {
    const pick = dv.suspects.map((s) => `
      <button data-action="focus" data-name="${esc(s.name)}"
        class="paper rounded-md p-4 flex items-center gap-3 hover:-translate-y-0.5 transition-transform">
        <div class="w-12 h-12 rounded-full overflow-hidden ring-1 ring-black/30 bg-noir-800 shrink-0">${avatarInner(s.name)}</div>
        <div class="text-left"><div class="font-display uppercase text-ink">${esc(s.name)}</div>
          <div class="text-[11px] text-ink/50">read their case</div></div>
      </button>`).join('');
    return `<div class="p-8 overflow-y-auto h-full">
        <div class="font-type text-white/50 tracking-wider2 text-sm mb-4">DOSSIER — CHOOSE AN INTERN</div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl">${pick}</div>
      </div>`;
  }

  const s = dv.bySuspect[who] || { statements: [], toolCalls: [], belief: null };
  // full record for this person (not gated by currentT — the ending is known here)
  const own = state.records.filter((e) => e.actor === who && e.type !== 'ground_truth')
    .sort((a, b) => a.t - b.t);

  const block = (e) => {
    if (e.type === 'opening_statement' || e.type === 'statement') {
      return `<div class="paper rounded-md p-4 mb-3">
        <div class="font-type text-[11px] text-crimson">${e.type === 'opening_statement' ? 'OPENING' : 'ROUND ' + (e.round ?? '')}</div>
        <p class="text-ink text-sm mt-1 whitespace-pre-line leading-relaxed">${linkifyDocs(e.text)}</p></div>`;
    }
    if (e.type === 'tool_call') {
      const ids = [...new Set(e.result_doc_ids || [])];
      return `<div class="rounded-md p-3 mb-3 bg-noir-800 border border-noir-line">
        <div class="font-type text-xs text-white/60">🔎 ${esc(e.tool)}(${esc(Object.values(e.args || {}).filter(Boolean).join(', '))})</div>
        <div class="flex flex-wrap gap-1.5 mt-2">${ids.map((id) => `<button data-action="doc" data-doc="${esc(id)}" class="doc-chip">${esc(prettyDocId(id))}</button>`).join('')}</div>
      </div>`;
    }
    if (e.type === 'belief' && state.showPrivateThoughts) {
      const notes = e.notes && typeof e.notes === 'object'
        ? Object.entries(e.notes).map(([w, n]) => `<div><span class="font-hand text-lg text-private-ink">${esc(w)}:</span> <span class="font-hand text-lg text-private-ink/80">${esc(n)}</span></div>`).join('')
        : '';
      return `<div class="index-card rounded-md p-4 mb-3"><div class="font-type text-[10px] text-private mb-1">PRIVATE NOTEBOOK</div>${notes}</div>`;
    }
    if (e.type === 'belief') {
      return `<div class="rounded-md p-3 mb-3 border border-dashed border-private/40 text-private/70 text-sm">
        Private notebook hidden — <button data-action="toggle-private" class="underline">reveal</button></div>`;
    }
    if (e.type === 'accusation') {
      return `<div class="paper rounded-md p-4 mb-3 ring-1 ring-crimson/40">
        <div class="font-type text-[11px] text-crimson">ACCUSATION → ${esc(e.target || 'no one')}</div>
        <p class="text-ink text-sm mt-1">${linkifyDocs(e.reason || '')}</p></div>`;
    }
    return '';
  };

  return `
  <div class="h-full overflow-y-auto p-6 md:p-10">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center gap-4 mb-6">
        <button data-action="focus" data-name="" class="text-white/50 hover:text-white font-type text-sm">‹ interns</button>
        <div class="w-16 h-16 rounded-full overflow-hidden ring-2 ring-gold/60 bg-noir-800">${avatarInner(who)}</div>
        <div>
          <div class="font-display text-3xl text-paper uppercase leading-none">${esc(who)}</div>
          <div class="text-xs text-white/45 max-w-md mt-1">${esc(dv.suspects.find((x) => x.name === who)?.personality || '')}</div>
        </div>
      </div>
      ${own.map(block).join('') || '<div class="text-white/40">No events for this intern.</div>'}
    </div>
  </div>`;
}

// ---------- evaluation (LLM-judge verdict) ----------------------------------

const SCORE_COLORS = { 1: '#c22a2a', 2: '#c8702a', 3: '#d8ab54', 4: '#9fae54', 5: '#6fae6f' };
const SCORE_MAX = 5;

function scoreColor(n) { return SCORE_COLORS[Math.round(n)] || 'rgba(255,255,255,0.3)'; }

function titleCase(key) {
  return String(key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreMeter(score, max = SCORE_MAX) {
  const s = Math.max(0, Math.min(max, Number(score) || 0));
  const segs = Array.from({ length: max }, (_, i) =>
    `<span class="h-2.5 w-7 rounded-sm" style="background:${i < s ? scoreColor(s) : 'rgba(255,255,255,0.10)'}"></span>`
  ).join('');
  return `<span class="inline-flex gap-1 align-middle">${segs}</span>`;
}

function statTile(label, value, sub) {
  return `
  <div class="rounded-md bg-black/30 border border-noir-line p-3">
    <div class="font-type text-[10px] tracking-wider2 text-white/40">${esc(label)}</div>
    <div class="font-display text-2xl text-paper leading-tight mt-1">${value}</div>
    ${sub ? `<div class="text-[11px] text-white/45 mt-0.5">${esc(sub)}</div>` : ''}
  </div>`;
}

function pct(x) { return x == null ? '—' : `${Math.round(x * 100)}%`; }

function exampleQuote(e) {
  return `
  <div class="border-l-2 border-white/15 pl-3 py-0.5 mt-1.5">
    <div class="text-[11px] text-white/40 font-type">${esc(e.actor || '—')}${e.round != null ? ` · round ${e.round}` : ''}</div>
    <div class="text-sm text-white/70 italic">“${esc(e.quote || e.claim || '')}”</div>
    ${e.problem ? `<div class="text-[12px] text-crimson-bright/80 mt-0.5">⚑ ${esc(e.problem)}</div>` : ''}
  </div>`;
}

function evaluationView(dv) {
  const ev = state.evaluation;
  if (!ev) return `<div class="p-10 text-white/50">No evaluation available for this game.</div>`;

  const det = ev.deterministic || {};
  const j = ev.judgment || {};
  const scores = j.scores || {};
  const dimVals = Object.values(scores).map((s) => s.score).filter((n) => typeof n === 'number');
  const avg = dimVals.length ? (dimVals.reduce((a, b) => a + b, 0) / dimVals.length) : null;

  // headline verdict tiles from deterministic metrics
  const caught = det.culprit_convicted;
  const tiles = [
    statTile('Overall (judge)', avg != null ? `${avg.toFixed(1)}<span class="text-white/40 text-lg">/${SCORE_MAX}</span>` : '—', `${dimVals.length} rubric dims`),
    statTile('Convicted', esc(det.convicted || 'no one'), caught == null ? '' : (caught ? '✓ culprit caught' : '✗ wrong suspect')),
    statTile('Top vote share', pct(det.largest_vote_share)),
    statTile('Citation validity', pct(det.valid_citation_rate)),
    statTile('Tool calls', det.tool_calls ?? '—', det.unique_tool_queries != null ? `${det.unique_tool_queries} unique` : ''),
    statTile('Statements', det.statement_count ?? '—', det.average_statement_words != null ? `~${det.average_statement_words} words avg` : ''),
    statTile('Plants', det.plant_count ?? '—'),
  ].join('');

  // rubric dimension rows
  const dims = Object.entries(scores).map(([key, s]) => `
    <div class="py-4 border-b border-noir-line/60">
      <div class="flex items-center justify-between gap-4">
        <div class="font-display text-lg text-paper">${esc(titleCase(key))}</div>
        <div class="flex items-center gap-2 shrink-0">
          ${scoreMeter(s.score)}
          <span class="font-display text-xl" style="color:${scoreColor(s.score)}">${s.score ?? '—'}<span class="text-white/30 text-sm">/${SCORE_MAX}</span></span>
        </div>
      </div>
      ${s.rationale ? `<p class="text-sm text-white/65 mt-2 leading-relaxed">${esc(s.rationale)}</p>` : ''}
      ${Array.isArray(s.examples) && s.examples.length ? `<div class="mt-1">${s.examples.map(exampleQuote).join('')}</div>` : ''}
    </div>`).join('');

  // per-agent scorecards
  const agentSub = [
    ['independent_contribution', 'Independence'],
    ['grounding_quality', 'Grounding'],
    ['reasoning_value', 'Reasoning'],
    ['role_effectiveness', 'Role'],
  ];
  const agents = (j.agents || []).map((a) => `
    <div class="rounded-md bg-black/25 border border-noir-line p-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full overflow-hidden ring-1 ring-white/15 bg-noir-800 shrink-0">${avatarInner(a.name)}</div>
        <div class="font-display uppercase tracking-wide text-paper">${esc(a.name)}</div>
      </div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
        ${agentSub.map(([k, lbl]) => `
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] text-white/45">${lbl}</span>
            <span class="flex items-center gap-1.5"><span class="font-display text-sm" style="color:${scoreColor(a[k])}">${a[k] ?? '—'}</span></span>
          </div>`).join('')}
      </div>
      ${a.summary ? `<p class="text-[12px] text-white/55 mt-2 leading-snug">${esc(a.summary)}</p>` : ''}
    </div>`).join('');

  // copying analysis
  const cp = j.copying_analysis;
  const copyingBlock = cp ? `
    <div class="rounded-md bg-black/25 border border-noir-line p-4">
      <div class="font-type text-[11px] tracking-wider2 text-white/40 mb-2">CONSENSUS & COPYING</div>
      ${cp.dominant_claim ? `<p class="text-sm text-white/75"><span class="text-white/45">Dominant claim:</span> ${esc(cp.dominant_claim)}</p>` : ''}
      ${cp.originator ? `<p class="text-sm text-white/60 mt-1"><span class="text-white/45">Originated by</span> <span class="text-gold-bright">${esc(cp.originator)}</span>, echoed by ${(cp.echoed_by || []).map((n) => `<span class="text-white/70">${esc(n)}</span>`).join(', ') || '—'}</p>` : ''}
      ${Array.isArray(cp.meaningful_challenges) ? `<p class="text-sm text-white/60 mt-1"><span class="text-white/45">Meaningful challenges:</span> ${cp.meaningful_challenges.map((c) => esc(c)).join('; ')}</p>` : ''}
      ${cp.assessment ? `<p class="text-[13px] text-white/55 italic mt-2">${esc(cp.assessment)}</p>` : ''}
    </div>` : '';

  const best = j.best_independent_contribution;
  const bestBlock = best ? `
    <div class="rounded-md bg-gold/10 border border-gold/30 p-4">
      <div class="font-type text-[11px] tracking-wider2 text-gold mb-1">BEST INDEPENDENT CONTRIBUTION</div>
      <p class="text-sm text-white/80">${esc(best.contribution || '—')}</p>
      ${best.actor && best.actor !== 'None' ? `<div class="text-[11px] text-white/45 mt-1">${esc(best.actor)}${best.round != null ? ` · round ${best.round}` : ''}</div>` : ''}
    </div>` : '';

  const list = (title, items, tone) => {
    if (!items || !items.length) return '';
    const color = tone === 'good' ? 'text-[#6fae6f]' : tone === 'bad' ? 'text-crimson-bright' : 'text-gold';
    return `
    <div>
      <div class="font-type text-[11px] tracking-wider2 ${color} mb-2">${esc(title)}</div>
      <ul class="space-y-1.5">
        ${items.map((it) => `<li class="text-sm text-white/70 flex gap-2"><span class="${color}">›</span><span>${esc(typeof it === 'string' ? it : JSON.stringify(it))}</span></li>`).join('')}
      </ul>
    </div>`;
  };

  // Langfuse run telemetry for this game (from the manifest, if present).
  const trace = (state.manifest?.games || []).find((g) => g.id === state.selectedGame)?.trace;
  const money = (x) => (x == null ? '—' : `$${Number(x).toFixed(x < 0.1 ? 4 : 3)}`);
  const num = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US'));
  const runDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString(); };
  const traceBlock = trace ? `
    <section class="mt-10 pt-6 border-t border-noir-line">
      <div class="font-type text-[11px] tracking-wider2 text-white/40 mb-1">RUN TRACE · LANGFUSE</div>
      <div class="text-[12px] text-white/40 mb-4 font-type">session <span class="text-white/60">${esc(trace.sessionId || state.selectedGame)}</span>${trace.createdAt ? ` · ${esc(runDate(trace.createdAt))}` : ''}</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        ${statTile('Total tokens', num(trace.tokens))}
        ${statTile('Total cost', money(trace.cost?.total), trace.cost ? `in ${money(trace.cost.input)} · out ${money(trace.cost.output)}` : '')}
        ${statTile('Traces', num(trace.countTraces))}
        ${statTile('Session span', trace.sessionDuration != null ? `${trace.sessionDuration}s` : '—')}
      </div>
      ${(trace.tags || []).length ? `<div class="mt-3 flex flex-wrap gap-2">${trace.tags.map((t) => `<span class="doc-chip">${esc(t)}</span>`).join('')}</div>` : ''}
    </section>` : '';

  const misinterp = (j.misinterpreted_evidence || []).length ? `
    <div>
      <div class="font-type text-[11px] tracking-wider2 text-crimson-bright mb-2">MISINTERPRETED EVIDENCE</div>
      ${(j.misinterpreted_evidence || []).map(exampleQuote).join('')}
    </div>` : '';

  return `
  <div class="h-full overflow-y-auto px-6 md:px-10 py-8">
    <div class="max-w-4xl mx-auto">
      <header class="mb-6">
        <div class="font-type text-crimson tracking-wider2 text-sm">— THE JUDGE'S VERDICT —</div>
        <h1 class="font-display text-4xl text-paper mt-1">How well did the interns investigate?</h1>
        <div class="text-[12px] text-white/40 mt-2 font-type">
          LLM-as-judge · model <span class="text-white/60">${esc(ev.judge_model || 'unknown')}</span>
          · rubric v${esc(ev.rubric_version || '?')} · status ${esc(ev.status || '—')}
        </div>
      </header>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">${tiles}</div>

      <section class="mb-8">
        <div class="font-type text-[11px] tracking-wider2 text-white/40 mb-1">RUBRIC · SCORED 1–${SCORE_MAX}</div>
        ${dims || '<div class="text-white/40 text-sm">No rubric scores.</div>'}
      </section>

      ${agents ? `<section class="mb-8">
        <div class="font-type text-[11px] tracking-wider2 text-white/40 mb-3">PER-INTERN ASSESSMENT</div>
        <div class="grid sm:grid-cols-2 gap-3">${agents}</div>
      </section>` : ''}

      <section class="grid md:grid-cols-2 gap-4 mb-8">
        ${copyingBlock}
        ${bestBlock}
      </section>

      <section class="grid sm:grid-cols-3 gap-6 mb-8">
        ${list('STRENGTHS', j.strengths, 'good')}
        ${list('FAILURES', j.failures, 'bad')}
        ${list('RECOMMENDATIONS', j.recommendations, 'neutral')}
      </section>

      <section class="grid md:grid-cols-2 gap-6 mb-6">
        ${list('MISSED EVIDENCE', j.missed_evidence, 'bad')}
        ${misinterp}
      </section>

      ${traceBlock}
    </div>
  </div>`;
}

// ---------- assembly --------------------------------------------------------

export function renderWarRoom(dv) {
  const topRow = dv.suspects.slice(0, Math.ceil(dv.suspects.length / 2));
  const bottomRow = dv.suspects.slice(Math.ceil(dv.suspects.length / 2));

  const boardOrDossier = state.viewMode === 'dossier'
    ? dossierView(dv)
    : state.viewMode === 'evaluation'
    ? evaluationView(dv)
    : `
    <div id="board-space" class="relative flex-1 min-h-0 flex flex-col px-6 py-3">
      <!-- top desks -->
      <div class="flex justify-around items-start gap-3 relative z-10">
        ${topRow.map((s) => desk(s, dv)).join('')}
      </div>

      <!-- the shared incident board -->
      <div class="relative flex-1 min-h-0 my-3 rounded-lg cork overflow-hidden">
        <svg id="board-strings" class="absolute inset-0 w-full h-full pointer-events-none z-10"></svg>

        <!-- pinned evidence -->
        <div class="absolute top-4 left-4 right-4 flex flex-wrap gap-3 justify-center z-20 max-h-[40%] overflow-hidden">
          ${dv.pinned.map((p, i) => evidencePin(p, dv, i)).join('')}
        </div>

        <!-- center stage: current event -->
        <div class="absolute left-1/2 bottom-4 -translate-x-1/2 w-[min(560px,90%)] z-30">
          ${stageCard(dv)}
        </div>

        ${privateCorner(dv)}
        ${revealOverlay(dv)}
      </div>

      <!-- bottom desks -->
      <div class="flex justify-around items-end gap-3 relative z-10">
        ${bottomRow.map((s) => desk(s, dv)).join('')}
      </div>
    </div>`;

  return `
  <div class="h-full flex flex-col relative">
    ${headerBar(dv)}
    ${boardOrDossier}
    ${state.viewMode === 'replay' ? `
      <div class="border-t border-noir-line bg-noir-900/70">
        ${timelineRail(dv)}
        ${navBar(dv)}
      </div>` : ''}
    ${evidenceDrawer(dv)}
    ${coldOpen(dv)}
  </div>`;
}

// ---------- post-render: draw red string between desks ----------------------

export function drawBoardStrings(dv) {
  const svg = document.getElementById('board-strings');
  const space = document.getElementById('board-space');
  if (!svg || !space) return;

  const spaceRect = space.getBoundingClientRect();
  const W = spaceRect.width, H = spaceRect.height;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const anchor = (name) => {
    const el = space.querySelector(`[data-desk="${CSS.escape(name)}"] .desk-photo`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - spaceRect.left, y: r.top + r.height / 2 - spaceRect.top };
  };

  let defs = `<defs>
    <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 z" fill="var(--crimson-bright)"/>
    </marker></defs>`;
  let paths = '';

  const curve = (a, b) => {
    // gentle arc so overlapping strings fan out
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const off = 0.12;
    const cx = mx - dy * off, cy = my + dx * off;
    return { d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, len: Math.hypot(dx, dy) * 1.15 };
  };

  // mention strings (grey, dashed)
  for (const m of dv.mentionPairs) {
    const a = anchor(m.from), b = anchor(m.to);
    if (!a || !b) continue;
    const { d } = curve(a, b);
    paths += `<path class="string mention" d="${d}"></path>`;
  }
  // accusation strings (red, arrowed) — drawn on top
  for (const e of dv.accusationEdges) {
    const a = anchor(e.from), b = anchor(e.to);
    if (!a || !b) continue;
    const { d, len } = curve(a, b);
    const fresh = e.t === state.currentT ? 'fresh' : '';
    paths += `<path class="string ${fresh}" style="--len:${len}" stroke-dasharray="${fresh ? len + ' ' + len : 'none'}"
      marker-end="url(#arrow)" d="${d}"></path>`;
  }
  svg.innerHTML = defs + paths;
}

// picker.js — the entry screen: a filing cabinet of case files.

import { avatarFor } from './data.js';

function avatarChip(name, imageMap, i) {
  const a = avatarFor(name, imageMap);
  const base =
    'w-8 h-8 rounded-full ring-2 ring-noir-900 overflow-hidden shrink-0 -ml-2 first:ml-0';
  if (a.type === 'img') {
    return `<img src="${a.src}" alt="${name}" title="${name}"
      class="${base} object-cover"
      style="z-index:${20 - i}"
      onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${base} avatar-initial text-xs',style:'background:${a.color};z-index:${20 - i}',textContent:'${(name[0]||'?').toUpperCase()}'}))" />`;
  }
  return `<div class="${base} avatar-initial text-xs" title="${name}"
      style="background:${a.color};z-index:${20 - i}">${a.letter}</div>`;
}

function caseCard(game, imageMap) {
  const num = (game.id.match(/(\d+)/)?.[1] || '').replace(/^0+/, '') || game.id;
  const victim = game.victim?.name || 'Unknown victim';
  const teaser = game.victim
    ? `${game.victim.name} — ${game.victim.role || ''}`.trim()
    : 'A death to be investigated.';
  const chips = (game.suspects || [])
    .map((n, i) => avatarChip(n, imageMap, i))
    .join('');

  return `
  <button type="button" data-action="open-game" data-id="${game.id}"
    class="group relative text-left focus:outline-none">
    <!-- folder tab -->
    <div class="absolute -top-3 left-6 px-3 py-1 rounded-t-md bg-cork-dark text-paper
                font-type text-[11px] tracking-wider2 shadow-md z-10">
      CASE&nbsp;№&nbsp;${String(num).padStart(3, '0')}
    </div>
    <div class="paper rounded-md rounded-tl-none p-5 pt-6 min-h-[190px] flex flex-col
                transition-transform duration-200 group-hover:-translate-y-1
                group-focus-visible:-translate-y-1"
         style="transform: rotate(${((game.id.charCodeAt(6) || 0) % 3) - 1}deg)">
      <div class="flex items-start justify-between gap-2">
        <h3 class="font-display text-2xl leading-none text-ink">${game.title}</h3>
        <span class="pin" style="position:relative;top:0;left:0;transform:none"></span>
      </div>
      <div class="mt-1 flex items-center gap-2">
        <span class="font-type text-[12px] text-crimson tracking-wide">HOMICIDE FILE</span>
        ${game.hasEvaluation ? '<span class="font-type text-[10px] text-gold border border-gold/50 rounded px-1.5 py-[1px] leading-none">⚖ JUDGED</span>' : ''}
      </div>

      <p class="mt-3 text-sm text-ink/80 leading-snug flex-1">
        Victim: <span class="font-semibold">${victim}</span><br/>
        <span class="text-ink/60">${teaser}</span>
      </p>

      <div class="mt-4 flex items-center justify-between">
        <div class="flex items-center">${chips}</div>
        <div class="text-right font-type text-[11px] text-ink/60 leading-tight">
          ${game.suspectCount} suspects<br/>${game.rounds} rounds
        </div>
      </div>
    </div>
  </button>`;
}

export function renderPicker(imageMap, games) {
  const cards = games.map((g) => caseCard(g, imageMap)).join('');
  return `
  <div class="h-full w-full overflow-y-auto">
    <div class="max-w-6xl mx-auto px-6 py-12">
      <header class="text-center mb-12">
        <div class="font-type text-crimson tracking-wider2 text-sm mb-2">— CONFIDENTIAL · CASE ARCHIVE —</div>
        <h1 class="font-display font-700 text-6xl md:text-7xl tracking-tight text-paper leading-none">
          MURDER&nbsp;MYSTERY
        </h1>
        <p class="mt-4 text-white/50 max-w-xl mx-auto text-sm">
          Investigation replays from the incident room. Eight interns worked each case;
          pull a file to step through how they got there — statement by statement,
          string by string.
        </p>
      </header>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
        ${cards}
      </div>

      <p class="text-center text-white/25 text-xs mt-16 font-type">
        ${games.length} cases on file
      </p>
    </div>
  </div>`;
}

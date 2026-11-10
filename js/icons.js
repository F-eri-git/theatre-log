// Inline SVG icon strings. Stroke width 1.75, 24x24 viewBox — matches the
// `.tl-icon` convention from the design handoff. No emoji, per the design rules.

const ICON_LIST = '<svg class="tl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
const ICON_PLUS = '<svg class="tl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_EXPORT = '<svg class="tl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>';
const ICON_CHECK = '<svg class="tl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_THEATRE = '<svg class="tl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V10.5L12 4l8 6.5V21"/><path d="M9 21v-6h6v6"/></svg>';
const ICON_BACK = '<svg class="tl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const ICON_TRASH = '<svg class="tl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7"/></svg>';
const ICON_LINK = '<svg class="tl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 14.5l5-5M9 7.5 10.8 5.7a3 3 0 0 1 4.3 4.3L13.3 12M15 16.5l-1.8 1.8a3 3 0 0 1-4.3-4.3L10.7 12"/></svg>';

// The #star symbol referenced by <use href="#star"> in the rating UI is defined
// once, statically, in index.html (it never changes, so it doesn't need to be
// re-injected on every render).

const GENRES = [
  { id: 'play', label: 'ストレートプレイ' },
  { id: 'musical', label: 'ミュージカル' },
  { id: 'ballet', label: 'バレエ' },
  { id: 'opera', label: 'オペラ' },
  { id: 'other', label: 'その他' },
];
const GENRE_LABEL = Object.fromEntries(GENRES.map(g => [g.id, g.label]));

const STATUSES = ['Raised', 'Out of scope', 'Done'];

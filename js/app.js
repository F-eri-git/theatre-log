// Theatre Log — app logic. Vanilla JS, no build step, no framework.
(function () {
  'use strict';

  const WD_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  // ---- date helpers (plain YYYY-MM-DD strings compare correctly as text) ----
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function isFutureDate(iso) { return iso > todayISO(); }
  function dateParts(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d };
  }
  function cardStub(iso) {
    const { y, m, d } = dateParts(iso);
    const wd = WD_EN[new Date(y, m - 1, d).getDay()];
    return { day: String(d).padStart(2, '0'), mon: MON_EN[m - 1], wd };
  }
  function monthLabel(iso) {
    const { y, m } = dateParts(iso);
    return `${y}年${m}月`;
  }
  function dateSlash(iso) { return iso.replace(/-/g, '/'); }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function uuid() { return crypto.randomUUID(); }

  // ---- state ----
  const state = {
    records: [],
    theatres: [],
    ui: {
      tab: 'list',           // 'list' | 'export'
      listFilter: loadFilter(), // 'planned' | 'seen' | 'all' (remembered across launches)
      recordOverlay: null,   // { id, form, errors }
      theatreOverlay: null,  // { mode: 'list'|'form', editId, form, errors }
      confirm: null,         // { kind: 'delete-record'|'delete-theatre', id }
      toast: '',
    },
  };
  let toastTimer = null;

  function loadFilter() {
    try {
      const v = localStorage.getItem('tl-list-filter');
      return ['planned', 'seen', 'all'].includes(v) ? v : 'all';
    } catch (e) { return 'all'; }
  }
  function saveFilter(v) {
    try { localStorage.setItem('tl-list-filter', v); } catch (e) { /* storage unavailable: keep in memory only */ }
  }

  // ---- lookups ----
  function theatreById(id) { return state.theatres.find(t => t.id === id) || null; }
  function findTheatreByName(name) {
    const key = (name || '').trim().toLowerCase();
    if (!key) return null;
    return state.theatres.find(t => t.name.trim().toLowerCase() === key) || null;
  }
  function pastTitles() {
    return Array.from(new Set(state.records.map(r => r.title).filter(Boolean)));
  }
  function venueHintText(venueText) {
    const name = venueText.trim();
    if (!name) return '住所は劇場マスターから自動入力';
    const match = findTheatreByName(name);
    if (!match) return '新しい劇場として登録されます';
    const addr = `住所：${escapeHtml(match.address || '（未登録）')}`;
    const link = match.seatingPlanLink ? ` ・ <a href="${escapeHtml(match.seatingPlanLink)}" target="_blank" rel="noopener">座席表</a>` : '';
    return addr + link;
  }
  function suggestedTimes(title, excludeId) {
    const key = (title || '').trim();
    if (!key) return 1;
    const n = state.records.filter(r => r.title.trim() === key && r.id !== excludeId && !r.timesOverride).length;
    return n + 1;
  }

  // ---- times renumbering (same-title group, ascending by date; manual overrides are left alone) ----
  function recomputeTimesForTitle(title) {
    const key = (title || '').trim();
    if (!key) return;
    const group = state.records
      .filter(r => r.title.trim() === key)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    let n = 0;
    group.forEach(r => {
      if (r.timesOverride) return;
      n += 1;
      if (r.times !== n) { r.times = n; saveRecord(r); }
    });
  }

  function showToast(msg) {
    state.ui.toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { state.ui.toast = ''; render(); }, 2600);
    render();
  }

  // ---- derived view ----
  function computeView() {
    const today = todayISO();
    const decorated = state.records.map(r => {
      const theatre = theatreById(r.theatreId);
      const planned = isFutureDate(r.date);
      const status = r.exportedAt ? 'exported' : (planned ? 'planned' : 'seen');
      return { ...r, theatre, planned, displayStatus: status, stub: cardStub(r.date) };
    });

    const plannedList = decorated.filter(r => r.planned); // date > today
    const seenList = decorated.filter(r => !r.planned); // date <= today, regardless of export flag
    const all = decorated;

    const byFilter = { planned: plannedList, seen: seenList, all }[state.ui.listFilter] || all;
    const sorted = [...byFilter].sort((a, b) =>
      state.ui.listFilter === 'planned' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
    );

    const groupMap = new Map();
    sorted.forEach(r => {
      const label = monthLabel(r.date);
      if (!groupMap.has(label)) groupMap.set(label, []);
      groupMap.get(label).push(r);
    });
    const groups = Array.from(groupMap, ([label, items]) => ({ label, items }));

    const exportTargets = decorated.filter(r => !r.exportedAt && !r.planned)
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      tab: state.ui.tab,
      listFilter: state.ui.listFilter,
      plannedCount: plannedList.length,
      seenCount: seenList.length,
      allCount: all.length,
      groups,
      hasAnyRecords: all.length > 0,
      exportTargets,
      toast: state.ui.toast,
    };
  }

  // ---- render: shared bits ----
  function starRow(rating, size) {
    const cls = size === 'sm' ? 'tl-stars tl-stars--sm' : 'tl-stars';
    const stars = Array.from({ length: 5 }, (_, i) => {
      const on = i < rating;
      return `<span class="tl-star${on ? ' is-on' : ''}"><svg aria-hidden="true"><use href="#star"/></svg></span>`;
    }).join('');
    return `<span class="${cls}" role="img" aria-label="評価 ${rating} / 5">${stars}</span>`;
  }

  function renderTabBar(view) {
    return `
      <nav class="tl-tabbar tl-tabbar--fixed" aria-label="メイン">
        <button class="tl-tab" data-action="tab-list" aria-current="${view.tab === 'list' ? 'page' : 'false'}">${ICON_LIST}一覧</button>
        <button class="tl-tab tl-tab--add" data-action="new-record"><span class="tl-tab__plus">${ICON_PLUS}</span>追加</button>
        <button class="tl-tab" data-action="tab-export" aria-current="${view.tab === 'export' ? 'page' : 'false'}">${ICON_EXPORT}書き出し</button>
      </nav>
    `;
  }

  function cardMeta(r) {
    const parts = [];
    if (r.theatre) parts.push(escapeHtml(r.theatre.name));
    if (r.seat) parts.push(escapeHtml(r.seat));
    if (r.companion) parts.push(escapeHtml(r.companion)); else if (r.theatre || r.seat) parts.push('ひとり');
    return parts.join(' · ');
  }

  function renderCard(r) {
    const badge = r.displayStatus === 'exported'
      ? `<span class="tl-badge tl-badge--exported">${ICON_CHECK}書き出し済</span>`
      : r.displayStatus === 'planned'
        ? `<span class="tl-badge tl-badge--planned">予定</span>`
        : `<span class="tl-badge tl-badge--seen">観劇済</span>`;
    const chip = r.genre ? `<span class="tl-chip">${escapeHtml(GENRE_LABEL[r.genre] || r.genre)}</span>` : '';
    const timeLine = r.time ? `<span class="tl-card__time">${escapeHtml(r.time)}</span>` : '';

    let foot = '';
    if (r.displayStatus !== 'planned') {
      if (r.rating > 0) {
        foot = `<div class="tl-card__foot">${starRow(r.rating, 'sm')}</div>`;
      } else {
        foot = `<div class="tl-card__foot"><span class="tl-btn tl-btn--danger tl-card__cta" data-action="rate-record" data-id="${r.id}">評価する</span></div>`;
      }
    }
    const note = (r.comment && r.displayStatus !== 'planned') ? `<p class="tl-card__note">${escapeHtml(r.comment)}</p>` : '';

    return `
      <button type="button" class="tl-card-btn" data-action="open-record" data-id="${r.id}">
        <article class="tl-card ${r.displayStatus === 'planned' ? 'tl-card--planned' : ''}">
          <div class="tl-card__stub"><span class="tl-card__day">${r.stub.day}</span><span class="tl-card__mon">${r.stub.mon} · ${r.stub.wd}</span>${timeLine}</div>
          <div class="tl-card__body">
            <div class="tl-card__top">${badge}${chip}</div>
            <h3 class="tl-card__title">${escapeHtml(r.title)}</h3>
            <p class="tl-card__meta">${cardMeta(r) || '&nbsp;'}</p>
            ${foot}
            ${note}
          </div>
        </article>
      </button>
    `;
  }

  function renderListScreen(view) {
    const segs = [
      { id: 'planned', label: '予定', count: view.plannedCount },
      { id: 'seen', label: '観劇済', count: view.seenCount },
      { id: 'all', label: 'すべて', count: view.allCount },
    ];
    const seg = segs.map(s => `
      <label style="flex:1"><input type="radio" name="filter" value="${s.id}" ${s.id === view.listFilter ? 'checked' : ''}>
        <span style="justify-content:center">${s.label} <small>${s.count}</small></span></label>
    `).join('');

    const body = view.groups.length
      ? view.groups.map(g => `
          <h2 class="tl-section-title">${g.label}</h2>
          <div class="tl-stack">${g.items.map(renderCard).join('')}</div>
        `).join('')
      : view.hasAnyRecords
        ? `<div class="tl-empty"><p>該当する記録がありません</p></div>`
        : `<div class="tl-empty"><p>まだ記録がありません</p><button class="tl-btn tl-btn--primary" data-action="new-record">最初の観劇を記録する</button></div>`;

    return `
      <main class="tl-screen">
        <div class="tl-screen__body">
          <div class="tl-title-row">
            <h1 class="tl-screen-title">Theatre Log</h1>
            <button type="button" class="tl-icon-btn" data-action="open-theatre-overlay" aria-label="劇場を管理">${ICON_THEATRE}</button>
          </div>
          <fieldset class="tl-seg" style="display:flex">
            <legend class="tl-visually-hidden">表示する記録</legend>
            ${seg}
          </fieldset>
          ${body}
        </div>
      </main>
    `;
  }

  function renderExportScreen(view) {
    const count = view.exportTargets.length;
    const list = view.exportTargets.map(r => `
      <li><span>${escapeHtml(r.title)}${r.rating === 0 ? '（未評価）' : ''}</span><span>${dateParts(r.date).m}/${dateParts(r.date).d}</span></li>
    `).join('');

    return `
      <main class="tl-screen">
        <div class="tl-screen__body">
          <h1 class="tl-screen-title">書き出し</h1>
          <section class="tl-export" aria-labelledby="ex-count">
            <p class="tl-export__count" id="ex-count"><span class="tl-export__num">${count}</span><span class="tl-export__unit">件の観劇が未書き出し</span></p>
            ${count ? `<ul class="tl-export__list">${list}</ul>` : ''}
            <button type="button" class="tl-btn tl-btn--primary tl-btn--block tl-btn--lg" data-action="export-csv" ${count ? '' : 'disabled'}>${ICON_EXPORT}${count ? 'CSV で書き出す' : '書き出す記録はありません'}</button>
            <p class="tl-export__note">予定の公演は含まれません。書き出した記録は「書き出し済」になり、次回の対象から外れます。</p>
          </section>
          <section class="tl-stack" style="gap:var(--space-2)">
            <h2 class="tl-section-title">CSV の列</h2>
            <p class="tl-field__hint" style="margin:0">観劇note の表と同じ順。先頭行は列名です</p>
            <div class="tl-row" style="gap:6px">
              <span class="tl-col-chip">Date of visit</span><span class="tl-col-chip">Name of show</span><span class="tl-col-chip">Times</span><span class="tl-col-chip">Status</span><span class="tl-col-chip">Theatre</span><span class="tl-col-chip">Seat</span><span class="tl-col-chip">Seating plan link</span><span class="tl-col-chip">Address</span><span class="tl-col-chip">Memo</span><span class="tl-col-chip">Rating</span><span class="tl-col-chip">Comment</span>
              <span class="tl-col-chip tl-col-chip--new">Companion</span><span class="tl-col-chip tl-col-chip--new">Genre</span>
            </div>
          </section>
        </div>
      </main>
    `;
  }

  // ---- record overlay (add / edit) ----
  function blankRecordForm() {
    return {
      date: todayISO(), time: '', title: '', venueText: '', seat: '', companion: '',
      genre: '', status: 'Raised', rating: 0, comment: '', memo: '',
      times: 1, timesTouched: false,
    };
  }
  function openRecordOverlay(id) {
    if (id) {
      const r = state.records.find(x => x.id === id);
      if (!r) return;
      const theatre = theatreById(r.theatreId);
      state.ui.recordOverlay = {
        id: r.id,
        form: {
          date: r.date, time: r.time || '', title: r.title, venueText: theatre ? theatre.name : '',
          seat: r.seat || '', companion: r.companion || '', genre: r.genre || '', status: r.status,
          rating: r.rating, comment: r.comment || '', memo: r.memo || '', times: r.times,
          timesTouched: !!r.timesOverride,
        },
        errors: {},
      };
    } else {
      state.ui.recordOverlay = { id: null, form: blankRecordForm(), errors: {} };
    }
    render();
  }

  function renderRecordOverlay(ov) {
    if (!ov) return '';
    const f = ov.form;
    const isEdit = !!ov.id;
    const venueHint = venueHintText(f.venueText);
    const titleOptions = pastTitles().map(t => `<option value="${escapeHtml(t)}"></option>`).join('');
    const venueOptions = state.theatres.map(t => `<option value="${escapeHtml(t.name)}"></option>`).join('');
    const timesValue = f.timesTouched ? f.times : suggestedTimes(f.title, ov.id);

    const genreChips = GENRES.map(g => `
      <label class="tl-chip-option"><input type="radio" name="genre" value="${g.id}" ${f.genre === g.id ? 'checked' : ''}><span>${g.label}</span></label>
    `).join('');
    const statusOptions = STATUSES.map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('');

    return `
      <div class="tl-overlay" data-overlay="record">
        <header class="tl-navbar">
          <button type="button" class="tl-btn tl-btn--ghost" style="justify-self:start; padding:0 var(--space-2)" data-action="close-record-overlay">キャンセル</button>
          <h1 class="tl-navbar__title">${isEdit ? '記録を編集' : '観劇を記録'}</h1>
          <span></span>
        </header>
        <div class="tl-overlay__body">
        <form class="tl-form" data-action="submit-record">
          <div class="tl-field">
            <label class="tl-field__label" for="f-title">演目名 <b>必須</b></label>
            <input class="tl-input tl-input--title ${ov.errors.title ? 'has-error' : ''}" id="f-title" type="text" list="titles" placeholder="例：Grace Pervades" value="${escapeHtml(f.title)}" data-action="update-title">
            <datalist id="titles">${titleOptions}</datalist>
            ${ov.errors.title ? `<span class="tl-field__error">${ov.errors.title}</span>` : ''}
          </div>

          <div class="tl-field">
            <label class="tl-field__label" for="f-date">観劇日 <b>必須</b></label>
            <input class="tl-input ${ov.errors.date ? 'has-error' : ''}" id="f-date" type="date" value="${f.date}" data-action="update-date">
            ${ov.errors.date ? `<span class="tl-field__error">${ov.errors.date}</span>` : ''}
          </div>

          <div class="tl-field">
            <label class="tl-field__label" for="f-venue">劇場 <b>必須</b></label>
            <input class="tl-input ${ov.errors.venue ? 'has-error' : ''}" id="f-venue" type="text" list="venues" placeholder="劇場名" value="${escapeHtml(f.venueText)}" data-action="update-venue">
            <datalist id="venues">${venueOptions}</datalist>
            <span class="tl-field__hint" id="venue-hint">${venueHint}</span>
            ${ov.errors.venue ? `<span class="tl-field__error">${ov.errors.venue}</span>` : ''}
          </div>

          <div class="tl-field-pair">
            <div class="tl-field">
              <label class="tl-field__label" for="f-seat">座席</label>
              <input class="tl-input" id="f-seat" type="text" placeholder="例：Stalls F12" value="${escapeHtml(f.seat)}" data-action="update-seat">
            </div>
            <div class="tl-field">
              <label class="tl-field__label" for="f-companion">同行者</label>
              <input class="tl-input" id="f-companion" type="text" placeholder="ひとり" value="${escapeHtml(f.companion)}" data-action="update-companion">
            </div>
          </div>

          <fieldset class="tl-field" style="border:0; margin:0; padding:0">
            <legend class="tl-field__label" style="padding-bottom:var(--space-2)">ジャンル</legend>
            <div class="tl-chips">${genreChips}</div>
          </fieldset>

          <div class="tl-field-pair">
            <div class="tl-field">
              <label class="tl-field__label" for="f-status">ステータス</label>
              <select class="tl-input" id="f-status" data-action="update-status">${statusOptions}</select>
            </div>
            <div class="tl-field">
              <label class="tl-field__label" for="f-times">回数</label>
              <input class="tl-input" id="f-times" type="number" inputmode="numeric" min="1" value="${timesValue}" style="font-family:var(--font-mono)" data-action="update-times">
            </div>
          </div>
          <span class="tl-field__hint">回数は日付順に自動計算されます。手動で変更した値はそのまま使われます</span>

          <fieldset class="tl-rating-box">
            <legend>評価</legend>
            <div class="tl-rating-box__row">
              ${starButtons(f.rating)}
              <span class="tl-rating-box__value">${f.rating} / 5</span>
            </div>
            <span class="tl-field__hint">同じ星をもう一度押すと未評価に戻る</span>
          </fieldset>

          <div class="tl-field">
            <label class="tl-field__label" for="f-comment">感想</label>
            <textarea class="tl-input" id="f-comment" placeholder="観たあとに一言。記事の素材になります" data-action="update-comment">${escapeHtml(f.comment)}</textarea>
          </div>
          <div class="tl-field">
            <label class="tl-field__label" for="f-memo">メモ</label>
            <textarea class="tl-input" id="f-memo" placeholder="自由メモ" data-action="update-memo">${escapeHtml(f.memo)}</textarea>
          </div>

          <button type="submit" class="tl-btn tl-btn--primary tl-btn--block tl-btn--lg">${isEdit ? '保存する' : '記録する'}</button>
          ${isEdit ? `<button type="button" class="tl-btn tl-btn--danger tl-btn--block" data-action="confirm-delete-record" data-id="${ov.id}">この記録を削除</button>` : ''}
        </form>
        </div>
      </div>
    `;
  }

  function starButtons(rating) {
    return `<div class="tl-stars">${Array.from({ length: 5 }, (_, i) => {
      const n = i + 1, on = n <= rating;
      return `<button type="button" class="tl-star${on ? ' is-on' : ''}" aria-label="${n}つ星" aria-pressed="${on}" data-action="set-rating" data-value="${n}"><svg aria-hidden="true"><use href="#star"/></svg></button>`;
    }).join('')}</div>`;
  }

  // ---- theatre master overlay ----
  function renderTheatreOverlay(ov) {
    if (!ov) return '';
    if (ov.mode === 'form') {
      const f = ov.form;
      const usageCount = ov.editId ? state.records.filter(r => r.theatreId === ov.editId).length : 0;
      return `
        <div class="tl-overlay" data-overlay="theatre">
          <header class="tl-navbar">
            <button type="button" class="tl-btn tl-btn--ghost" style="justify-self:start; padding:0 var(--space-2)" data-action="theatre-form-cancel">${ICON_BACK}</button>
            <h1 class="tl-navbar__title">${ov.editId ? '劇場を編集' : '劇場を追加'}</h1>
            <span></span>
          </header>
          <div class="tl-overlay__body">
          <form class="tl-form" data-action="submit-theatre">
            <div class="tl-field">
              <label class="tl-field__label" for="t-name">劇場名 <b>必須</b></label>
              <input class="tl-input ${ov.errors.name ? 'has-error' : ''}" id="t-name" type="text" value="${escapeHtml(f.name)}" data-action="update-theatre-name">
              ${ov.errors.name ? `<span class="tl-field__error">${ov.errors.name}</span>` : ''}
            </div>
            <div class="tl-field">
              <label class="tl-field__label" for="t-address">住所</label>
              <input class="tl-input" id="t-address" type="text" value="${escapeHtml(f.address)}" data-action="update-theatre-address">
            </div>
            <div class="tl-field">
              <label class="tl-field__label" for="t-link">座席表リンク</label>
              <input class="tl-input" id="t-link" type="url" placeholder="https://" value="${escapeHtml(f.seatingPlanLink)}" data-action="update-theatre-link">
            </div>
            <button type="submit" class="tl-btn tl-btn--primary tl-btn--block tl-btn--lg">保存する</button>
            ${ov.editId
              ? usageCount > 0
                ? `<span class="tl-field__hint">${usageCount}件の記録で使われているため削除できません</span>`
                : `<button type="button" class="tl-btn tl-btn--danger tl-btn--block" data-action="confirm-delete-theatre" data-id="${ov.editId}">この劇場を削除</button>`
              : ''}
          </form>
          </div>
        </div>
      `;
    }

    const rows = state.theatres.length
      ? state.theatres.slice().sort((a, b) => a.name.localeCompare(b.name)).map(t => `
          <div class="tl-theatre-row">
            <button type="button" class="tl-theatre-row__main" data-action="edit-theatre" data-id="${t.id}">
              <span class="tl-theatre-row__name">${escapeHtml(t.name)}</span>
              <span class="tl-theatre-row__meta">${escapeHtml(t.address || '住所未登録')}</span>
            </button>
            ${t.seatingPlanLink ? ICON_LINK : ''}
          </div>
        `).join('')
      : `<div class="tl-empty"><p>劇場がまだ登録されていません</p><button class="tl-btn tl-btn--primary" data-action="new-theatre">劇場を追加</button></div>`;

    return `
      <div class="tl-overlay" data-overlay="theatre">
        <header class="tl-navbar">
          <button type="button" class="tl-btn tl-btn--ghost" style="justify-self:start; padding:0 var(--space-2)" data-action="close-theatre-overlay">${ICON_BACK}</button>
          <h1 class="tl-navbar__title">劇場</h1>
          <button type="button" class="tl-icon-btn" style="justify-self:end" data-action="new-theatre" aria-label="劇場を追加">${ICON_PLUS}</button>
        </header>
        <div class="tl-overlay__body tl-screen__body">${rows}</div>
      </div>
    `;
  }

  // ---- confirm sheet ----
  function renderConfirmSheet(confirm) {
    if (!confirm) return '';
    const msg = confirm.kind === 'delete-record' ? 'この記録を削除します' : 'この劇場を削除します';
    return `
      <div class="tl-sheet-backdrop" data-action="cancel-delete-backdrop">
        <div class="tl-sheet" data-stop-close>
          <p>${msg}</p>
          <div class="tl-sheet-actions">
            <button type="button" class="tl-btn tl-btn--danger tl-btn--block" data-action="do-delete">削除</button>
            <button type="button" class="tl-btn tl-btn--secondary tl-btn--block" data-action="cancel-delete">キャンセル</button>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    const view = computeView();
    const root = document.getElementById('app');
    const screen = view.tab === 'export' ? renderExportScreen(view) : renderListScreen(view);
    root.innerHTML = `
      ${screen}
      ${renderTabBar(view)}
      ${renderRecordOverlay(state.ui.recordOverlay)}
      ${renderTheatreOverlay(state.ui.theatreOverlay)}
      ${renderConfirmSheet(state.ui.confirm)}
      ${view.toast ? `<div class="tl-toast">${escapeHtml(view.toast)}</div>` : ''}
    `;
  }

  // ---- record save / delete ----
  function validateRecordForm(f) {
    const errors = {};
    if (!f.title.trim()) errors.title = '演目名を入力してください';
    if (!f.date) errors.date = '観劇日を入力してください';
    if (!f.venueText.trim()) errors.venue = '劇場を入力してください';
    return errors;
  }

  function resolveTheatreId(venueText) {
    const name = venueText.trim();
    const existing = findTheatreByName(name);
    if (existing) return existing.id;
    const theatre = { id: uuid(), name, address: '', seatingPlanLink: '' };
    state.theatres.push(theatre);
    saveTheatre(theatre);
    return theatre.id;
  }

  function submitRecord() {
    const ov = state.ui.recordOverlay;
    const f = ov.form;
    const errors = validateRecordForm(f);
    if (Object.keys(errors).length) { ov.errors = errors; render(); return; }

    const now = new Date().toISOString();
    const theatreId = resolveTheatreId(f.venueText);
    const oldTitle = ov.id ? (state.records.find(r => r.id === ov.id) || {}).title : null;

    // Untouched times field = still in auto mode, so save the live suggestion rather
    // than whatever stale number sat in form state before the user typed a title.
    const timesOverride = f.timesTouched;
    const finalTimes = timesOverride ? (Number(f.times) || 1) : suggestedTimes(f.title, ov.id);

    let record;
    if (ov.id) {
      record = state.records.find(r => r.id === ov.id);
      Object.assign(record, {
        date: f.date, time: f.time, title: f.title.trim(), theatreId, seat: f.seat.trim(),
        companion: f.companion.trim(), genre: f.genre, status: f.status, rating: f.rating,
        comment: f.comment, memo: f.memo, times: finalTimes, timesOverride,
        updatedAt: now,
      });
    } else {
      record = {
        id: uuid(), date: f.date, time: f.time, title: f.title.trim(), theatreId, seat: f.seat.trim(),
        companion: f.companion.trim(), genre: f.genre, status: f.status, rating: f.rating,
        comment: f.comment, memo: f.memo, times: finalTimes, timesOverride,
        exportedAt: null, createdAt: now, updatedAt: now,
      };
      state.records.push(record);
    }
    saveRecord(record);
    recomputeTimesForTitle(record.title);
    if (oldTitle && oldTitle !== record.title) recomputeTimesForTitle(oldTitle);

    state.ui.recordOverlay = null;
    render();
  }

  function deleteRecordById(id) {
    const record = state.records.find(r => r.id === id);
    if (!record) return;
    state.records = state.records.filter(r => r.id !== id);
    deleteRecordDb(id);
    recomputeTimesForTitle(record.title);
    state.ui.recordOverlay = null;
  }

  // ---- theatre save / delete ----
  function submitTheatre() {
    const ov = state.ui.theatreOverlay;
    const f = ov.form;
    if (!f.name.trim()) { ov.errors = { name: '劇場名を入力してください' }; render(); return; }

    let theatre;
    if (ov.editId) {
      theatre = theatreById(ov.editId);
      Object.assign(theatre, { name: f.name.trim(), address: f.address.trim(), seatingPlanLink: f.seatingPlanLink.trim() });
    } else {
      theatre = { id: uuid(), name: f.name.trim(), address: f.address.trim(), seatingPlanLink: f.seatingPlanLink.trim() };
      state.theatres.push(theatre);
    }
    saveTheatre(theatre);
    state.ui.theatreOverlay = { mode: 'list', editId: null, form: null, errors: {} };
    render();
  }

  function deleteTheatreById(id) {
    if (state.records.some(r => r.theatreId === id)) return; // guarded in UI already
    state.theatres = state.theatres.filter(t => t.id !== id);
    deleteTheatreDb(id);
    state.ui.theatreOverlay = { mode: 'list', editId: null, form: null, errors: {} };
  }

  // ---- CSV export ----
  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function buildCsv(records) {
    const header = ['Date of visit', 'Name of show', 'Times', 'Status', 'Theatre', 'Seat', 'Seating plan link', 'Address', 'Memo', 'Rating', 'Comment', 'Companion', 'Genre'];
    const rows = records.map(r => {
      const t = theatreById(r.theatreId);
      return [
        dateSlash(r.date), r.title, r.times, r.status, t ? t.name : '', r.seat || '',
        t ? t.seatingPlanLink || '' : '', t ? t.address || '' : '', r.memo || '',
        r.rating > 0 ? r.rating : '', r.comment || '', r.companion || '', GENRE_LABEL[r.genre] || '',
      ];
    });
    const lines = [header, ...rows].map(row => row.map(csvEscape).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  async function exportCsv() {
    const view = computeView();
    const targets = view.exportTargets;
    if (!targets.length) return;
    const csv = buildCsv(targets);
    const { y, m, d } = dateParts(todayISO());
    const filename = `kangeki_${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}.csv`;

    const markExported = () => {
      const now = new Date().toISOString();
      targets.forEach(t => {
        const record = state.records.find(r => r.id === t.id);
        if (record) { record.exportedAt = now; saveRecord(record); }
      });
      showToast(`${targets.length}件を書き出しました`);
    };

    try {
      const file = new File([csv], filename, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        markExported();
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user cancelled the share sheet
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    markExported();
  }

  // ---- actions ----
  function handleAction(action, target) {
    switch (action) {
      case 'tab-list': state.ui.tab = 'list'; render(); break;
      case 'tab-export': state.ui.tab = 'export'; render(); break;
      case 'new-record': openRecordOverlay(null); break;
      case 'open-record': openRecordOverlay(target.dataset.id); break;
      case 'rate-record': {
        openRecordOverlay(target.dataset.id);
        const box = document.querySelector('.tl-rating-box');
        if (box) box.scrollIntoView({ block: 'center' });
        break;
      }
      case 'close-record-overlay': state.ui.recordOverlay = null; render(); break;
      case 'confirm-delete-record': state.ui.confirm = { kind: 'delete-record', id: target.dataset.id }; render(); break;

      case 'set-rating': {
        const ov = state.ui.recordOverlay;
        const v = Number(target.dataset.value);
        ov.form.rating = ov.form.rating === v ? 0 : v;
        render();
        break;
      }

      case 'open-theatre-overlay': state.ui.theatreOverlay = { mode: 'list', editId: null, form: null, errors: {} }; render(); break;
      case 'close-theatre-overlay': state.ui.theatreOverlay = null; render(); break;
      case 'new-theatre':
        state.ui.theatreOverlay = { mode: 'form', editId: null, form: { name: '', address: '', seatingPlanLink: '' }, errors: {} };
        render();
        break;
      case 'edit-theatre': {
        const t = theatreById(target.dataset.id);
        if (!t) break;
        state.ui.theatreOverlay = { mode: 'form', editId: t.id, form: { name: t.name, address: t.address || '', seatingPlanLink: t.seatingPlanLink || '' }, errors: {} };
        render();
        break;
      }
      case 'theatre-form-cancel': state.ui.theatreOverlay = { mode: 'list', editId: null, form: null, errors: {} }; render(); break;
      case 'confirm-delete-theatre': state.ui.confirm = { kind: 'delete-theatre', id: target.dataset.id }; render(); break;

      case 'cancel-delete': state.ui.confirm = null; render(); break;
      case 'do-delete': {
        const c = state.ui.confirm;
        if (c.kind === 'delete-record') deleteRecordById(c.id);
        else deleteTheatreById(c.id);
        state.ui.confirm = null;
        render();
        break;
      }

      case 'export-csv': exportCsv(); break;
    }
  }

  function bindEvents() {
    const root = document.getElementById('app');

    root.addEventListener('click', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      const backdrop = e.target.closest('[data-action="cancel-delete-backdrop"]');
      if (backdrop && e.target === backdrop) { handleAction('cancel-delete', backdrop); return; }

      const el = e.target.closest('[data-action]');
      if (!el || el.dataset.action === 'cancel-delete-backdrop') return;
      handleAction(el.dataset.action, el);
    });

    root.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-action]');
      if (!form) return;
      e.preventDefault();
      if (form.dataset.action === 'submit-record') submitRecord();
      else if (form.dataset.action === 'submit-theatre') submitTheatre();
    });

    root.addEventListener('input', (e) => {
      const el = e.target;
      const ov = state.ui.recordOverlay;
      const tov = state.ui.theatreOverlay;
      switch (el.dataset.action) {
        case 'update-title': {
          ov.form.title = el.value; ov.form.timesTouched = false; delete ov.errors.title;
          const timesEl = document.getElementById('f-times');
          if (timesEl) timesEl.value = suggestedTimes(ov.form.title, ov.id);
          break;
        }
        case 'update-date': ov.form.date = el.value; delete ov.errors.date; break;
        case 'update-venue': {
          ov.form.venueText = el.value; delete ov.errors.venue;
          const hintEl = document.getElementById('venue-hint');
          if (hintEl) hintEl.innerHTML = venueHintText(ov.form.venueText);
          break;
        }
        case 'update-seat': ov.form.seat = el.value; break;
        case 'update-companion': ov.form.companion = el.value; break;
        case 'update-times': ov.form.times = el.value; ov.form.timesTouched = true; break;
        case 'update-comment': ov.form.comment = el.value; break;
        case 'update-memo': ov.form.memo = el.value; break;
        case 'update-theatre-name': tov.form.name = el.value; delete tov.errors.name; break;
        case 'update-theatre-address': tov.form.address = el.value; break;
        case 'update-theatre-link': tov.form.seatingPlanLink = el.value; break;
      }
    });

    root.addEventListener('change', (e) => {
      const el = e.target;
      const ov = state.ui.recordOverlay;
      if (el.name === 'filter') { state.ui.listFilter = el.value; saveFilter(el.value); render(); }
      else if (el.name === 'genre') { ov.form.genre = el.value; }
      else if (el.dataset.action === 'update-status') { ov.form.status = el.value; }
    });
  }

  async function init() {
    const loaded = await loadAll();
    state.records = loaded.records;
    state.theatres = loaded.theatres;
    bindEvents();
    render();

    // Register directly: by the time IndexedDB has loaded, window 'load' may already have fired.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(err => console.error('SW registration failed', err));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

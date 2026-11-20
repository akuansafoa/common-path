/* Commonplace — a commonplace book for quotes, journal entries and walks.
   Everything is stored in this browser (IndexedDB). No server, no AI, no keys. */
'use strict';

const TYPES = {
  quote:   { label: 'Quote',   icon: 'i-quote', deco: 's-burst' },
  journal: { label: 'Journal', icon: 'i-pen',   deco: 's-flower' },
  walk:    { label: 'Walk',    icon: 'i-leaf',  deco: 's-blob' },
};

const TEXT_LABELS = {
  quote:   ['The quote', 'Copy the passage exactly as written'],
  journal: ["What's on your mind?", 'Write as much or as little as you like'],
  walk:    ['What did you notice or think about?', 'The heron, the hill, the idea that came to you'],
};

const PHOTO_HINTS = {
  quote:   'The cover of the book, or a page you underlined.',
  journal: 'Anything that goes with today’s entry.',
  walk:    'The trail, the view, something you spotted on the way.',
};

const PHOTO_MAX_SIDE = 1000;   // pixels on the longest side
const PHOTO_QUALITY = 0.82;    // JPEG quality

const state = {
  entries: [],
  view: 'home',
  query: '',
  type: 'all',
  tag: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const SVG_NS = 'http://www.w3.org/2000/svg';

/* ================= Storage (IndexedDB, with in-memory fallback) ================= */

let db = null;
const memory = { entries: new Map(), meta: new Map() };

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open('commonplace', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function run(storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage is full or unavailable'));
  });
}

const store = {
  all: () => db ? run('entries', 'readonly', (s) => s.getAll()) : Promise.resolve([...memory.entries.values()]),
  put: (e) => db ? run('entries', 'readwrite', (s) => s.put(e)) : (memory.entries.set(e.id, e), Promise.resolve()),
  putMany: (list) => db
    ? run('entries', 'readwrite', (s) => { list.forEach((e) => s.put(e)); })
    : (list.forEach((e) => memory.entries.set(e.id, e)), Promise.resolve()),
  remove: (id) => db ? run('entries', 'readwrite', (s) => s.delete(id)) : (memory.entries.delete(id), Promise.resolve()),
  clear: () => db ? run('entries', 'readwrite', (s) => s.clear()) : (memory.entries.clear(), Promise.resolve()),
  getMeta: (k) => db ? run('meta', 'readonly', (s) => s.get(k)) : Promise.resolve(memory.meta.get(k)),
  setMeta: (k, v) => db ? run('meta', 'readwrite', (s) => s.put(v, k)) : (memory.meta.set(k, v), Promise.resolve()),
};

let askedPersist = false;
function requestPersistentStorage() {
  // Asks the browser not to clear our data when the device is low on space.
  if (askedPersist) return;
  askedPersist = true;
  try { navigator.storage?.persist?.(); } catch { /* not supported */ }
}

/* ================= Small helpers ================= */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

function svgUse(id, cls) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}
const icon = (id) => svgUse(id, 'icon');

const pad = (n) => String(n).padStart(2, '0');
function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

function uid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function parseTags(str) {
  const seen = new Set();
  return String(str || '')
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, 40))
    .filter((t) => t && !seen.has(t) && seen.add(t));
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

function burstPath(points = 12, outer = 50, inner = 37) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI * i) / points - Math.PI / 2;
    d += (i ? 'L' : 'M') + (50 + r * Math.cos(a)).toFixed(1) + ' ' + (50 + r * Math.sin(a)).toFixed(1);
  }
  return d + 'Z';
}

/* ================= Search ================= */

function searchTerms() {
  return state.query.toLowerCase().split(/\s+/).map((t) => t.replace(/^#+/, '')).filter(Boolean);
}

function haystack(e) {
  return [e.text, e.title, e.author, e.book, e.page, e.place, e.distance, TYPES[e.type].label, ...e.tags]
    .filter(Boolean).join('\n').toLowerCase();
}

function matches(e, terms) {
  if (state.type !== 'all' && e.type !== state.type) return false;
  if (state.tag && !e.tags.includes(state.tag)) return false;
  if (!terms.length) return true;
  const hay = haystack(e);
  return terms.every((t) => hay.includes(t));
}

function sortEntries(list) {
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
}

/** Returns text with search matches wrapped in <mark>. */
function highlight(str) {
  const frag = document.createDocumentFragment();
  if (!str) return frag;
  const terms = searchTerms();
  if (!terms.length) { frag.append(str); return frag; }
  const re = new RegExp('(' + terms.map(escapeRe).join('|') + ')', 'gi');
  str.split(re).forEach((part, i) => {
    if (!part) return;
    frag.append(i % 2 ? h('mark', {}, part) : part);
  });
  return frag;
}

/* ================= Rendering: Home ================= */

function longText(str, tag, cls) {
  const el = h(tag, { class: cls }, highlight(str));
  if (str.length < 280 && str.split('\n').length < 6) return [el];
  el.classList.add('clamp');
  const btn = h('button', { type: 'button', class: 'more', 'aria-expanded': 'false' }, 'Read more');
  btn.addEventListener('click', () => {
    const open = el.classList.toggle('clamp') === false;
    btn.textContent = open ? 'Show less' : 'Read more';
    btn.setAttribute('aria-expanded', String(open));
  });
  return [el, btn];
}

function photoCaption(e) {
  const what = e.type === 'quote' ? (e.book || e.author) : e.type === 'walk' ? e.place : e.title;
  return [TYPES[e.type].label, what, fmtDate(e.date)].filter(Boolean).join(' · ');
}

function renderCard(e) {
  const t = TYPES[e.type];
  const terms = searchTerms();

  const head = h('div', { class: 'card__head' },
    svgUse(t.deco, 'deco deco--big'),
    svgUse('s-sparkle', 'deco deco--small'),
    h('div', { class: 'card__top' },
      h('span', { class: 'badge' }, icon(t.icon), t.label),
      h('time', { class: 'card__date', datetime: e.date }, fmtDate(e.date)),
    ),
  );
  if (e.type === 'quote') head.append(...longText(e.text, 'blockquote', 'card__quote'));
  if (e.type === 'journal') head.append(h('h3', { class: 'card__title' }, highlight(e.title || 'Untitled entry')));
  if (e.type === 'walk') head.append(h('h3', { class: 'card__title' }, highlight(e.place || 'A walk')));

  const body = h('div', { class: 'card__body' });

  if (e.photo) {
    body.append(h('button', {
      type: 'button', class: 'card__photo', 'aria-label': 'View photo full screen',
      onclick: () => openViewer(e),
    }, h('img', { src: e.photo, alt: 'Photo: ' + photoCaption(e), loading: 'lazy' })));
  }

  if (e.type === 'quote' && (e.author || e.book || e.page)) {
    const cite = h('p', { class: 'card__cite' }, '— ');
    if (e.author) cite.append(highlight(e.author));
    if (e.book) cite.append(e.author ? ', ' : '', h('cite', {}, highlight(e.book)));
    if (e.page) cite.append(`, p. ${e.page}`);
    body.append(cite);
  }
  if (e.type === 'walk' && e.distance) body.append(h('p', { class: 'card__meta' }, highlight(e.distance)));
  if (e.type !== 'quote') body.append(...longText(e.text, 'p', 'card__text'));

  if (e.tags.length) {
    body.append(h('ul', { class: 'tags', 'aria-label': 'Themes' },
      e.tags.map((tag) => h('li', {},
        h('button', {
          type: 'button',
          class: 'tag' + (terms.some((w) => tag.includes(w)) || tag === state.tag ? ' is-hit' : ''),
          'aria-label': `Show everything tagged ${tag}`,
          onclick: () => filterByTag(tag),
        }, '#' + tag)))));
  }

  body.append(h('div', { class: 'card__actions' },
    h('button', { type: 'button', class: 'link-btn', onclick: () => openForm(e) }, 'Edit'),
    h('button', { type: 'button', class: 'link-btn link-btn--danger', onclick: () => deleteEntry(e) }, 'Delete'),
  ));

  return h('article', { class: `card card--${e.type}` }, head, body);
}

function emptyState(title, text) {
  return h('div', { class: 'empty' }, svgUse('s-flower', ''), h('h2', {}, title), h('p', {}, text));
}

function renderHome() {
  const all = state.entries;
  const counts = { all: all.length, quote: 0, journal: 0, walk: 0 };
  all.forEach((e) => counts[e.type]++);
  $$('#type-filters .pill').forEach((btn) => {
    const active = btn.dataset.type === state.type;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.querySelector('span').textContent = counts[btn.dataset.type];
  });

  $('#sample-notice').hidden = !all.some((e) => e.sample);

  const tagBox = $('#active-tag');
  tagBox.replaceChildren();
  tagBox.hidden = !state.tag;
  if (state.tag) {
    tagBox.append('Theme:', h('button', {
      type: 'button', 'aria-label': `Stop filtering by ${state.tag}`,
      onclick: () => { state.tag = null; renderHome(); },
    }, '#' + state.tag, icon('i-close')));
  }

  const terms = searchTerms();
  const results = sortEntries(all.filter((e) => matches(e, terms)));
  const filtering = terms.length || state.tag || state.type !== 'all';
  $('#result-count').textContent = filtering && all.length ? plural(results.length, 'entry', 'entries') + ' found' : '';

  const list = $('#list');
  list.replaceChildren();
  if (!all.length) {
    list.append(emptyState('Your book is empty', 'Tap the pink + button to save your first quote, journal entry or walk.'));
  } else if (!results.length) {
    list.append(emptyState('Nothing found', state.query ? `No entries match “${state.query}”.` : 'No entries match these filters.'));
  } else {
    list.append(...results.map(renderCard));
  }
}

/* ================= Rendering: Themes, Photos, Backup ================= */

function tagCounts() {
  const counts = new Map();
  state.entries.forEach((e) => e.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderThemes() {
  const box = $('#bubbles');
  box.replaceChildren();
  const tags = tagCounts();
  if (!tags.length) {
    box.append(emptyState('No themes yet', 'Add themes like “patience” or “courage” when you save an entry.'));
    return;
  }
  const max = tags[0][1];
  tags.forEach(([tag, n], i) => {
    const size = 1 + (max > 1 ? (n - 1) / (max - 1) : 0) * 0.7; // 1rem to 1.7rem
    box.append(h('button', {
      type: 'button', class: `bubble bubble--${i % 6}`, style: `font-size:${size.toFixed(2)}rem`,
      'aria-label': `${tag}, ${plural(n, 'entry', 'entries')}`,
      onclick: () => filterByTag(tag),
    }, tag, h('small', {}, plural(n, 'entry', 'entries'))));
  });
}

function renderPhotos() {
  const box = $('#gallery');
  box.replaceChildren();
  const withPhotos = sortEntries(state.entries.filter((e) => e.photo));
  box.style.display = withPhotos.length ? '' : 'block';
  if (!withPhotos.length) {
    box.append(emptyState('No photos yet', 'Add a photo of a book cover or a trail when you save an entry.'));
    return;
  }
  withPhotos.forEach((e) => {
    box.append(h('button', {
      type: 'button', class: `tile tile--${e.type}`, onclick: () => openViewer(e),
      'aria-label': 'View photo: ' + photoCaption(e),
    }, h('img', { src: e.photo, alt: '', loading: 'lazy' }),
       h('span', {}, (e.type === 'quote' ? e.book || e.author : e.type === 'walk' ? e.place : e.title) || TYPES[e.type].label)));
  });
}

async function renderBackup() {
  const counts = { quote: 0, journal: 0, walk: 0 };
  state.entries.forEach((e) => counts[e.type]++);
  $('#stats').replaceChildren(
    h('div', { class: 'stat stat--quote' }, h('b', {}, counts.quote), h('span', {}, counts.quote === 1 ? 'quote' : 'quotes')),
    h('div', { class: 'stat stat--journal' }, h('b', {}, counts.journal), h('span', {}, counts.journal === 1 ? 'journal entry' : 'journal entries')),
    h('div', { class: 'stat stat--walk' }, h('b', {}, counts.walk), h('span', {}, counts.walk === 1 ? 'walk' : 'walks')),
  );
  $('#remove-samples').hidden = !state.entries.some((e) => e.sample);

  const usage = $('#usage');
  usage.textContent = !db ? 'Your browser is not letting this page save data, so entries will disappear when you close it.' : '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (db && est?.usage != null) {
      const photos = state.entries.filter((e) => e.photo).length;
      usage.textContent = `Using about ${(est.usage / 1024 / 1024).toFixed(1)} MB on this device, including ${plural(photos, 'photo')}.`;
    }
  } catch { /* estimate not supported */ }
}

function render() {
  if (state.view === 'home') renderHome();
  if (state.view === 'themes') renderThemes();
  if (state.view === 'photos') renderPhotos();
  if (state.view === 'backup') renderBackup();
}

function go(view) {
  state.view = view;
  $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + view; });
  $$('.nav__item').forEach((b) => {
    const active = b.dataset.go === view;
    b.classList.toggle('is-active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  render();
  window.scrollTo(0, 0);
}

function filterByTag(tag) {
  state.tag = tag;
  state.query = '';
  state.type = 'all';
  $('#search').value = '';
  go('home');
}

/* ================= Photo viewer ================= */

function openViewer(e) {
  $('#viewer-img').src = e.photo;
  $('#viewer-img').alt = 'Photo: ' + photoCaption(e);
  $('#viewer-caption').textContent = photoCaption(e);
  $('#viewer').showModal();
}

/* ================= Add / edit form ================= */

const dialog = $('#entry-dialog');
const form = $('#entry-form');
let editingId = null;
let formPhoto = null;   // data URL of the photo shown in the form, or null
let formDirty = false;

function currentType() {
  return form.elements.type.value || 'quote';
}

function updateTypeFields() {
  const type = currentType();
  form.querySelectorAll('[data-types]').forEach((el) => {
    el.hidden = !el.dataset.types.split(' ').includes(type);
  });
  $$('.type-choice').forEach((l) => l.classList.toggle('is-checked', l.querySelector('input').checked));
  const [label, placeholder] = TEXT_LABELS[type];
  $('#f-text-label').textContent = label;
  $('#f-text').placeholder = placeholder;
  $('#photo-hint').textContent = PHOTO_HINTS[type];
}

function renderTagSuggestions() {
  const chosen = new Set(parseTags($('#f-tags').value));
  const box = $('#tag-suggest');
  box.replaceChildren();
  const options = tagCounts().map(([t]) => t).filter((t) => !chosen.has(t)).slice(0, 14);
  $('#f-tags-hint').textContent = options.length
    ? 'Separate themes with commas. Tap one you’ve used before:'
    : 'Separate themes with commas.';
  options.forEach((t) => box.append(h('button', {
    type: 'button',
    onclick: () => {
      const input = $('#f-tags');
      const current = parseTags(input.value);
      input.value = [...current, t].join(', ') + ', ';
      formDirty = true;
      renderTagSuggestions();
    },
  }, '+ ' + t)));
}

function showFormPhoto() {
  const img = $('#photo-preview');
  img.hidden = !formPhoto;
  if (formPhoto) img.src = formPhoto; else img.removeAttribute('src');
  $('#photo-remove').hidden = !formPhoto;
  $('#choose-label').textContent = formPhoto ? 'Replace photo' : 'Choose photo';
}

function setTextError(on) {
  $('#f-text-error').hidden = !on;
  $('#f-text').setAttribute('aria-invalid', String(on));
}

function openForm(entry = null) {
  editingId = entry?.id || null;
  form.reset();
  form.elements.type.value = entry?.type || (state.type !== 'all' ? state.type : 'quote');
  for (const name of ['title', 'place', 'distance', 'text', 'author', 'book', 'page']) {
    form.elements[name].value = entry?.[name] || '';
  }
  form.elements.date.value = entry?.date || todayISO();
  form.elements.tags.value = entry ? entry.tags.join(', ') : (state.tag ? state.tag + ', ' : '');
  formPhoto = entry?.photo || null;
  formDirty = false;
  $('#photo-status').textContent = '';
  $('#entry-title').textContent = entry ? 'Edit entry' : 'New entry';
  setTextError(false);
  showFormPhoto();
  updateTypeFields();
  renderTagSuggestions();
  dialog.showModal();
  dialog.querySelector('.sheet__body').scrollTop = 0;
}

function closeForm(force = false) {
  if (!force && formDirty && !confirm('Discard this entry? Your changes won’t be saved.')) return;
  dialog.close();
}

/** Shrinks a photo and re-draws it, which also strips hidden location (EXIF) data. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = src;
  });
}

async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);
    return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function onPhotoPicked(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  const status = $('#photo-status');
  status.textContent = 'Preparing photo…';
  try {
    formPhoto = await shrinkPhoto(file);
    formDirty = true;
    showFormPhoto();
    const kb = Math.round((formPhoto.length * 3) / 4 / 1024);
    status.textContent = `Photo added (about ${kb} KB).`;
  } catch {
    status.textContent = 'Sorry, that photo couldn’t be opened. Try a JPEG or PNG image.';
  }
}

async function saveForm(ev) {
  ev.preventDefault();
  const f = form.elements;
  const type = currentType();
  const text = f.text.value.trim();
  if (!text) {
    setTextError(true);
    f.text.focus();
    return;
  }
  const existing = editingId ? state.entries.find((e) => e.id === editingId) : null;
  const now = Date.now();
  const entry = {
    id: editingId || uid(),
    type,
    date: f.date.value || todayISO(),
    text,
    title: type === 'journal' ? f.title.value.trim() : '',
    author: type === 'quote' ? f.author.value.trim() : '',
    book: type === 'quote' ? f.book.value.trim() : '',
    page: type === 'quote' ? f.page.value.trim() : '',
    place: type === 'walk' ? f.place.value.trim() : '',
    distance: type === 'walk' ? f.distance.value.trim() : '',
    tags: parseTags(f.tags.value),
    photo: formPhoto,
    sample: false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  try {
    await store.put(entry);
  } catch (err) {
    console.error(err);
    toast('Couldn’t save. Your device storage may be full.');
    return;
  }
  state.entries = state.entries.filter((e) => e.id !== entry.id).concat(entry);
  requestPersistentStorage();
  closeForm(true);
  toast(existing ? 'Changes saved' : 'Saved to your book');
  render();
}

async function deleteEntry(e) {
  const name = e.type === 'journal' ? 'journal entry' : e.type;
  if (!confirm(`Delete this ${name}? This can’t be undone.`)) return;
  await store.remove(e.id);
  state.entries = state.entries.filter((x) => x.id !== e.id);
  toast('Deleted');
  render();
}

/* ================= Backup and restore ================= */

function exportBackup() {
  if (!state.entries.length) { toast('Nothing to back up yet'); return; }
  const data = { app: 'commonplace', version: 1, exportedAt: new Date().toISOString(), entries: state.entries };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `commonplace-backup-${todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup downloaded');
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || !TYPES[raw.type]) return null;
  const s = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const text = s(raw.text, 50000);
  if (!text) return null;
  const photoOk = typeof raw.photo === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(raw.photo);
  return {
    id: s(raw.id, 100) || uid(),
    type: raw.type,
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : todayISO(),
    text,
    title: s(raw.title), author: s(raw.author), book: s(raw.book), page: s(raw.page, 20),
    place: s(raw.place), distance: s(raw.distance, 100),
    tags: Array.isArray(raw.tags) ? parseTags(raw.tags.filter((t) => typeof t === 'string').join(',')) : [],
    photo: photoOk ? raw.photo : null,
    sample: raw.sample === true,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

async function importBackup(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('That file isn’t a Commonplace backup.');
    return;
  }
  const list = (Array.isArray(data) ? data : data?.entries || []).map(sanitizeEntry).filter(Boolean);
  if (!list.length) { toast('No entries found in that file.'); return; }
  const ids = new Set(state.entries.map((e) => e.id));
  const replacing = list.filter((e) => ids.has(e.id)).length;
  const msg = `Restore ${plural(list.length, 'entry', 'entries')} from this backup?` +
    (replacing ? `\n\n${plural(replacing, 'entry', 'entries')} already on this device will be replaced by the backup’s version.` : '');
  if (!confirm(msg)) return;
  try {
    await store.putMany(list);
  } catch {
    toast('Couldn’t restore. Your device storage may be full.');
    return;
  }
  state.entries = await store.all();
  requestPersistentStorage();
  toast(`Restored ${plural(list.length, 'entry', 'entries')}`);
  render();
}

async function removeSamples() {
  const samples = state.entries.filter((e) => e.sample);
  if (!samples.length) return;
  for (const e of samples) await store.remove(e.id);
  state.entries = state.entries.filter((e) => !e.sample);
  toast('Sample entries removed');
  render();
}

async function eraseAll() {
  if (!state.entries.length) { toast('Your book is already empty'); return; }
  const ok = confirm(`Erase all ${plural(state.entries.length, 'entry', 'entries')} and photos from this device?\n\nThis can’t be undone. Download a backup first if you might want them later.`);
  if (!ok) return;
  await store.clear();
  state.entries = [];
  state.tag = null;
  toast('Everything erased');
  render();
}

/* ================= Start up ================= */

function setGreeting() {
  const hr = new Date().getHours();
  $('#greeting').textContent = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  $('#today').textContent = fmtDate(todayISO(), { weekday: 'short', day: 'numeric', month: 'short' });
}

function bindEvents() {
  let searchTimer;
  $('#search').addEventListener('input', (ev) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = ev.target.value.trim(); renderHome(); }, 120);
  });

  $('#type-filters').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.pill');
    if (!btn) return;
    state.type = btn.dataset.type;
    renderHome();
  });

  $$('.nav__item').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('#add').addEventListener('click', () => openForm());

  form.addEventListener('submit', saveForm);
  form.addEventListener('input', (ev) => {
    formDirty = true;
    if (ev.target.name === 'text' && ev.target.value.trim()) setTextError(false);
    if (ev.target.name === 'tags') renderTagSuggestions();
  });
  form.addEventListener('change', (ev) => { if (ev.target.name === 'type') updateTypeFields(); });
  $('#entry-close').addEventListener('click', () => closeForm());
  dialog.addEventListener('cancel', (ev) => {   // Escape key
    ev.preventDefault();
    closeForm();
  });

  $('#photo-camera').addEventListener('change', onPhotoPicked);
  $('#photo-library').addEventListener('change', onPhotoPicked);
  $('#photo-remove').addEventListener('click', () => {
    formPhoto = null;
    formDirty = true;
    $('#photo-status').textContent = 'Photo removed.';
    showFormPhoto();
  });
  // "Take photo" only makes sense on phones and tablets; laptops just get "Choose photo".
  if (!window.matchMedia('(pointer: coarse)').matches) $('#camera-btn').hidden = true;

  const viewer = $('#viewer');
  $('#viewer-close').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', (ev) => { if (ev.target === viewer) viewer.close(); });

  $('#export').addEventListener('click', exportBackup);
  $('#import').addEventListener('change', importBackup);
  $('#remove-samples').addEventListener('click', removeSamples);
  $('#remove-samples-inline').addEventListener('click', removeSamples);
  $('#erase').addEventListener('click', eraseAll);
}

async function init() {
  document.getElementById('burst-path').setAttribute('d', burstPath());
  setGreeting();
  bindEvents();

  try {
    db = await openDB();
  } catch (err) {
    console.warn('Falling back to memory storage:', err);
    db = null;
    toast('This browser is blocking storage. Entries won’t be kept after you close the page.');
  }

  try {
    state.entries = await store.all();
  } catch (err) {
    console.error(err);
    toast('Couldn’t load your entries.');
  }
  render();
}

init();

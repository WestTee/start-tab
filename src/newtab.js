// Renders the "Start" bookmarks folder as sections of tiles, and edits it in place.
// Links directly inside Start form a pinned row; each subfolder is a section.
// Every edit goes straight to chrome.bookmarks; the page re-renders from bookmark events.

const FOLDER_NAME = 'Start';
const app = document.getElementById('app');
const menu = document.getElementById('menu');
const dialog = document.getElementById('dialog');
const toast = document.getElementById('toast');
const filter = document.getElementById('filter');
let startId = null;
let dragging = null; // { kind: 'tile' | 'section', id }
let firstRender = true;

// ---------- settings (chrome.storage.sync, so they follow the browser profile) ----------

const DEFAULTS = { name: '', density: 'comfortable', colors: {}, collapsed: [] };
const PALETTE = ['#7fb3e0', '#a7c080', '#e0b45c', '#e08a7f', '#c39be0', '#6fcfc0', '#e09ac0', '#b8b8a8'];
let settings = { ...DEFAULTS };

async function loadSettings() {
  settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  document.body.classList.toggle('compact', settings.density === 'compact');
}

function saveSettings(patch) {
  Object.assign(settings, patch);
  return chrome.storage.sync.set(patch);
}

// ---------- data ----------

async function findStartFolder() {
  const hits = await chrome.bookmarks.search({ title: FOLDER_NAME });
  const folder = hits.find((n) => !n.url);
  return folder ? (await chrome.bookmarks.getSubTree(folder.id))[0] : null;
}

// Nested folders are flattened into their own section, titled "Parent / Child".
function collectSections(folder, prefix, out) {
  const links = folder.children.filter((n) => n.url);
  const pinned = folder.id === startId;
  if (!pinned || links.length) out.push({ id: folder.id, title: prefix, pinned, links });
  for (const sub of folder.children.filter((n) => !n.url)) {
    collectSections(sub, prefix ? `${prefix} / ${sub.title}` : sub.title, out);
  }
  return out;
}

function normaliseUrl(input) {
  const value = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  return new URL(withScheme).toString();
}

// ---------- rendering ----------

function faviconUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '64');
  return url.toString();
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function tile(bookmark) {
  const icon = el('span', { className: 'icon' }, [el('img', { src: faviconUrl(bookmark.url), alt: '' })]);
  const a = el('a', { className: 'tile', href: bookmark.url, title: bookmark.url }, [
    icon,
    el('span', { className: 'label', textContent: bookmark.title || new URL(bookmark.url).hostname }),
  ]);
  a.dataset.id = bookmark.id;
  a.dataset.index = bookmark.index;
  a.dataset.parentId = bookmark.parentId;
  return a;
}

function addButton(parentId) {
  const button = el('button', { type: 'button', className: 'section-add', textContent: '+', title: 'Add link' });
  button.setAttribute('aria-label', 'Add link');
  button.addEventListener('click', () => editLink({ parentId }));
  return button;
}

function section({ id, title, pinned, links }, i) {
  const heading = el('h2', { draggable: true, title: 'Click to collapse, drag to reorder, right-click for options' }, [
    el('span', { className: 'chev', textContent: '▾' }),
    el('span', { className: 'title', textContent: title }),
  ]);
  const node = el('section', { className: pinned ? 'section pinned' : 'section' }, [
    ...(pinned ? [] : [heading]),
    el('div', { className: 'tiles' }, links.map(tile)),
    addButton(id),
  ]);
  node.dataset.id = id;
  node.style.setProperty('--i', i);
  const color = settings.colors[id];
  if (color) {
    node.classList.add('colored');
    node.style.setProperty('--section-color', color);
  }
  if (!pinned && settings.collapsed.includes(id)) node.classList.add('collapsed');
  return node;
}

function addCard() {
  const link = el('button', { type: 'button', textContent: '+ Pinned link' });
  const folder = el('button', { type: 'button', textContent: '+ Section' });
  link.addEventListener('click', () => editLink({ parentId: startId }));
  folder.addEventListener('click', () => editSection({ parentId: startId }));
  return el('div', { className: 'add-card' }, [folder, link]);
}

function emptyState() {
  const button = el('button', { type: 'button', textContent: `Create "${FOLDER_NAME}" folder` });
  button.addEventListener('click', () => chrome.bookmarks.create({ title: FOLDER_NAME }));
  return el('div', { className: 'empty' }, [
    el('p', { textContent: `Add a bookmarks folder named "${FOLDER_NAME}". Each subfolder becomes a section here.` }),
    button,
  ]);
}

async function render() {
  const start = await findStartFolder();
  startId = start?.id ?? null;
  if (!start) {
    app.replaceChildren(emptyState());
    return;
  }
  app.replaceChildren(...collectSections(start, '', []).map(section), addCard());
  applyFilter();
  if (firstRender) {
    firstRender = false;
    app.classList.add('intro');
    setTimeout(() => app.classList.remove('intro'), 1000);
  }
}

let pending;
function scheduleRender() {
  clearTimeout(pending);
  pending = setTimeout(render, 50);
}

// Favicons that fail to load fall back to the first letter of the label.
app.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  const label = img.closest('.tile').querySelector('.label').textContent;
  img.replaceWith(label.charAt(0).toUpperCase());
}, true);

// Each icon gets a soft background tinted from its favicon's main colour.
const tints = new Map();

function tintFor(img) {
  if (tints.has(img.src)) return tints.get(img.src);
  const size = 16;
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let p = 0; p < data.length; p += 4) {
    const [pr, pg, pb, pa] = data.slice(p, p + 4);
    if (pa < 128 || Math.max(pr, pg, pb) - Math.min(pr, pg, pb) < 40) continue; // skip transparent and grey pixels
    r += pr; g += pg; b += pb; n++;
  }
  const tint = n ? `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)} / 0.2)` : null;
  tints.set(img.src, tint);
  return tint;
}

app.addEventListener('load', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  const tint = tintFor(img);
  if (tint) img.parentElement.style.background = tint;
}, true);

// ---------- header: clock, greeting, filter ----------

function updateHeader() {
  const now = new Date();
  const hour = now.getHours();
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('clock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  document.getElementById('greeting').textContent =
    `Good ${part}${settings.name ? `, ${settings.name}` : ''} · ${date}`;
}

function tickClock() {
  updateHeader();
  setTimeout(tickClock, 60000 - (Date.now() % 60000));
}

function applyFilter() {
  const query = filter.value.trim().toLowerCase();
  document.body.classList.toggle('filtering', !!query);
  for (const sectionEl of app.querySelectorAll('section')) {
    let any = false;
    for (const tileEl of sectionEl.querySelectorAll('a.tile')) {
      const hit = !query || tileEl.textContent.toLowerCase().includes(query) || tileEl.href.toLowerCase().includes(query);
      tileEl.hidden = !hit;
      any ||= hit;
    }
    sectionEl.hidden = !!query && !any;
  }
}

filter.addEventListener('input', applyFilter);

filter.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = app.querySelector('a.tile:not([hidden])');
    if (!first) return;
    if (e.metaKey || e.ctrlKey) chrome.tabs.create({ url: first.href, active: false });
    else location.href = first.href;
  } else if (e.key === 'Escape') {
    filter.value = '';
    applyFilter();
    filter.blur();
  }
});

// Typing anywhere on the page starts filtering.
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
  if (dialog.open || !menu.hidden || e.target.closest?.('input, textarea')) return;
  filter.focus();
});

// ---------- dialogs ----------

// Shows the shared <dialog> with the given fields; resolves to the values, or null on cancel.
function ask(title, fields, submitLabel = 'Save') {
  const form = el('form', { method: 'dialog' }, [
    el('h3', { textContent: title }),
    ...fields.map((f) => el('label', {}, [
      el('span', { textContent: f.label }),
      el('input', { name: f.name, value: f.value ?? '', placeholder: f.placeholder ?? '', required: !!f.required }),
    ])),
    el('div', { className: 'actions' }, [
      el('button', { type: 'button', value: 'cancel', textContent: 'Cancel', className: 'secondary' }),
      el('button', { type: 'submit', value: 'ok', textContent: submitLabel }),
    ]),
  ]);
  return showDialog(form).then((value) => (value === 'ok' ? Object.fromEntries(new FormData(form)) : null));
}

// Opens the shared <dialog> with a method="dialog" form; resolves to the submit button's value ('' on cancel).
function showDialog(form) {
  dialog.replaceChildren(form);
  return new Promise((resolve) => {
    form.querySelector('[value=cancel]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue);
      dialog.returnValue = '';
    }, { once: true });
    dialog.showModal();
    form.querySelector('input')?.select();
  });
}

async function pickColor(folder) {
  const swatches = PALETTE.map((color) => {
    const button = el('button', { type: 'submit', value: color, className: 'swatch', title: color });
    button.style.background = color;
    return button;
  });
  const form = el('form', { method: 'dialog' }, [
    el('h3', { textContent: `Colour for "${folder.title}"` }),
    el('div', { className: 'swatches' }, [
      ...swatches,
      el('button', { type: 'submit', value: 'none', className: 'swatch none', textContent: '×', title: 'No colour' }),
    ]),
    el('div', { className: 'actions' }, [
      el('button', { type: 'button', value: 'cancel', textContent: 'Cancel', className: 'secondary' }),
    ]),
  ]);
  const value = await showDialog(form);
  if (!value || value === 'cancel') return;
  const colors = { ...settings.colors };
  if (value === 'none') delete colors[folder.id];
  else colors[folder.id] = value;
  await saveSettings({ colors });
}

async function askName() {
  const values = await ask('Your name', [{ name: 'name', label: 'Shown in the greeting', value: settings.name }]);
  if (values) await saveSettings({ name: values.name.trim() });
}

async function editLink({ parentId, bookmark }) {
  const values = await ask(bookmark ? 'Edit link' : 'Add link', [
    { name: 'title', label: 'Name', value: bookmark?.title },
    { name: 'url', label: 'URL', value: bookmark?.url, placeholder: 'https://', required: true },
  ]);
  if (!values) return;
  let url;
  try {
    url = normaliseUrl(values.url);
  } catch {
    showToast('That URL is not valid.');
    return;
  }
  const title = values.title.trim() || new URL(url).hostname;
  if (bookmark) await chrome.bookmarks.update(bookmark.id, { title, url });
  else await chrome.bookmarks.create({ parentId, title, url });
}

async function editSection({ parentId, folder }) {
  const values = await ask(folder ? 'Rename section' : 'New section', [
    { name: 'title', label: 'Name', value: folder?.title, required: true },
  ]);
  const title = values?.title.trim();
  if (!title) return;
  if (folder) await chrome.bookmarks.update(folder.id, { title });
  else await chrome.bookmarks.create({ parentId, title });
}

async function removeSection(folder) {
  const [tree] = await chrome.bookmarks.getSubTree(folder.id);
  const count = countLinks(tree);
  const confirmed = await ask(
    `Remove "${folder.title}"${count ? ` and its ${count} link${count === 1 ? '' : 's'}` : ''}?`, [], 'Remove');
  if (confirmed) await chrome.bookmarks.removeTree(folder.id);
}

function countLinks(node) {
  return node.url ? 1 : (node.children ?? []).reduce((sum, c) => sum + countLinks(c), 0);
}

async function removeLink(bookmark) {
  await chrome.bookmarks.remove(bookmark.id);
  const { parentId, index, title, url } = bookmark;
  showToast(`Removed "${title}".`, 'Undo', () => chrome.bookmarks.create({ parentId, index, title, url }));
}

let toastTimer;
function showToast(message, actionLabel, action) {
  const children = [el('span', { textContent: message })];
  if (action) {
    const button = el('button', { type: 'button', textContent: actionLabel });
    button.addEventListener('click', () => { toast.hidden = true; action(); });
    children.push(button);
  }
  toast.replaceChildren(...children);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}

// ---------- context menu ----------

function openMenu(x, y, items) {
  menu.replaceChildren(...items.map(([label, run, danger]) => {
    const button = el('button', { type: 'button', textContent: label, className: danger ? 'danger' : '' });
    button.addEventListener('click', () => { closeMenu(); run(); });
    return button;
  }));
  menu.hidden = false;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
  menu.querySelector('button').focus();
}

function closeMenu() {
  menu.hidden = true;
}

app.addEventListener('contextmenu', async (e) => {
  const tileEl = e.target.closest('a.tile');
  const heading = e.target.closest('h2');
  if (tileEl) {
    e.preventDefault();
    const [bookmark] = await chrome.bookmarks.get(tileEl.dataset.id);
    openMenu(e.clientX, e.clientY, [
      ['Open in new tab', () => chrome.tabs.create({ url: bookmark.url, active: false })],
      ['Edit', () => editLink({ bookmark })],
      ['Remove', () => removeLink(bookmark), true],
    ]);
  } else if (heading) {
    e.preventDefault();
    const [folder] = await chrome.bookmarks.get(heading.closest('section').dataset.id);
    openMenu(e.clientX, e.clientY, [
      ['Add link', () => editLink({ parentId: folder.id })],
      ['Rename', () => editSection({ folder })],
      ['Colour…', () => pickColor(folder)],
      ['Add section inside', () => editSection({ parentId: folder.id })],
      ['Remove section', () => removeSection(folder), true],
    ]);
  }
});

document.addEventListener('click', (e) => { if (!menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
addEventListener('blur', closeMenu);
addEventListener('scroll', closeMenu, true);

// ---------- collapsing ----------

app.addEventListener('click', (e) => {
  const heading = e.target.closest('h2');
  if (!heading) return;
  const sectionEl = heading.closest('section');
  const { id } = sectionEl.dataset;
  const collapsed = settings.collapsed.includes(id)
    ? settings.collapsed.filter((x) => x !== id)
    : [...settings.collapsed, id];
  sectionEl.classList.toggle('collapsed');
  saveSettings({ collapsed });
});

// ---------- drag and drop ----------

function clearDropMarks() {
  for (const node of app.querySelectorAll('.drop-before, .drop-after, .drop-into')) {
    node.classList.remove('drop-before', 'drop-after', 'drop-into');
  }
}

// Works out where a drop at this point would land: { parentId, index, mark, markClass }.
function dropTarget(e) {
  const section = e.target.closest('section');
  if (!section) return null;
  if (dragging?.kind === 'section') {
    if (section.classList.contains('pinned') || section.dataset.id === dragging.id) return null;
    const { top, height } = section.getBoundingClientRect();
    return { sectionId: section.dataset.id, after: e.clientY > top + height / 2, mark: section };
  }
  const tileEl = e.target.closest('a.tile');
  if (tileEl) {
    const { left, width } = tileEl.getBoundingClientRect();
    const after = e.clientX > left + width / 2;
    return {
      parentId: tileEl.dataset.parentId,
      index: Number(tileEl.dataset.index) + (after ? 1 : 0),
      mark: tileEl,
      markClass: after ? 'drop-after' : 'drop-before',
    };
  }
  return { parentId: section.dataset.id, mark: section, markClass: 'drop-into' };
}

app.addEventListener('dragstart', (e) => {
  const tileEl = e.target.closest?.('a.tile');
  const heading = e.target.closest?.('h2');
  if (tileEl) dragging = { kind: 'tile', id: tileEl.dataset.id };
  else if (heading) dragging = { kind: 'section', id: heading.closest('section').dataset.id };
  if (dragging) e.dataTransfer.effectAllowed = 'move';
});

app.addEventListener('dragend', () => {
  dragging = null;
  clearDropMarks();
});

app.addEventListener('dragover', (e) => {
  const external = !dragging && e.dataTransfer.types.includes('text/uri-list');
  if (!dragging && !external) return;
  const target = dropTarget(e);
  clearDropMarks();
  if (!target || (external && !target.parentId)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = external ? 'copy' : 'move';
  target.mark.classList.add(target.markClass ?? (target.after ? 'drop-after' : 'drop-before'));
});

app.addEventListener('drop', async (e) => {
  const target = dropTarget(e);
  const source = dragging;
  clearDropMarks();
  if (!target) return;
  e.preventDefault();
  try {
    if (source?.kind === 'section') {
      const [anchor] = await chrome.bookmarks.get(target.sectionId);
      await chrome.bookmarks.move(source.id, { parentId: anchor.parentId, index: anchor.index + (target.after ? 1 : 0) });
    } else if (source?.kind === 'tile') {
      await chrome.bookmarks.move(source.id, target.index === undefined
        ? { parentId: target.parentId }
        : { parentId: target.parentId, index: target.index });
    } else {
      const url = normaliseUrl(e.dataTransfer.getData('text/uri-list').split('\n')[0]);
      const title = e.dataTransfer.getData('text/plain') === url ? new URL(url).hostname : e.dataTransfer.getData('text/plain');
      const placement = target.index === undefined ? { parentId: target.parentId } : { parentId: target.parentId, index: target.index };
      await chrome.bookmarks.create({ ...placement, title: title || new URL(url).hostname, url });
    }
  } catch (err) {
    // e.g. moving a section into one of its own subfolders
    showToast(`Could not move that: ${err.message}`);
  }
});

// ---------- wiring ----------

document.getElementById('settings').addEventListener('click', (e) => {
  e.stopPropagation(); // keep the document click handler from closing the menu straight away
  const { left, top } = e.currentTarget.getBoundingClientRect();
  const compact = settings.density === 'compact';
  openMenu(left, top, [
    [settings.name ? `Name: ${settings.name}` : 'Set your name', askName],
    [compact ? 'Comfortable tiles' : 'Compact tiles', () => saveSettings({ density: compact ? 'comfortable' : 'compact' })],
    ['Bookmark manager', () => chrome.tabs.create({ url: startId ? `chrome://bookmarks/?id=${startId}` : 'chrome://bookmarks/' })],
  ]);
});

chrome.storage.onChanged.addListener(async (_, area) => {
  if (area !== 'sync') return;
  await loadSettings();
  updateHeader();
  scheduleRender();
});

for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
  chrome.bookmarks[event].addListener(scheduleRender);
}

await loadSettings();
tickClock();
render();

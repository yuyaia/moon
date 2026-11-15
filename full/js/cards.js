// 字卡库：独立的一页。
// 支持：写一句、TXT / Word 导入、图片链接导入（表情包）、预览、去重。

import * as db from './db.js';
import { $, el, toast, openActionSheet } from './ui.js';
import { prepareImage } from './media.js';

export const CATEGORIES = ['开场', '问候', '日常', '心情', '晚安', 'emoji', '表情包', '自定义'];

let activeCat = '全部';
let onSendCb = null;
let bound = false;
let visible = false;

const thumbUrls = new Map();
const previewUrls = new Set();

let importItems = [];
let importKind = 'text';
let importMode = 'preview';
let importCategory = '日常';
let importBusy = false;
let importRun = 0;

let selectMode = false;
const selectedIds = new Set();
let visibleCards = [];
let editingId = null;
let editCategory = '日常';

/* ---------------- 页面 / 列表 ---------------- */

function hidePage() {
  if (!$('#importSheet').hidden) closeImportSheet();
  $('#cardsView').hidden = true;
  visible = false;
}

function closePage() {
  hidePage();
  if (history.state && history.state.view === 'cards') history.back();
}

async function mediaURL(mediaId) {
  if (!mediaId) return null;
  if (thumbUrls.has(mediaId)) return thumbUrls.get(mediaId);
  const record = await db.getMedia(mediaId);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  thumbUrls.set(mediaId, url);
  return url;
}

function bind() {
  if (bound) return;
  bound = true;

  $('#cardsBack').addEventListener('click', closePage);

  let searchTimer = 0;
  $('#cardSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refresh(), 120);
  });

  $('#selectMode').addEventListener('click', toggleSelectMode);
  $('#selectDone').addEventListener('click', exitSelectMode);
  $('#selectAll').addEventListener('click', toggleSelectAll);
  $('#deleteSelected').addEventListener('click', deleteSelectedCards);

  $('#btnImportImages').addEventListener('click', () => {
    const input = $('#importImages');
    input.value = '';
    input.click();
  });
  $('#importImages').addEventListener('change', async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length) await importImageFiles(files);
  });
  $('#importSelectAll').addEventListener('click', toggleImportSelection);

  $('#editClose').addEventListener('click', closeEditCard);
  $('#editBackdrop').addEventListener('click', closeEditCard);
  $('#editSave').addEventListener('click', saveEditCard);

  $('#cardAdd').addEventListener('click', addFromInput);
  $('#cardNew').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addFromInput();
    }
  });

  $('#btnImportFile').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length) await parseFiles(files);
  });

  $('#btnImportUrl').addEventListener('click', () => openImportSheet('url'));
  $('#importClose').addEventListener('click', closeImportSheet);
  $('#importBackdrop').addEventListener('click', closeImportSheet);
  $('#importConfirm').addEventListener('click', () => {
    if (importMode === 'url') readUrlInput();
    else commitImport();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('#editSheet').hidden) closeEditCard();
    else if (!$('#importSheet').hidden) closeImportSheet();
  });

  window.addEventListener('popstate', () => {
    if (visible) {
      if (!(history.state && history.state.view === 'cards')) hidePage();
    }
  });
}

async function refresh() {
  const cards = await db.getCards();
  const query = ($('#cardSearch').value || '').trim().toLowerCase();

  let filtered = activeCat === '全部' ? cards : cards.filter((c) => c.category === activeCat);
  if (query) {
    filtered = filtered.filter((c) =>
      `${c.text || ''} ${c.category || ''} ${c.sourceUrl || ''} ${c.sourceKey || ''}`
        .toLowerCase()
        .includes(query)
    );
  }
  visibleCards = filtered;

  $('#cardsCount').textContent = query
    ? `${filtered.length}/${cards.length}`
    : `${cards.length} 张`;
  $('#selectMode').textContent = selectMode ? '完成' : '选择';
  $('#selectMode').classList.toggle('active', selectMode);
  $('#selectBar').hidden = !selectMode;
  $('.card-tools').hidden = selectMode;

  syncTools();
  updateSelectBar();

  const chips = $('#cardChips');
  const counts = new Map();
  for (const card of cards) counts.set(card.category, (counts.get(card.category) || 0) + 1);
  const cats = ['全部', ...CATEGORIES];
  if (!cats.includes(activeCat)) activeCat = '全部';

  chips.replaceChildren(
    ...cats.map((cat) =>
      el('button', {
        type: 'button',
        class: `chip${cat === activeCat ? ' active' : ''}`,
        text: cat === '全部' ? `全部 ${cards.length}` : `${cat} ${counts.get(cat) || 0}`,
        onclick: () => {
          activeCat = cat;
          refresh();
        },
      })
    )
  );

  const list = $('#cardsList');

  if (!filtered.length) {
    let text = '还没有字卡。写一句试试。';
    if (query) text = '没有找到。';
    else if (activeCat !== '全部') text = '这个分类还是空的。';
    list.replaceChildren(el('p', { class: 'cards-empty', text }));
    return;
  }

  list.replaceChildren(
    ...filtered.map((card) => {
      const isImage = card.type === 'image';
      const selected = selectedIds.has(card.id);
      const row = el('div', {
        class: `card-item${selected ? ' selected' : ''}`,
        dataset: { card: card.id },
      });

      if (selectMode) {
        const check = el('span', { class: `card-check${selected ? ' on' : ''}`, 'aria-hidden': 'true' });
        check.addEventListener('click', (event) => {
          event.stopPropagation();
          toggleSelected(card.id);
        });
        row.append(check);
      }

      const send = el('button', {
        type: 'button',
        class: `card-text${isImage ? ' card-image' : ''}`,
        'aria-label': selectMode
          ? (selected ? '取消选择' : '选择这张')
          : (isImage ? '发送表情包' : '发送这句话'),
        onclick: () => {
          if (selectMode) {
            toggleSelected(card.id);
            return;
          }
          const cb = onSendCb;
          closePage();
          cb?.(card);
        },
      });

      if (isImage) {
        const img = el('img', { alt: '表情包' });
        send.append(el('span', { class: 'card-thumb' }, img));
        mediaURL(card.mediaId).then((url) => {
          if (url) img.src = url;
          else img.alt = '图片已经找不到了';
        });
      } else {
        send.textContent = card.text;
      }

      row.append(send);

      if (!selectMode) {
        if (!isImage) {
          row.append(el('button', {
            type: 'button',
            class: 'card-edit',
            'aria-label': '编辑字卡',
            html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.2-1 10.3-10.3a2.1 2.1 0 0 0 0-3l-.2-.2a2.1 2.1 0 0 0-3 0L5 15.8z"/><path d="M13.8 7.2l3 3"/></svg>',
            onclick: () => openEditCard(card),
          }));
        }

        row.append(el('button', {
          type: 'button',
          class: 'card-del',
          text: '×',
          'aria-label': '删掉这张字卡',
          onclick: async () => {
            await db.deleteCard(card.id);
            selectedIds.delete(card.id);
            toast('删掉了');
            refresh();
          },
        }));
      }

      return row;
    })
  );
}

function splitBlocks(value) {
  const clean = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!clean) return [];
  if (/\n\s*\n/.test(clean)) {
    return clean.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  }
  return clean.split('\n').map((line) => line.trim()).filter(Boolean);
}

function syncTools() {
  const sticker = activeCat === '表情包';
  $('.card-quick-add').hidden = sticker;
  $('#btnImportUrl').hidden = !sticker;
  $('#btnImportImages').hidden = !sticker;
  $('#toolHint').hidden = sticker;
  $('#importFile').setAttribute(
    'accept',
    sticker ? '.txt,text/plain' : '.txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  $('#importFileLabel').textContent = sticker ? '导入 URL 列表' : '导入文件';
  $('#toolHint').textContent = sticker ? '' : 'TXT / Word';
}

function updateSelectBar() {
  const count = selectedIds.size;
  const deleteButton = $('#deleteSelected');
  deleteButton.textContent = count ? `删除 ${count} 张` : '删除';
  deleteButton.disabled = count === 0;

  const allVisible = visibleCards.length > 0
    && visibleCards.every((card) => selectedIds.has(card.id));
  const selectAll = $('#selectAll');
  selectAll.textContent = allVisible ? '取消全选' : '全选';
  selectAll.disabled = visibleCards.length === 0;
}

function toggleSelected(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);

  const row = document.querySelector(`#cardsList .card-item[data-card="${id}"]`);
  if (row) {
    const on = selectedIds.has(id);
    row.classList.toggle('selected', on);
    row.querySelector('.card-check')?.classList.toggle('on', on);
  }
  updateSelectBar();
}

function toggleSelectMode() {
  if (selectMode) {
    exitSelectMode();
    return;
  }
  selectMode = true;
  selectedIds.clear();
  refresh();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  $('#selectMode').textContent = '选择';
  $('#selectMode').classList.remove('active');
  $('#selectBar').hidden = true;
  $('.card-tools').hidden = false;
  refresh();
}

function toggleSelectAll() {
  if (!visibleCards.length) return;
  const all = visibleCards.every((card) => selectedIds.has(card.id));
  for (const card of visibleCards) {
    if (all) selectedIds.delete(card.id);
    else selectedIds.add(card.id);
  }
  refresh();
}

function deleteSelectedCards() {
  const count = selectedIds.size;
  if (!count) return;

  openActionSheet(`删掉选中的 ${count} 张？`, [{
    label: '删掉',
    danger: true,
    onClick: async () => {
      const ids = [...selectedIds];
      for (const id of ids) await db.deleteCard(id);
      selectedIds.clear();
      selectMode = false;
      toast(`删了 ${ids.length} 张`);
      refresh();
    },
  }]);
}

function openEditCard(card) {
  if (card.type === 'image') return;
  editingId = card.id;
  editCategory = card.category || '日常';
  $('#editText').value = card.text || '';
  renderEditCats();
  $('#editBackdrop').hidden = false;
  $('#editSheet').hidden = false;
  $('#editText').focus();
}

function renderEditCats() {
  $('#editCats').replaceChildren(
    ...CATEGORIES.map((cat) =>
      el('button', {
        type: 'button',
        class: `chip${cat === editCategory ? ' active' : ''}`,
        text: cat,
        onclick: () => {
          editCategory = cat;
          renderEditCats();
        },
      })
    )
  );
}

function closeEditCard() {
  $('#editSheet').hidden = true;
  $('#editBackdrop').hidden = true;
  editingId = null;
}

async function saveEditCard() {
  if (!editingId) return;
  const text = $('#editText').value.trim();
  if (!text) {
    toast('先写一句');
    return;
  }
  const updated = await db.updateCard(editingId, { text, category: editCategory });
  if (!updated) toast('这张卡找不到了');
  else toast('改好了');
  closeEditCard();
  refresh();
}

async function addFromInput() {
  const input = $('#cardNew');
  const blocks = splitBlocks(input.value);
  if (!blocks.length) {
    input.focus();
    return;
  }
  const category = activeCat !== '全部' ? activeCat : '日常';
  for (const text of blocks) {
    await db.addCard({ text, category });
  }
  input.value = '';
  toast(blocks.length > 1 ? `加了 ${blocks.length} 张` : '加好了');
  refresh();
}

export async function reloadCards() {
  if (!visible) return;
  selectMode = false;
  selectedIds.clear();
  editingId = null;
  await refresh();
}

export async function openCardsPage({ onSend, category } = {}) {
  bind();
  onSendCb = onSend;
  activeCat = category && CATEGORIES.includes(category) ? category : '全部';
  selectMode = false;
  selectedIds.clear();
  editingId = null;
  $('#cardSearch').value = '';
  $('#selectMode').textContent = '选择';
  $('#selectMode').classList.remove('active');
  $('#selectBar').hidden = true;
  visible = true;
  $('#cardsView').hidden = false;
  if (!history.state || history.state.view !== 'cards') {
    history.pushState({ view: 'cards' }, '');
  }
  await refresh();
}

/* ---------------- 导入：通用 ---------------- */

function normalizeText(value) {
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function openImportSheet(mode) {
  bind();
  importRun += 1;
  importMode = mode;
  importItems = [];
  importBusy = false;
  $('#importBody').replaceChildren();
  $('#importTitle').textContent = mode === 'url' ? '图片链接' : '导入预览';
  $('#importBackdrop').hidden = false;
  $('#importSheet').hidden = false;
  if (mode === 'url') renderUrlEntry();
  updateImportFooter();
}

function closeImportSheet() {
  importRun += 1;
  $('#importSheet').hidden = true;
  $('#importBackdrop').hidden = true;
  $('#importBody').replaceChildren();
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls.clear();
  importItems = [];
  importBusy = false;
}

function updateImportFooter() {
  const button = $('#importConfirm');
  const summary = $('#importSummary');
  const selectAll = $('#importSelectAll');

  if (importMode === 'url') {
    summary.textContent = '支持 http/https 图片直链，读成“表情包”字卡';
    button.textContent = importBusy ? '读取中…' : '读取链接';
    button.disabled = importBusy;
    selectAll.hidden = true;
    return;
  }

  const selectable = importItems.filter((item) => !item.duplicate);
  const selected = selectable.filter((item) => item.selected).length;
  const duplicate = importItems.filter((item) => item.duplicate).length;

  summary.textContent = `已选 ${selected} 张${duplicate ? ` · 已有 ${duplicate} 张` : ''}`;
  button.textContent = importBusy ? '导入中…' : `导入 ${selected} 张`;
  button.disabled = importBusy || selected === 0;

  selectAll.hidden = false;
  selectAll.disabled = selectable.length === 0;
  selectAll.textContent = selectable.length && selectable.every((item) => item.selected) ? '取消全选' : '全选';
}

function toggleImportSelection() {
  if (importMode !== 'preview') return;
  const selectable = importItems.filter((item) => !item.duplicate);
  if (!selectable.length) return;
  const all = selectable.every((item) => item.selected);
  for (const item of selectable) item.selected = !all;
  renderPreview();
}

function renderUrlEntry() {
  const body = $('#importBody');
  const textarea = el('textarea', {
    class: 'import-url-input',
    id: 'importUrls',
    placeholder: 'https://example.com/a.png\nhttps://example.com/b.png',
    spellcheck: 'false',
  });
  body.replaceChildren(
    el('p', { class: 'import-hint', text: '一行一个图片链接。会下载到本机，作为“表情包”字卡；不能跨域读取的链接会被跳过。' }),
    textarea
  );
  textarea.focus();
}

function openPreview(items, kind) {
  importItems = items;
  importKind = kind;
  importMode = 'preview';
  importCategory = kind === 'image'
    ? '表情包'
    : (activeCat !== '全部' && activeCat !== '表情包' ? activeCat : '日常');
  $('#importTitle').textContent = kind === 'image' ? '导入表情包' : '导入字卡';
  $('#importBackdrop').hidden = false;
  $('#importSheet').hidden = false;
  renderPreview();
}

function renderPreview() {
  const body = $('#importBody');
  body.replaceChildren();

  if (importKind === 'text') {
    const cats = el('div', { class: 'import-cats' });
    for (const cat of CATEGORIES) {
      cats.append(el('button', {
        type: 'button',
        class: `chip${cat === importCategory ? ' active' : ''}`,
        text: cat,
        onclick: () => {
          importCategory = cat;
          renderPreview();
        },
      }));
    }
    body.append(cats);
  }

  const list = el('div');
  for (const item of importItems) {
    const check = el('input', { type: 'checkbox' });
    check.checked = item.selected && !item.duplicate;
    check.disabled = item.duplicate;
    check.addEventListener('change', () => {
      item.selected = check.checked;
      updateImportFooter();
    });

    let content;
    if (importKind === 'image') {
      const img = el('img', { alt: '表情包', src: item.previewUrl });
      content = el('div', { class: 'import-text' },
        el('div', { class: 'import-thumb' }, img),
        el('span', { class: 'import-url', text: item.sourceUrl || item.label || '' })
      );
    } else {
      content = el('span', { class: 'import-text', text: item.text });
    }

    body.append(
      el('label', { class: `import-item${item.duplicate ? ' dup' : ''}` },
        check,
        content,
        item.duplicate ? el('span', { class: 'import-badge', text: '已有' }) : null
      )
    );
  }

  updateImportFooter();
}

/* ---------------- 导入：文件 ---------------- */

async function parseFiles(files) {
  const run = ++importRun;
  let firstError = '';

  if (activeCat === '表情包') {
    const urls = [];
    for (const file of files) {
      try {
        if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') {
          throw new Error('表情包只支持 TXT 里的图片链接');
        }
        const text = await file.text();
        for (const value of text.split(/\s+/)) {
          const url = value.trim();
          if (/^https?:\/\//i.test(url)) urls.push(url);
        }
      } catch (error) {
        firstError ||= `${file.name}：${error.message}`;
      }
    }
    if (run !== importRun) return;
    const unique = [...new Set(urls)];
    if (!unique.length) {
      toast(firstError || 'TXT 里没有图片链接', 2600);
      return;
    }
    if (firstError) toast(firstError, 2800);
    await loadImageUrls(unique);
    return;
  }

  const existing = await existingTextSet();
  const seen = new Set();
  const items = [];

  for (const file of files) {
    let blocks = [];
    try {
      if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
        blocks = await readTxt(file);
      } else if (/\.docx$/i.test(file.name)) {
        blocks = await readDocx(file);
      } else {
        throw new Error('只支持 TXT / Word(.docx)');
      }
    } catch (error) {
      firstError ||= `${file.name}：${error.message}`;
      continue;
    }

    for (const raw of blocks) {
      const normalized = normalizeText(raw);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const duplicate = existing.has(normalized);
      items.push({ text: String(raw).trim(), duplicate, selected: !duplicate });
      if (items.length >= 500) break;
    }
    if (items.length >= 500) break;
  }

  if (!items.length) {
    toast(firstError || '没读到可以导入的句子', 2600);
    return;
  }
  if (firstError) toast(firstError, 2800);
  if (run !== importRun) return;
  openPreview(items, 'text');
}

async function readTxt(file) {
  return splitBlocks(await file.text());
}

async function existingTextSet() {
  const cards = await db.getCards();
  return new Set(
    cards
      .filter((card) => card.type !== 'image')
      .map((card) => normalizeText(card.text))
      .filter(Boolean)
  );
}

/* Word：docx 是一个 zip，读 word/document.xml，按段落取文字。 */
async function readDocx(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error('文件太大了');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const xml = await readZipEntry(bytes, 'word/document.xml');
  return docxToLines(xml);
}

function docxToLines(xml) {
  const lines = [];
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paragraphs = doc.getElementsByTagNameNS(NS, 'p');
    for (const paragraph of paragraphs) {
      const texts = paragraph.getElementsByTagNameNS(NS, 't');
      let line = '';
      for (const node of texts) line += node.textContent || '';
      const clean = normalizeText(line);
      if (clean) lines.push(clean);
    }
  } catch { /* 退回正则 */ }

  if (!lines.length) {
    const stripped = xml
      .replace(/<w:p[^>]*>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    for (const line of stripped.split(/\r?\n/)) {
      const clean = normalizeText(line);
      if (clean) lines.push(clean);
    }
  }
  return lines;
}

async function readZipEntry(bytes, wantedName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');

  let eocd = -1;
  const min = Math.max(0, bytes.length - 65558);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 Word 文件');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (name === wantedName) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Word 文件损坏了');
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(start, start + compressedSize);

      if (method === 0) return decoder.decode(compressed);
      if (method === 8) {
        if (typeof DecompressionStream === 'undefined') {
          throw new Error('这个浏览器不支持解压 Word，请先另存为 TXT');
        }
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(compressed);
        writer.close();
        return await new Response(ds.readable).text();
      }
      throw new Error('Word 的压缩格式不支持');
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error('Word 文件里没有正文');
}

/* ---------------- 导入：图片链接 ---------------- */

async function readUrlInput() {
  const input = $('#importUrls');
  const urls = [...new Set(
    String(input?.value || '')
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => /^https?:\/\//i.test(value))
  )];

  if (!urls.length) {
    toast('先贴 http/https 图片链接');
    return;
  }
  await loadImageUrls(urls);
}

async function loadImageUrls(urls) {
  const run = ++importRun;
  const unique = [...new Set(urls)].filter((url) => /^https?:\/\//i.test(url));
  if (!unique.length) {
    toast('没有可用的图片链接');
    return;
  }

  const existing = (await existingImageSources()).urls;
  importBusy = true;
  if (!$('#importSheet').hidden) {
    updateImportFooter();
  } else {
    toast('读取图片…', 1200);
  }

  const items = [];
  let failed = 0;

  for (const url of unique) {
    if (run !== importRun) return;
    try {
      const timeout = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(15000)
        : undefined;
      const response = await fetch(url, { mode: 'cors', signal: timeout });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('不是图片');
      const prepared = await prepareImage(blob);
      const previewUrl = URL.createObjectURL(prepared.blob);
      previewUrls.add(previewUrl);
      const duplicate = existing.has(url);
      items.push({
        kind: 'image',
        sourceUrl: url,
        blob: prepared.blob,
        width: prepared.width,
        height: prepared.height,
        previewUrl,
        duplicate,
        selected: !duplicate,
      });
    } catch {
      failed += 1;
    }
  }

  importBusy = false;
  if (run !== importRun) return;

  if (!items.length) {
    toast('这些链接都没读成，可能是跨域限制', 2800);
    if (!$('#importSheet').hidden) updateImportFooter();
    return;
  }
  if (failed) toast(`有 ${failed} 个链接没读成，已跳过`, 2600);
  if (run !== importRun) return;
  openPreview(items, 'image');
}

async function existingImageSources() {
  const cards = await db.getCards();
  return {
    urls: new Set(
      cards
        .filter((card) => card.type === 'image' && card.sourceUrl)
        .map((card) => card.sourceUrl)
    ),
    keys: new Set(
      cards
        .filter((card) => card.type === 'image' && card.sourceKey)
        .map((card) => card.sourceKey)
    ),
  };
}

async function importImageFiles(files) {
  const run = ++importRun;
  const existing = await existingImageSources();
  const seen = new Set();
  const items = [];
  let failed = 0;

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      failed += 1;
      continue;
    }
    try {
      const prepared = await prepareImage(file);
      const sourceKey = `${file.name}|${file.size}`;
      if (seen.has(sourceKey)) continue;
      seen.add(sourceKey);

      const previewUrl = URL.createObjectURL(prepared.blob);
      previewUrls.add(previewUrl);
      const duplicate = existing.keys.has(sourceKey);
      items.push({
        kind: 'image',
        sourceKey,
        label: file.name,
        blob: prepared.blob,
        width: prepared.width,
        height: prepared.height,
        previewUrl,
        duplicate,
        selected: !duplicate,
      });
    } catch {
      failed += 1;
    }
  }

  if (run !== importRun) return;
  if (!items.length) {
    toast(failed ? '这些图片没读成' : '没有可导入的图片', 2600);
    return;
  }
  if (failed) toast(`有 ${failed} 张没读成`, 2600);
  openPreview(items, 'image');
}

/* ---------------- 导入：落库 ---------------- */

async function commitImport() {
  const selected = importItems.filter((item) => item.selected && !item.duplicate);
  if (!selected.length) return;

  importBusy = true;
  updateImportFooter();

  try {
    for (const item of selected) {
      if (importKind === 'image') {
        const sourceUrl = item.sourceUrl || null;
        const sourceKey = item.sourceKey || null;
        const mediaId = await db.putMedia(item.blob, {
          mime: item.blob.type,
          width: item.width,
          height: item.height,
          sourceUrl,
          sourceKey,
        });
        await db.addCard({
          text: '',
          category: '表情包',
          type: 'image',
          mediaId,
          width: item.width,
          height: item.height,
          sourceUrl,
          sourceKey,
        });
      } else {
        await db.addCard({ text: item.text, category: importCategory });
      }
    }
  } finally {
    importBusy = false;
  }

  const count = selected.length;
  closeImportSheet();
  toast(`导入了 ${count} 张`);
  refresh();
}

/* ---------------- 按分类抽一句话回复 ---------------- */

export async function drawReplyCard(excludeText = '') {
  const all = (await db.getCards()).filter((c) => c.type !== 'image' && c.category !== '开场');
  if (!all.length) return null;
  const excluded = String(excludeText || '').trim();
  const cards = excluded ? all.filter((c) => c.text.trim() !== excluded) : all;
  const poolAll = cards.length ? cards : all;

  const recent = (await db.getSetting('recentReplies')) || [];
  const recentSet = new Set(recent);
  const fresh = poolAll.filter((c) => !recentSet.has(c.id));
  const pool = fresh.length ? fresh : poolAll;

  const weight = (card) => {
    switch (card.category) {
      case '日常': return 4;
      case '自定义': return 4;
      case '心情': return 2;
      case '问候': return 2;
      case '晚安': return 1;
      case 'emoji': return 1;
      case '表情包': return 1;
      default: return 2;
    }
  };

  let total = 0;
  for (const card of pool) total += weight(card);
  let roll = Math.random() * total;
  let picked = pool[pool.length - 1];
  for (const card of pool) {
    roll -= weight(card);
    if (roll <= 0) {
      picked = card;
      break;
    }
  }

  await db.setSetting('recentReplies', [picked.id, ...recent].slice(0, 5));
  return picked;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

let toastTimer = 0;
export function toast(message, ms = 1900) {
  const box = $('#toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, ms);
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function debounce(fn, wait = 200) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ---------- 时间 ---------- */

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(n) { return String(n).padStart(2, '0'); }

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  const today = dayKey(now.getTime());
  const key = dayKey(ts);
  if (key === today) return '今天';
  const yesterday = dayKey(now.getTime() - 86400000);
  if (key === yesterday) return '昨天';
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatFull(ts) {
  const d = new Date(ts);
  const now = new Date();
  const year = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日 ${formatTime(ts)}`;
}

export function formatHourDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/* ---------- 符号 ---------- */

export const MOON_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M21.6 3.4a13.2 13.2 0 1 0 7.2 21.2 14.2 14.2 0 0 1-7.2-21.2z" fill="currentColor"/></svg>`;

export const SUN_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="16" cy="16" r="6.1"/><path d="M16 3.2v3M16 25.8v3M3.2 16h3M25.8 16h3M7 7l2.1 2.1M22.9 22.9L25 25M25 7l-2.1 2.1M9.1 22.9L7 25"/></svg>`;

/* ---------- 时区小句子（只做一行环境字，不接天气） ---------- */

export function ambientPhrase(ts) {
  const h = new Date(ts).getHours();
  if (h < 5) return '夜深了';
  if (h < 8) return '天快亮了';
  if (h < 11) return '上午好';
  if (h < 13) return '中午了';
  if (h < 17) return '下午有点长';
  if (h < 19) return '天慢慢暗下来';
  if (h < 22) return '夜里安静';
  if (h < 24) return '该准备睡了';
  return '夜深了';
}

export function formatAmbient(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} · ${ambientPhrase(ts)}`;
}

/* ---------- 弹层 ---------- */

export function openActionSheet(title, actions) {
  const sheet = $('#sheet');
  const backdrop = $('#sheetBackdrop');
  const body = $('#sheetBody');
  body.replaceChildren();
  if (title) {
    body.append(el('p', { class: 'hint', text: title, style: 'padding:2px 6px 6px;margin:0' }));
  }
  const list = el('div', { class: 'sheet-actions' });
  for (const action of actions) {
    if (!action) continue;
    list.append(el('button', {
      type: 'button',
      class: action.danger ? 'danger' : '',
      text: action.label,
      onclick: () => {
        closeSheets();
        action.onClick?.();
      },
    }));
  }
  list.append(el('button', {
    type: 'button',
    text: '取消',
    style: 'color:var(--muted);text-align:center;font-size:13px',
    onclick: closeSheets,
  }));
  body.append(list);
  sheet.hidden = false;
  backdrop.hidden = false;
  backdrop.onclick = closeSheets;
}

export function closeSheets() {
  for (const id of ['#sheet', '#sheetBackdrop', '#settingsSheet', '#settingsBackdrop']) {
    const node = $(id);
    if (node) node.hidden = true;
  }
}

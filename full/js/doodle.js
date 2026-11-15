// 涂鸦板：透明底、手写、可撤销。

import { $, el, toast } from './ui.js';

const LIGHT_COLORS = [
  { name: '墨', value: '#1d2126' },
  { name: '蓝', value: '#4f6579' },
  { name: '雾', value: '#8fa6b8' },
];
const DARK_COLORS = [
  { name: '月光', value: '#e8edf2' },
  { name: '寒蓝', value: '#9fb6ca' },
  { name: '灰绿', value: '#8a9a8e' },
];
const SIZES = [2, 4, 8];

let COLORS = LIGHT_COLORS;

function palette() {
  return document.documentElement.dataset.theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

let canvas = null;
let ctx = null;
let strokes = [];
let current = null;
let color = LIGHT_COLORS[0].value;
let size = 4;
let dpr = 1;
let bound = false;
let onSaveCb = null;

function redraw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  for (const stroke of [...strokes, current].filter(Boolean)) {
    if (!stroke.points.length) continue;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const [first, ...rest] = stroke.points;
    ctx.moveTo(first.x, first.y);
    if (!rest.length) {
      // 点一下也留一个小点
      ctx.lineTo(first.x + 0.01, first.y);
    } else {
      for (const p of rest) ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}

function pointAt(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function buildSwatches() {
  const wrap = $('#swatches');
  const presets = COLORS.map((c) =>
    el('button', {
      type: 'button',
      class: `swatch${c.value === color ? ' active' : ''}`,
      'aria-label': c.name,
      style: `background:${c.value}`,
      onclick: (event) => {
        color = c.value;
        const dot = wrap.querySelector('.custom-dot');
        const picker = wrap.querySelector('.swatch.custom input');
        if (dot) dot.style.background = c.value;
        if (picker) picker.value = c.value;
        for (const node of wrap.children) node.classList.toggle('active', node === event.currentTarget);
      },
    })
  );

  const dot = el('span', { class: 'custom-dot', style: `background:${color}` });
  const picker = el('input', { type: 'color', value: color, 'aria-label': '调色盘' });
  const custom = el('label', { class: 'swatch custom', title: '调色盘' }, dot, picker);

  const useCustomColor = () => {
    color = picker.value;
    dot.style.background = color;
    for (const node of wrap.children) node.classList.toggle('active', node === custom);
  };
  picker.addEventListener('input', useCustomColor);
  picker.addEventListener('change', useCustomColor);

  wrap.replaceChildren(...presets, custom);
}

function buildSizes() {
  const wrap = $('#sizes');
  wrap.replaceChildren(
    ...SIZES.map((s) =>
      el('button', {
        type: 'button',
        class: `size-dot${s === size ? ' active' : ''}`,
        'aria-label': `粗细 ${s}`,
        onclick: (event) => {
          size = s;
          for (const node of wrap.children) node.classList.toggle('active', node === event.currentTarget);
        },
      }, el('i', { style: `width:${s + 3}px;height:${s + 3}px` }))
    )
  );
}

export function initDoodle() {
  if (bound) return;
  bound = true;
  canvas = $('#doodleCanvas');
  ctx = canvas.getContext('2d');

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    current = { color, size, points: [pointAt(event)] };
    redraw();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!current) return;
    current.points.push(pointAt(event));
    redraw();
  });

  const end = () => {
    if (!current) return;
    strokes.push(current);
    current = null;
    redraw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  $('#doodleUndo').addEventListener('click', () => {
    strokes.pop();
    redraw();
  });

  $('#doodleClear').addEventListener('click', () => {
    if (!strokes.length) return;
    strokes = [];
    redraw();
  });

  $('#doodleCancel').addEventListener('click', closeDoodle);
  $('#doodleClose').addEventListener('click', closeDoodle);
  $('#doodleBackdrop').addEventListener('click', closeDoodle);

  $('#doodleSave').addEventListener('click', async () => {
    if (!strokes.length) {
      toast('还没画呢');
      return;
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const cb = onSaveCb;
    closeDoodle();
    if (blob && cb) cb(blob);
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if ($('#doodle').hidden) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 160);
  });
}

export function openDoodle({ onSave } = {}) {
  initDoodle();
  onSaveCb = onSave;
  COLORS = palette();
  color = COLORS[0].value;
  size = 4;
  strokes = [];
  current = null;
  $('#doodle').hidden = false;
  buildSwatches();
  buildSizes();
  requestAnimationFrame(() => {
    resize();
  });
}

export function closeDoodle() {
  $('#doodle').hidden = true;
  strokes = [];
  current = null;
}

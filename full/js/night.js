import * as db from './db.js';
import { $, toast } from './ui.js';

let bound = false;
let active = false;
let wakeAt = 0;
let startedAt = 0;
let tickTimer = 0;

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseTime(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return parseTime(fallback, '23:30');
  return [Math.min(23, Number(match[1])), Math.min(59, Number(match[2]))];
}

function wakeAtFrom(value, from = Date.now()) {
  const [hour, minute] = parseTime(value, '07:30');
  const date = new Date(from);
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= from) date.setDate(date.getDate() + 1);
  return date.getTime();
}

function updateClock() {
  const now = new Date();
  const clock = $('#nightClock');
  if (clock) clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function updateHint() {
  const hint = $('#nightHint');
  if (!hint) return;
  const wake = $('#nightWake')?.value || '07:30';
  hint.textContent = `到 ${wake} 自动结束。`;
}

async function pickLine() {
  const cards = await db.getCards();
  const lines = cards
    .filter((card) => card.category === '晚安' && card.type !== 'image' && card.text)
    .map((card) => card.text.trim())
    .filter(Boolean);
  if (!lines.length) return '晚安，灯关了。';
  return lines[Math.floor(Math.random() * lines.length)];
}

async function endNight(auto = false) {
  const wasActive = active;
  active = false;
  wakeAt = 0;
  clearInterval(tickTimer);
  tickTimer = 0;
  $('#nightView').hidden = true;

  if (wasActive) {
    await db.setSetting('nightActive', false);
    await db.setSetting('nightWakeAt', 0);
    await db.setSetting('nightStartedAt', 0);
    await db.setSetting('nightLine', '');
    toast(auto ? '早上了。' : '晚安模式结束了', 2600);
  }
}

export async function checkNightAutoEnd() {
  if (!active) return false;
  const stored = Number(await db.getSetting('nightWakeAt')) || 0;
  if (stored) wakeAt = stored;
  if (wakeAt && Date.now() >= wakeAt) {
    await endNight(true);
    return true;
  }
  return false;
}

async function tick() {
  updateClock();
  await checkNightAutoEnd();
}

function schedule() {
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 15000);
}

function bind() {
  if (bound) return;
  bound = true;

  $('#nightClose').addEventListener('click', () => endNight(false));
  $('#nightEnd').addEventListener('click', () => endNight(false));

  const saveTimes = async () => {
    const sleep = $('#nightSleep').value || '23:30';
    const wake = $('#nightWake').value || '07:30';
    await db.setSetting('nightSleep', sleep);
    await db.setSetting('nightWake', wake);
    if (active) {
      wakeAt = wakeAtFrom(wake, startedAt || Date.now());
      await db.setSetting('nightWakeAt', wakeAt);
      updateHint();
      await checkNightAutoEnd();
    }
  };

  $('#nightSleep').addEventListener('change', saveTimes);
  $('#nightWake').addEventListener('change', saveTimes);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#nightView').hidden) endNight(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && active) tick();
  });

  document.addEventListener('moon:home', () => {
    if (active) endNight(false);
  });
}

export async function openNight({ resume = false } = {}) {
  bind();
  const settings = await db.getAllSettings();
  const sleep = settings.nightSleep || '23:30';
  const wake = settings.nightWake || '07:30';

  startedAt = resume && settings.nightStartedAt ? settings.nightStartedAt : Date.now();
  wakeAt = resume && settings.nightWakeAt && settings.nightWakeAt > Date.now()
    ? settings.nightWakeAt
    : wakeAtFrom(wake, startedAt);

  let line = resume && settings.nightLine ? settings.nightLine : '';
  if (!line) line = await pickLine();

  active = true;
  await db.setSetting('nightActive', true);
  await db.setSetting('nightWakeAt', wakeAt);
  await db.setSetting('nightStartedAt', startedAt);
  await db.setSetting('nightLine', line);

  $('#nightSleep').value = sleep;
  $('#nightWake').value = wake;
  $('#nightLine').textContent = line;
  $('#nightSub').textContent = `${settings.nameMoon || 'moon'} 也睡了。`;
  updateHint();
  updateClock();
  $('#nightView').hidden = false;
  schedule();
  await checkNightAutoEnd();
}

export async function resumeNight() {
  const settings = await db.getAllSettings();
  if (!settings.nightActive) return false;

  if (settings.nightWakeAt && settings.nightWakeAt > Date.now()) {
    await openNight({ resume: true });
    return true;
  }

  await db.setSetting('nightActive', false);
  await db.setSetting('nightWakeAt', 0);
  await db.setSetting('nightStartedAt', 0);
  await db.setSetting('nightLine', '');
  return false;
}

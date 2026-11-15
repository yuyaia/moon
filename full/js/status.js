// 状态 C 方案：小条 + 状态词，数字点开才看。
// 只做“读”的呈现：不衰减、不养成、不影响回复。
// 精力跟时间走；心情跟今天聊了多少有一点点关系（最多 ±2 格）。

import { el, clamp } from './ui.js';

const ENERGY_BY_HOUR = [2, 2, 1, 1, 1, 2, 3, 5, 6, 7, 7, 6, 6, 4, 4, 5, 6, 6, 5, 5, 4, 4, 3, 2];

function moodWord(v) {
  if (v >= 7) return '亮一点';
  if (v >= 5) return '安静';
  if (v >= 3) return '有点闷';
  return '低落';
}

function energyWord(v) {
  if (v >= 7) return '有精神';
  if (v >= 5) return '还好';
  if (v >= 3) return '有点困';
  return '很困';
}

export function computeStatus(now = Date.now(), todayCount = 0) {
  const hour = new Date(now).getHours();
  const energy = clamp(ENERGY_BY_HOUR[hour], 1, 8);

  let mood = 5;
  if (todayCount >= 3) mood += 1;
  if (todayCount >= 12) mood += 1;
  if (hour >= 23 || hour < 5) mood -= 1;
  mood = clamp(mood, 1, 8);

  return {
    mood: { value: mood, word: moodWord(mood) },
    energy: { value: energy, word: energyWord(energy) },
  };
}

export function renderStatus(node, status) {
  node.replaceChildren(
    ...['mood', 'energy'].map((key) => {
      const data = status[key];
      return el(
        'div',
        { class: 'status-row', dataset: { k: key } },
        el('span', { class: 'status-label', text: key === 'mood' ? '心情' : '精力' }),
        el('span', { class: 'status-track' },
          el('span', {
            class: 'status-fill',
            style: `width:${(data.value / 8) * 100}%`,
          })
        ),
        el('span', { class: 'status-word', text: data.word }),
        el('span', { class: 'status-num', text: `${data.value}/8` })
      );
    })
  );
}

// 开场页下端的一行“签名”：
// 节气 / 节日优先，平时从季节文案里按天轮换。全部内置，不联网。

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 24 节气。日期用通行的 21 世纪公式算：day = floor(Y*0.2422 + C) - trunc((Y-1)/4)
// 个别年份可能差一天，对一句文案来说够用了。
const TERMS = [
  ['小寒', 1, 5.4055], ['大寒', 1, 20.12],
  ['立春', 2, 3.87], ['雨水', 2, 18.73],
  ['惊蛰', 3, 5.63], ['春分', 3, 20.646],
  ['清明', 4, 4.81], ['谷雨', 4, 20.1],
  ['立夏', 5, 5.52], ['小满', 5, 21.04],
  ['芒种', 6, 5.678], ['夏至', 6, 21.37],
  ['小暑', 7, 7.108], ['大暑', 7, 22.83],
  ['立秋', 8, 7.5], ['处暑', 8, 23.13],
  ['白露', 9, 7.646], ['秋分', 9, 23.042],
  ['寒露', 10, 8.318], ['霜降', 10, 23.438],
  ['立冬', 11, 7.438], ['小雪', 11, 22.36],
  ['大雪', 12, 7.18], ['冬至', 12, 21.94],
];

const TERM_COPY = {
  小寒: '冷得正好，可以多穿一点。',
  大寒: '最冷的时候，也快过去了。',
  立春: '风要开始变软了。',
  雨水: '雨落下来，土就醒了。',
  惊蛰: '有什么东西在地下翻身。',
  春分: '白天和黑夜一样长。',
  清明: '今天适合想一些旧事。',
  谷雨: '雨一遍一遍，把春天洗干净。',
  立夏: '光开始变得很长。',
  小满: '不用太满，刚刚好。',
  芒种: '该忙的忙，该歇的歇。',
  夏至: '一年里最长的一个白天。',
  小暑: '热气从地面往上爬。',
  大暑: '把日子过得慢一点。',
  立秋: '风里有一点凉意了。',
  处暑: '热在退，别急。',
  白露: '早上有一点湿凉。',
  秋分: '夜开始比白天长了。',
  寒露: '露水凉了，记得添衣。',
  霜降: '窗外开始有霜的味道。',
  立冬: '把手揣进口袋吧。',
  小雪: '如果下雪，就抬头看一会儿。',
  大雪: '光很淡，适合待在屋里。',
  冬至: '夜最长，明天就慢慢亮回来了。',
};

const FESTIVALS = {
  '1-1': '元旦',
  '2-14': '情人节',
  '3-8': '妇女节',
  '3-12': '植树节',
  '4-1': '愚人节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '6-1': '儿童节',
  '7-1': '建党节',
  '8-1': '建军节',
  '9-10': '教师节',
  '10-1': '国庆节',
  '12-24': '平安夜',
  '12-25': '圣诞节',
  '12-31': '跨年夜',
};

const FESTIVAL_COPY = {
  元旦: '新的一年，先不急着许愿。',
  情人节: '今天可以说一点软的话。',
  妇女节: '今天你是被偏爱的那个。',
  植树节: '种不种树都行，先晒晒太阳。',
  愚人节: '今天说的话，可以不算数。',
  劳动节: '今天不劳动，也是一种劳动。',
  青年节: '还愿意心动，就还年轻。',
  儿童节: '今天可以理直气壮地幼稚。',
  建党节: '七月一日。',
  建军节: '八月一日。',
  教师节: '想起一个教过你的人。',
  国庆节: '假期不必安排得太满。',
  平安夜: '平安就好，别的慢慢来。',
  圣诞节: '今天可以收一个小小的礼物。',
  跨年夜: '今年剩下的时间，够好好说再见。',
  母亲节: '给她打个电话，不用挑日子。',
  父亲节: '他大概不会说，但他会等。',
};

const SEASON_COPY = {
  spring: [
    '窗外的树在慢慢醒过来。',
    '风变软了，人也松一点。',
    '适合把没做完的事放一放。',
  ],
  summer: [
    '白天变长了，慢慢来。',
    '热的时候，别为难自己。',
    '冰的东西可以多吃一口。',
  ],
  autumn: [
    '风把叶子吹得有点乱。',
    '天高了一点，心事轻一点。',
    '适合在傍晚多站一会儿。',
  ],
  winter: [
    '今天适合把手揣进口袋。',
    '光很短，屋子可以暖一点。',
    '冷天里，慢一点也没关系。',
  ],
};

function solarTerm(date) {
  const year = date.getFullYear();
  if (year < 2001 || year > 2099) return null;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const y = year % 100;
  for (const [name, m, c] of TERMS) {
    if (m !== month) continue;
    const termDay = Math.floor(y * 0.2422 + c) - Math.trunc((y - 1) / 4);
    if (termDay === day) return name;
  }
  return null;
}

function nthSunday(year, month, n) {
  const first = new Date(year, month - 1, 1);
  const offset = (7 - first.getDay()) % 7;
  return 1 + offset + (n - 1) * 7;
}

function festivalOf(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();

  const fixed = FESTIVALS[`${month}-${day}`];
  if (fixed) return fixed;

  if (month === 5 && day === nthSunday(year, 5, 2)) return '母亲节';
  if (month === 6 && day === nthSunday(year, 6, 3)) return '父亲节';
  return null;
}

function seasonOf(date) {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000);
}

export function almanacFor(now = new Date()) {
  const term = solarTerm(now);
  const festival = festivalOf(now);
  const label = term || festival || '';

  let copy = '';
  if (term && TERM_COPY[term]) copy = TERM_COPY[term];
  else if (festival && FESTIVAL_COPY[festival]) copy = FESTIVAL_COPY[festival];

  if (!copy) {
    const list = SEASON_COPY[seasonOf(now)];
    copy = list[dayOfYear(now) % list.length];
  }

  const dateText = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}`;

  return {
    term,
    festival,
    label,
    copy,
    meta: label ? `${dateText} · ${label}` : dateText,
  };
}

/* Snag 智能引擎
 *
 * 这一层做的事，对应真实产品里"AI 信息处理"的位置：
 * 把杂乱、口语化的原始帖子，变成可排序、可判断、可推荐的结构化信息。
 *
 * 重要说明：
 * 这里全部是确定性的规则与加权公式，不是训练出来的模型，也不调用任何大模型接口。
 * 换成真模型时，替换 signals() / parseQuery() / summary() 三个函数即可，
 * 打分与排序逻辑可以保持不变。
 */

var SnagEngine = (function () {
  'use strict';

  /* 品类需求热度：越多人抢的品类，越容易被秒走。
   * 真实产品里应该用历史领取数据回归出来，这里是人工先验值。 */
  var HEAT = {
    digital: 0.95, furniture: 0.90, appliance: 0.85,
    baby: 0.70, other: 0.45, sport: 0.50, book: 0.35,
  };

  /* ---------- 1. 从原始文本抽取结构化信号 ---------- */
  var RULES = {
    condition: [
      [['九成新', '全新', '没用过', '完好', '未拆'], '几乎全新'],
      [['涂层完好', '功能完好', '正常', '能用', '能跑', '制冷正常', '长势不错'], '功能正常'],
      [['划痕', '磨损', '瑕疵', '有点', '稍', '略', '松', '卡', '弯', '塌', '裂', '凹', '缺'], '有瑕疵'],
      [['八年', '用了三年', '用了两年', '二手'], '成色一般'],
    ],
    urgent: ['今天', '明天', '尽快', '随时可拿', '就要', '周末', '下午'],
    pickupWords: ['需自提', '自提', '自己搬', '自取'],
    heavy: ['重', '两个人', '两人搬', '需自行搬运', '建议带推车', '楼层'],
    bonus: ['附', '送', '赠', '附带', '送护具', '送收纳箱', '送琴包', '送咖啡豆', '送两片'],
  };

  function hit(text, words) {
    for (var i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  function signals(item) {
    var text = item.title + ' ' + item.desc + ' ' + item.pickupNote;
    var tags = [];
    var condition = '成色未说明';
    for (var i = 0; i < RULES.condition.length; i++) {
      if (hit(text, RULES.condition[i][0])) { condition = RULES.condition[i][1]; break; }
    }
    if (condition !== '成色未说明') tags.push(condition);
    var urgent = hit(text, RULES.urgent);
    if (urgent) tags.push('急出');
    var pickup = null;
    if (hit(text, RULES.pickupWords)) { pickup = '需自提'; tags.push('需自提'); }
    var heavy = hit(text, RULES.heavy);
    if (heavy) tags.push('大件需搬运');
    if (hit(text, RULES.bonus)) tags.push('有附赠');
    return { condition: condition, urgent: urgent, pickup: pickup, heavy: heavy, tags: tags.slice(0, 4) };
  }

  /* ---------- 2. 风险识别 ----------
   * 免费赠送是最容易被套路的场景：骗子常用"运费到付""先交押金"骗钱。
   * 真产品该做的就是把这类帖子拦下来或显著标注。 */
  var RISK_DANGER = ['押金', '运费', '邮费', '到付', '手续费', '保证金', '先付款', '先转账', '代付', '激活费', '快递费'];
  var RISK_WARN = ['中介', '代抢', '排队费', '名额费', '加微信详聊'];

  function risk(item) {
    var text = item.title + ' ' + item.desc + ' ' + item.pickupNote;
    var reasons = [];
    RISK_DANGER.forEach(function (w) { if (text.indexOf(w) !== -1) reasons.push('提到「' + w + '」'); });
    if (reasons.length) {
      return {
        level: 'danger', reasons: reasons,
        text: '免费的东西不该先掏钱。出现 ' + reasons.join('、') + '，很可能是套路。',
      };
    }
    RISK_WARN.forEach(function (w) { if (text.indexOf(w) !== -1) reasons.push('提到「' + w + '」'); });
    if (reasons.length) {
      return { level: 'warn', reasons: reasons, text: '信息含 ' + reasons.join('、') + '，建议先问清楚再过去。' };
    }
    return { level: 'none', reasons: [], text: '' };
  }

  /* ---------- 3. 估价与转手收益 ---------- */
  var BASE_VALUE = {
    appliance: 780, furniture: 620, digital: 1100,
    baby: 480, sport: 340, book: 160, other: 190,
  };
  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
    return h;
  }
  function estValue(item) {
    var h = hash(item.id);
    var cond = signals(item).condition;
    var factor = cond === '几乎全新' ? 1.1 : cond === '有瑕疵' ? 0.75 : cond === '成色一般' ? 0.6 : 0.9;
    return Math.round(BASE_VALUE[item.category] * (0.6 + (h % 80) / 100) * factor / 10) * 10;
  }
  function valueRange(item) {
    var v = estValue(item);
    return [Math.round(v * 0.8 / 10) * 10, Math.round(v * 1.3 / 10) * 10];
  }
  function resale(item) {
    return Math.round(estValue(item) * 0.42 / 10) * 10;
  }

  /* ---------- 4. 抢手指数 ---------- */
  function hotScore(item) {
    var v = Math.min(estValue(item) / 1200, 1);
    var d = 1 - Math.min(item.distanceKm / 6, 1);
    var f = 1 - Math.min(item.minutesAgo / 4320, 1);
    var h = HEAT[item.category] || 0.5;
    var u = signals(item).urgent ? 1 : 0.3;
    var jitter = (hash(item.id) % 9) - 4;
    var raw = 100 * (0.26 * v + 0.24 * d + 0.18 * f + 0.18 * h + 0.14 * u) + jitter;
    return Math.max(3, Math.min(99, Math.round(raw)));
  }
  function remainingText(item) {
    var s = hotScore(item);
    if (s >= 78) return '预计 1 小时内被领走';
    if (s >= 64) return '预计 3 小时内被领走';
    if (s >= 50) return '预计今天内被领走';
    if (s >= 34) return '大概还能放一两天';
    return '大概率还没人要';
  }
  function likelyGone(item) {
    return item.minutesAgo > 2880 && hotScore(item) > 55;
  }
  function wantedCount(item) {
    return (item.wantBase || 0) + Math.floor(hotScore(item) / 22);
  }

  /* ---------- 5. 一句话总结 ---------- */
  function summary(item) {
    var sg = signals(item);
    var bits = [];
    bits.push(Math.round(item.distanceKm * 100) / 100 + ' km 外');
    bits.push(sg.condition === '成色未说明' ? item.title : sg.condition + '的' + item.title);
    if (sg.urgent) bits.push('对方急着出');
    if (sg.heavy) bits.push('大件要自己搬');
    if (sg.pickup) bits.push('需自提');
    return bits.join('，') + '，估值约 ¥' + estValue(item) + '。';
  }

  /* ---------- 6. 自然语言搜索 ---------- */
  var INTENTS = [
    { keys: ['宝宝', '婴儿', '小孩', '孩子', '娃', '孕妇', '带娃', '新生儿'], cats: ['baby'], label: '母婴用品' },
    { keys: ['搬家', '新家', '布置', '租房', '刚毕业', '安家', '家具'], cats: ['furniture', 'appliance'], label: '安家大件' },
    { keys: ['书房', '办公', '电脑', '显示器', '在家办公', '学习'], cats: ['digital', 'furniture'], label: '办公与数码' },
    { keys: ['锻炼', '运动', '健身', '跑步', '露营', '户外'], cats: ['sport'], label: '运动户外' },
    { keys: ['看书', '书', '绘本', '考研', '阅读', '教材'], cats: ['book'], label: '书籍' },
    { keys: ['厨房', '做饭', '烹饪', '烘焙', '家电'], cats: ['appliance'], label: '厨房家电' },
  ];

  function parseQuery(q, districts) {
    q = (q || '').trim();
    var res = { cats: null, district: null, maxDist: null, freshOnly: false, condNew: false, kw: q.toLowerCase(), label: null };
    if (!q) return res;
    for (var i = 0; i < INTENTS.length; i++) {
      if (hit(q, INTENTS[i].keys)) { res.cats = INTENTS[i].cats; res.label = INTENTS[i].label; break; }
    }
    if (res.cats) res.kw = '';
    if (districts) {
      for (var j = 0; j < districts.length; j++) {
        if (q.indexOf(districts[j]) !== -1) { res.district = districts[j]; break; }
      }
      if (res.district) res.kw = '';
    }
    if (hit(q, ['近', '走路', '楼下', '附近', '门口'])) res.maxDist = 1;
    if (hit(q, ['急', '今天', '现在', '刚刚', '新鲜', '最新'])) res.freshOnly = true;
    if (hit(q, ['几乎全新', '九成新', '全新'])) res.condNew = true;
    return res;
  }

  /* ---------- 7. 个性化推荐 ---------- */
  function recommendScore(item, prefs) {
    var w = (prefs && prefs[item.category]) || 0;
    if (w <= 0) return -1;
    var f = 1 - Math.min(item.minutesAgo / 4320, 1);
    var d = 1 - Math.min(item.distanceKm / 6, 1);
    return w * (0.45 + 0.3 * f + 0.25 * d) + hotScore(item) / 100;
  }
  function recommend(items, prefs, limit, excludeIds) {
    return items
      .filter(function (it) { return !excludeIds || excludeIds.indexOf(it.id) === -1; })
      .map(function (it) { return { it: it, s: recommendScore(it, prefs) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, limit)
      .map(function (x) { return x.it; });
  }

  /* ---------- 8. 相似推荐 ---------- */
  function similar(item, items, n) {
    return items
      .filter(function (it) {
        return it.id !== item.id && !likelyGone(it) &&
          (it.category === item.category || Math.abs(estValue(it) - estValue(item)) < 260);
      })
      .map(function (it) {
        var sameCat = it.category === item.category ? 30 : 0;
        var s = sameCat + hotScore(it) * 0.4 + (6 - Math.min(it.distanceKm, 6)) * 6;
        return { it: it, s: s };
      })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, n)
      .map(function (x) { return x.it; });
  }

  /* ---------- 9. 场景搭配 ---------- */
  var SCENES = {
    study: { label: '0 元布置书房', need: ['furniture', 'digital', 'book', 'other'] },
    nursery: { label: '0 元布置宝宝房', need: ['baby', 'furniture', 'book', 'other'] },
    kitchen: { label: '0 元补齐厨房', need: ['appliance', 'furniture', 'other'] },
    living: { label: '0 元布置客厅', need: ['furniture', 'appliance', 'digital', 'other'] },
    gym: { label: '0 元搞个运动角', need: ['sport', 'other', 'furniture'] },
  };
  function bundle(items, sceneKey) {
    var scene = SCENES[sceneKey];
    if (!scene) return null;
    var picked = [];
    var used = {};
    scene.need.forEach(function (cat) {
      var pool = items.filter(function (it) {
        return it.category === cat && !used[it.id] && !likelyGone(it) && risk(it).level !== 'danger';
      });
      if (!pool.length) return;
      pool.sort(function (a, b) {
        return (hotScore(b) * 0.6 + (6 - Math.min(b.distanceKm, 6)) * 7) -
               (hotScore(a) * 0.6 + (6 - Math.min(a.distanceKm, 6)) * 7);
      });
      picked.push(pool[0]);
      used[pool[0].id] = true;
    });
    var total = picked.reduce(function (a, it) { return a + estValue(it); }, 0);
    return { label: scene.label, items: picked, total: total };
  }

  /* ---------- 10. 顺路路线 ---------- */
  function distKm(a, b) {
    var R = 6371;
    var dLat = ((b.lat - a.lat) * Math.PI) / 180;
    var dLon = ((b.lon - a.lon) * Math.PI) / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function route(items, center) {
    if (!items.length) return { order: [], totalKm: 0 };
    var remain = items.slice();
    var order = [];
    var cur = { lat: center.lat, lon: center.lon };
    var total = 0;
    while (remain.length) {
      var bestIdx = 0, bestD = Infinity;
      for (var i = 0; i < remain.length; i++) {
        var d = distKm(cur, remain[i]);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      total += bestD;
      cur = remain[bestIdx];
      order.push(remain[bestIdx]);
      remain.splice(bestIdx, 1);
    }
    total += distKm(cur, center);
    return { order: order, totalKm: total };
  }

  return {
    HEAT: HEAT, SCENES: SCENES,
    signals: signals, risk: risk, summary: summary,
    estValue: estValue, valueRange: valueRange, resale: resale,
    hotScore: hotScore, remainingText: remainingText, likelyGone: likelyGone,
    wantedCount: wantedCount, parseQuery: parseQuery,
    recommendScore: recommendScore, recommend: recommend,
    similar: similar, bundle: bundle, route: route, distKm: distKm,
  };
})();

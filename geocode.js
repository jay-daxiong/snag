/* geocode.js — 在线逆地理编码（区/县级精准升级层）
 *
 * 定位采用「双保险」：
 *   1) 离线层（data.applyLocation + regions.js）：345 个地级市最近邻匹配，
 *      断网也永远精准到「省·市」，是保底。
 *   2) 在线层（本文件）：调用 BigDataCloud / Nominatim 反向地理编码，
 *      把「区/县」补齐，使一键定位在全国范围精准到县。
 *      浏览器需联网；离线或接口不可达时本层自动跳过，退回离线结果。
 *
 * 不依赖任何框架，纯 fetch；无 API Key（BigDataCloud client 端点与 Nominatim 均可匿名调用）。
 */
(function () {
  // 地名中常见的繁体 -> 简体映射（BigDataCloud 的中文数据偶用繁体，如「東城區」）
  var TRAD = {
    '東': '东', '區': '区', '臺': '台', '裡': '里', '廣': '广', '場': '场', '縣': '县',
    '鎮': '镇', '門': '门', '陽': '阳', '華': '华', '興': '兴', '豐': '丰', '峯': '峰',
    '塗': '涂', '園': '园', '師': '师', '會': '会', '烏': '乌', '龍': '龙', '鳳': '凤',
    '寧': '宁', '實': '实', '慶': '庆', '應': '应', '廈': '厦', '樂': '乐', '餘': '余',
    '蘭': '兰', '關': '关', '衛': '卫', '頭': '头', '遠': '远', '靜': '静', '顯': '显',
    '萬': '万', '發': '发', '來': '来', '國': '国', '圖': '图', '蓋': '盖', '盧': '卢',
    '勝': '胜', '監': '监', '當': '当', '黨': '党', '終': '终', '處': '处', '備': '备',
    '復': '复', '劃': '划', '劉': '刘', '壽': '寿', '舊': '旧', '蘇': '苏', '順': '顺',
    '義': '义', '書': '书', '親': '亲', '語': '语', '讓': '让', '說': '说', '話': '话',
    '許': '许', '詩': '诗', '農': '农', '銀': '银', '銅': '铜', '鐵': '铁', '錢': '钱',
    '針': '针', '鐘': '钟', '間': '间', '開': '开', '閉': '闭', '陝': '陕', '雲': '云',
    '電': '电', '飛': '飞', '飯': '饭', '館': '馆', '魚': '鱼', '鳥': '鸟', '馬': '马',
    '驗': '验', '驛': '驿', '髙': '高', '島': '岛', '嶼': '屿', '廟': '庙', '橋': '桥',
    '黃': '黄', '鄉': '乡', '後': '后', '幾': '几', '莊': '庄', '賴': '赖', '連': '连',
    '進': '进', '達': '达', '邊': '边', '體': '体', '學': '学', '覺': '觉', '觀': '观',
    '織': '织', '統': '统', '綠': '绿', '總': '总', '網': '网', '羅': '罗', '職': '职',
    '聯': '联', '創': '创', '辦': '办', '務': '务', '動': '动', '勞': '劳', '勢': '势',
    '倫': '伦', '幣': '币', '巖': '岩', '堯': '尧', '樑': '梁', '淵': '渊', '濱': '滨',
    '灣': '湾', '環': '环', '璉': '琏', '瑩': '莹', '瓊': '琼', '畫': '画', '硯': '砚',
    '碩': '硕', '穎': '颖', '繡': '绣', '纜': '缆', '聲': '声', '臨': '临', '薦': '荐',
    '蟲': '虫', '襲': '袭', '覽': '览', '譽': '誉', '讀': '读', '變': '变', '貓': '猫',
    '輝': '辉', '遼': '辽', '鄭': '郑', '醫': '医', '鑄': '铸', '際': '际', '隴': '陇',
    '韻': '韵', '顏': '颜', '類': '类', '點': '点', '麗': '丽'
  };
  function toSimple(s) {
    if (!s) return s;
    var re = new RegExp('[' + Object.keys(TRAD).join('') + ']', 'g');
    return String(s).replace(re, function (c) { return TRAD[c] || c; });
  }

  // 直辖市 / 同名市：locality 可能与 city 同名，视为无独立县级名
  function baseName(s) { return (s || '').replace(/(市|区|县|自治州|盟|地区|特别行政区)$/, ''); }

  function parseBDC(j) {
    if (!j) return null;
    var prov = toSimple(j.principalSubdivision || '');
    var city = toSimple(j.city || '');
    var county = toSimple(j.locality || '');
    if (county && baseName(county) === baseName(city)) county = '';
    return { province: prov, city: city, county: county, source: 'bigdatacloud' };
  }

  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) { if (obj[keys[i]]) return obj[keys[i]]; }
    return '';
  }
  function parseNominatim(j) {
    if (!j || !j.address) return null;
    var a = j.address;
    var prov = toSimple(pick(a, ['state', 'province']));
    var city = toSimple(pick(a, ['city', 'municipality', 'county']));
    var county = toSimple(pick(a, ['county', 'district', 'borough', 'city_district', 'town', 'suburb']));
    if (baseName(county) === baseName(city)) county = '';
    return { province: prov, city: city, county: county, source: 'nominatim' };
  }

  function fetchJSON(url, ms) {
    if (typeof fetch === 'undefined') return Promise.resolve(null);
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 6000);
    return fetch(url, {
      signal: ctrl ? ctrl.signal : undefined,
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { clearTimeout(timer); return j; })
      .catch(function () { clearTimeout(timer); return null; });
  }

  // 主入口：先 BigDataCloud（免 Key、CORS *），失败/无县再 Nominatim 兜底
  function reverseGeocodeOnline(lat, lon) {
    if (typeof fetch === 'undefined') return Promise.resolve(null);
    var bdc = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
      lat + '&longitude=' + lon + '&localityLanguage=zh';
    return fetchJSON(bdc, 6000).then(function (j) {
      var r = parseBDC(j);
      if (r && r.county) return r;
      var nom = 'https://nominatim.openstreetmap.org/reverse?lat=' + lat +
        '&lon=' + lon + '&format=json&accept-language=zh-CN&zoom=10';
      return fetchJSON(nom, 6000).then(function (nj) { return parseNominatim(nj) || r; });
    });
  }

  if (typeof window !== 'undefined') {
    window.reverseGeocodeOnline = reverseGeocodeOnline;
    window.__geo = { parseBDC: parseBDC, parseNominatim: parseNominatim, toSimple: toSimple };
  }
})();

/* Snag 原型 · 数据层（全国城市，定位驱动）
 *
 * 定位能力来自 regions.js（window.REGION_HELPERS）：34 省 / 345 个地级市 / 区县。
 * 这里把 REGION_HELPERS 的城市重建为 CITIES（以城市编码为键），让上层逻辑
 * 仍然用 CITIES[code].name / .center / .districts 访问，最小改动即可支持全国。
 *
 * 说明：物品数据是本地按种子生成的演示数据，模拟「抓取并清洗后」的结果。
 * 真实产品里，物品应来自后端抓取管道，按城市编码检索。
 */

var RH = (typeof window !== 'undefined' && window.REGION_HELPERS) || null;

// 兼容直跑（无 regions.js 时）的内置兜底坐标
var FALLBACK = {
  provinces: [{ code: 31, name: '上海', lat: 31.23, lon: 121.47 }],
  cities: [{ code: 3101, name: '上海', provinceCode: 31, lat: 31.23, lon: 121.47 }],
  counties: { 3101: [{ name: '黄浦区', lat: 31.23, lon: 121.47 }] },
  pmap: {}, cmap: {},
  provinceOf: function (c) { return this.provinces[0]; },
  cityOf: function (c) { return this.cities[0]; },
  countiesOf: function () { return [{ name: '市辖区' }]; },
  reverseGeocode: function () { return { province: FALLBACK.provinces[0], city: FALLBACK.cities[0], county: null, accuracy: '就近归属' }; }
};
if (RH) { RH.pmap = {}; RH.cmap = {}; RH.provinces.forEach(function (p) { RH.pmap[p.code] = p; }); RH.cities.forEach(function (c) { RH.cmap[c.code] = c; }); }
var R = RH || FALLBACK;

var CATEGORIES = {
  furniture: { label: '家具', color: '#8B6F4E', tone: '#EFE7DC' },
  appliance: { label: '家电', color: '#3D7EA6', tone: '#E3EEF5' },
  digital:   { label: '数码', color: '#4C4C7A', tone: '#E8E8F2' },
  baby:      { label: '母婴', color: '#B5698A', tone: '#F7E6EE' },
  sport:     { label: '运动', color: '#3F7A5E', tone: '#E4F0EB' },
  book:      { label: '书籍', color: '#A06A38', tone: '#F3E9DC' },
  other:     { label: '其他', color: '#6B6B6B', tone: '#ECECEC' },
};

// 演示用的信息源渠道，对应真实产品的抓取管道
var SOURCES = ['闲鱼免费送', '业主微信群', '小区公告栏', '58 同城', '豆瓣小组', '本地生活群'];

var RAW_ITEMS = [
  ['宜家白色书桌 120cm', 'furniture', '桌面有几处划痕，不影响使用。孩子在上面画画了。', '搬家带不走，今天下午在家'],
  ['实木书架 五层', 'furniture', '用了三年，板材结实，背面有一小块受潮。', '需要自己搬下三楼'],
  ['双门小冰箱', 'appliance', '制冷正常，就是噪音稍大一点。', '楼下自提，电梯房'],
  ['美的微波炉', 'appliance', '功能完好，转盘齐全，附带说明书。', '随时可拿'],
  ['小天鹅洗衣机 8kg', 'appliance', '八年机龄，脱水时震动明显，能用。', '需自行搬运，建议带推车'],
  ['落地灯 + 灯罩', 'furniture', '灯泡是暖光的，附赠备用灯泡两个。', '上午到晚上都在家'],
  ['皮质三人沙发', 'furniture', '边角有磨损，坐感偏软，家里猫抓过。', '必须今天搬走，明天扔了'],
  ['折叠躺椅 x2', 'other', '露营用过两次，有一把网面松了。', '小区门口交接'],
  ['L 型电脑桌', 'furniture', '带线槽和理线孔，拆成两块方便搬运。', '工作日晚上可约'],
  ['厨房置物架 三层', 'furniture', '不锈钢材质，有一层变形。', '随时'],
  ['儿童自行车 16寸', 'sport', '孩子长高了骑不了，车身有划痕。', '送护具一套'],
  ['瑜伽垫 + 哑铃一对', 'sport', '哑铃各 5kg，橡胶味基本散了。', '自提'],
  ['家用跑步机', 'sport', '能跑，速度档有点卡，跑带略偏。', '重物，需要两个人搬'],
  ['帐篷 + 防潮垫', 'sport', '用过三次，配件齐全，有一根地钉弯了。', '周末在家'],
  ['轮滑鞋 38 码', 'sport', '孩子穿了一季，轮子磨损均匀。', '随时'],
  ['婴儿床（可拆护栏）', 'baby', '实木材质，附床垫，无异味。', '已消毒，需要自提'],
  ['儿童餐椅', 'baby', '餐盘可拆洗，安全带完好。', '随时'],
  ['婴儿推车（可折叠）', 'baby', '推起来顺滑，遮阳棚有点塌。', '自提'],
  ['积木套装 500 粒', 'baby', '缺了几块，其余都在收纳箱里。', '送收纳箱'],
  ['27 寸显示器', 'digital', '无坏点，HDMI 和 DP 口都正常，附电源线。', '当面可试'],
  ['惠普打印机', 'digital', '机器正常，墨盒快干了当送。', '自提'],
  ['机械键盘 87 键', 'digital', '青轴，有几个键帽松动。', '需自提，快递我出'],
  ['二手吉他（入门款）', 'other', '琴弦是新的，音准没问题。', '送琴包'],
  ['全套幼儿绘本 40 本', 'book', '有些涂鸦，大部分干净。', '一次性全拿走'],
  ['考研教材一堆', 'book', '公共课全套，里面没有笔记。', '自提，重量不小'],
  ['电饭煲 3L', 'appliance', '内胆涂层完好，蒸格齐全。', '随时'],
  ['烤箱 32L', 'appliance', '上下管都热，门封有点松。', '需自提'],
  ['破壁机', 'appliance', '打豆浆没问题，说明书丢了一半。', '工作日晚上'],
  ['咖啡机（半自动）', 'appliance', '能出压力，蒸汽棒有点堵。', '送咖啡豆半包'],
  ['落地电风扇', 'appliance', '三档正常，摇头卡顿需要手动拨。', '随时'],
  ['有线吸尘器', 'appliance', '吸力正常，管道有个小裂缝。', '自提'],
  ['地毯 2x3m', 'furniture', '边角起翘，中间干净。', '建议自带袋子'],
  ['龟背竹 + 花盆 x3', 'other', '长势不错，有一盆土里长虫已处理。', '阳台自取'],
  ['猫爬架', 'other', '猫不用了，麻绳有抓痕但不散。', '下午在家'],
  ['电视 55 寸', 'digital', '屏幕无划痕，遥控器按键迟钝。', '重物，需两人搬'],
  ['书架音响一对', 'digital', '音质正常，有一只网罩凹了。', '随时'],
  ['榨汁杯', 'appliance', '刀头正常，杯身有一道裂纹。', '送就送了'],
  ['瓷砖余料 2 平方', 'other', '装修剩下的，同批次。', '有缘物理工自取'],
  ['乳胶漆半桶', 'other', '白色，剩一半多，保质期到明年。', '随时'],
  ['宜家餐椅 x4', 'furniture', '有一把摇晃不稳，其余完好。', '整套送，不拆'],
  ['书桌台灯 LED', 'furniture', '三档调光，USB 供电。', '随时'],
  ['镜面衣柜两开门', 'furniture', '镜子完好，柜门合页有一个松。', '需要自己拆搬'],
  ['儿童安全座椅', 'baby', '用了两年，未出过事故。', '当面看货'],
  ['桌上足球台', 'sport', '小球少两个，其余配件在。', '很重，楼层带电梯'],
  ['电竞椅', 'furniture', '气压杆下沉，需要调最高才舒服。', '自提'],
  ['小学课外书一箱', 'book', '三到六年级，童话科普都有。', '一次性带走'],
  ['空气净化器', 'appliance', '滤芯要换了，机器本身正常。', '送两片新滤芯'],
  ['运动水壶 + 背包', 'sport', '背包拉链有点卡，水壶全新。', '随时'],
  ['书桌 + 椅子套装', 'furniture', '孩子升学换掉了，一套出。', '下午三点后在家'],
];

// 把 REGION_HELPERS 的城市重建为 CITIES（以编码为键），并补 districts（区县名）
var CITIES = {};
R.cities.forEach(function (c) {
  var counties = R.countiesOf(c.code);
  CITIES[c.code] = {
    code: c.code,
    name: c.name,
    provinceCode: c.provinceCode,
    center: { lat: c.lat, lon: c.lon },
    districts: counties.map(function (x) { return x.name; }),
  };
});

// 热门城市（快速切换用），其余可在级联选择器中选
var HOT_CITIES = [
  3101, 1101, 4401, 4403, 3301, 5101, 4201, 3201, 4301, 6101,
  3701, 4406, 3205, 3501, 3502, 1201, 5001, 2301, 4201, 3301
];
// 去重
HOT_CITIES = HOT_CITIES.filter(function (v, i) { return HOT_CITIES.indexOf(v) === i; });

function makeRandom(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function haversineKm(lat1, lon1, lat2, lon2) {
  var R0 = 6371;
  var dLat = ((lat2 - lat1) * Math.PI) / 180;
  var dLon = ((lon2 - lon1) * Math.PI) / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R0 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function seedOf(code) {
  var s = 20261021;
  var str = String(code);
  for (var i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) % 99991;
  return s;
}

var STREETS = ['人民路', '建国路', '文化街', '和平路', '光明路', '长江道', '幸福里', '学院路', '兴业街', '康平路', '中山路', '解放大道'];

var _cache = {};
function itemsOf(code) {
  if (_cache[code]) return _cache[code];
  var city = CITIES[code] || CITIES[3101];
  var rand = makeRandom(seedOf(code));
  var districts = city.districts.length ? city.districts : ['市辖区'];
  var out = RAW_ITEMS.map(function (row, i) {
    var angle = rand() * Math.PI * 2;
    var radius = 0.004 + Math.sqrt(rand()) * 0.030;
    var lat = city.center.lat + Math.sin(angle) * radius;
    var lon = city.center.lon + Math.cos(angle) * radius * 1.28;
    return {
      id: code + '-it' + (i + 1),
      city: code,
      cityName: city.name,
      title: row[0],
      category: row[1],
      desc: row[2],
      pickupNote: row[3],
      source: SOURCES[Math.floor(rand() * SOURCES.length)],
      district: districts[Math.floor(rand() * districts.length)],
      address: STREETS[Math.floor(rand() * STREETS.length)] + Math.floor(10 + rand() * 900) + ' 弄',
      lat: lat,
      lon: lon,
      minutesAgo: Math.floor(2 + rand() * 4300),
      wantBase: Math.floor(rand() * 7),
      viewsBase: Math.floor(20 + rand() * 400),
      tokens: (row[0] + ' ' + row[2] + ' ' + row[3]).toLowerCase(),
    };
  });
  out.forEach(function (it) {
    it.distanceKm = haversineKm(city.center.lat, city.center.lon, it.lat, it.lon);
  });
  _cache[code] = out;
  return out;
}

// 一键定位：经纬度 -> 最近地级市（全国 345 城），精准到市；有区县坐标则下钻到区县
function applyLocation(lat, lon) {
  var g = R.reverseGeocode(lat, lon);
  return {
    cityKey: g.city.code,
    city: { code: g.city.code, name: g.city.name, center: { lat: g.city.lat, lon: g.city.lon } },
    province: g.province ? g.province.name : '',
    county: g.county ? g.county.name : null,
    accuracy: g.accuracy,
    cityDistanceKm: g.cityDistanceKm,
  };
}

// 按城市编码加载（无 GPS 时，原点取城市中心）
function loadCityByCode(code) {
  var c = CITIES[code] || CITIES[3101];
  return { cityKey: c.code, city: c, items: itemsOf(c.code) };
}

// 兼容旧接口命名
function districtsOf(code) { return (CITIES[code] || CITIES[3101]).districts; }

if (typeof window !== 'undefined') {
  window.CITIES = CITIES;
  window.HOT_CITIES = HOT_CITIES;
  window.CATEGORIES = CATEGORIES;
  window.SOURCES = SOURCES;
  window.RAW_ITEMS = RAW_ITEMS;
  window.ITEMS = itemsOf('3101');
  window.CITY = CITIES['3101'];
  window.applyLocation = applyLocation;
  window.itemsOf = itemsOf;
  window.REGION_API = R; // 暴露区域工具
}

/* 烘焙全国全量区/县坐标到 regions.js（离线也能精准到县）
 *
 * 数据来源：阿里 DataV.GeoAtlas 公开行政区划接口（含每级行政中心的 center 坐标）
 *   https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json
 * 该接口在沙箱内可达，且返回的每个区/县都带 center:[lng,lat]，正好用于
 * 「最近邻逆向地理编码」离线精准到县。
 *
 * 处理：
 *  - 复用现有 regions.js 里已经校验过的 34 省 / 345 地级市（坐标可靠）。
 *  - 对每个地级市，按 adcode 抓取其下属区/县：
 *      · 普通地级市：code*100（如 4401 -> 440100）
 *      · 直辖市 / 港澳台：省级 _full（如 1101 -> 110000）直接含 district
 *  - 抓取失败的市回退 ['市辖区']。
 *
 * 运行： node bake_regions.js   （需要外网可访问 DataV；失败则保留现有 regions.js）
 */

const fs = require('fs');
const https = require('https');
const vm = require('vm');

// 1) 载入现有 regions.js 的省/市（不改动这部分，只补全 counties）
const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
vm.runInNewContext(fs.readFileSync(__dirname + '/regions.js', 'utf8'), sandbox);
const R = sandbox.window.REGIONS;
if (!R || !R.cities) { console.error('regions.js 结构异常，已中止'); process.exit(1); }
const provinces = R.provinces;
const cities = R.cities;

// 直辖市 / 港澳台：它们的"下级"行政中心在省级 _full 里（level=district）
const SPECIAL_PREFIX = [11, 12, 31, 50, 71, 81, 82];
function datavAdcode(code) {
  const pre = Math.floor(code / 100);
  return SPECIAL_PREFIX.indexOf(pre) >= 0 ? pre * 10000 : code * 100;
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000 }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode + ' ' + url)); }
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('parse ' + url + ' ' + e.message)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
  });
}

async function getFeatures(adc) {
  try {
    const j = await getJSON('https://geo.datav.aliyun.com/areas_v3/bound/' + adc + '_full.json');
    return j.features || [];
  } catch (e) {
    return null;
  }
}

async function fetchCounties(city) {
  const adc = datavAdcode(city.code);
  let feats = await getFeatures(adc);
  // 省直辖县级市（仙桃/神农架/济源/阿克苏…）不在市级 _full，而在省级 _full 里
  if (!feats || !feats.length) {
    const provAdc = Math.floor(city.code / 100) * 10000;
    const pf = await getFeatures(provAdc);
    if (pf && pf.length) {
      feats = pf.filter((f) => f.properties && String(f.properties.adcode).indexOf(String(city.code)) === 0);
    }
  }
  const ds = (feats || [])
    .filter((f) => {
      const p = f.properties;
      if (!p || !p.center || !p.name) return false;
      const adc = String(p.adcode);
      // 区(district) 或 县级市(city 但 adcode 是 6 位，区别于 4 位的地级市/地区)
      return p.level === 'district' || (p.level === 'city' && adc.length === 6);
    })
    .map((f) => ({ name: f.properties.name, lat: +f.properties.center[1], lon: +f.properties.center[0] }));
  if (ds.length) return ds;
  if (!feats) process.stderr.write('  [warn] ' + city.code + ' ' + city.name + ' 两级抓取均失败，回退市辖区\n');
  return [{ name: '市辖区', lat: city.lat, lon: city.lon }];
}

(async () => {
  const counties = {};
  let done = 0;
  const N = cities.length;
  const CONC = 24;
  let i = 0;
  async function worker() {
    while (i < N) {
      const idx = i++;
      const city = cities[idx];
      counties[city.code] = await fetchCounties(city);
      done++;
      if (done % 40 === 0) process.stdout.write('  进度 ' + done + '/' + N + '\n');
    }
  }
  const workers = [];
  for (let k = 0; k < CONC; k++) workers.push(worker());
  await Promise.all(workers);

  // 写回 regions.js（与 gen_regions.js 输出结构完全一致）
  const out =
    '/* 自动生成，请勿手改。来源 bake_regions.js（DataV 全量区县 + gen_regions 省市）。*/\n' +
    'window.REGIONS = ' + JSON.stringify({ provinces, cities, counties }) + ';\n' +
    'window.REGION_HELPERS = (function(){\n' +
    '  function haversineKm(a,b,c,d){var R=6371,p=Math.PI/180,dl=(c-a)*p,dn=(d-b)*p;var e=Math.sin(dl/2)*Math.sin(dl/2)+Math.cos(a*p)*Math.cos(c*p)*Math.sin(dn/2)*Math.sin(dn/2);return R*2*Math.atan2(Math.sqrt(e),Math.sqrt(1-e));}\n' +
    '  var P=window.REGIONS.provinces,C=window.REGIONS.cities,K=window.REGIONS.counties;\n' +
    '  var pmap={},cmap={};P.forEach(function(x){pmap[x.code]=x});C.forEach(function(x){cmap[x.code]=x});\n' +
    '  return {\n' +
    '    provinces:P, cities:C, counties:K, pmap:pmap, cmap:cmap,\n' +
    '    provinceOf:function(cc){return pmap[cc];},\n' +
    '    cityOf:function(cc){return cmap[cc];},\n' +
    '    countiesOf:function(cityCode){return K[cityCode]||[{name:"市辖区"}];},\n' +
    '    reverseGeocode:function(lat,lon){var bc=null,bd=1/0;C.forEach(function(c){var d=haversineKm(lat,lon,c.lat,c.lon);if(d<bd){bd=d;bc=c;}});var co=null,cd=1/0,cc=null;Object.keys(K).forEach(function(ck){(K[ck]||[]).forEach(function(x){var d=haversineKm(lat,lon,x.lat,x.lon);if(d<cd){cd=d;co=x;cc=Number(ck);}});});var useCo=(co&&cd<=80)?co:null;var city=useCo?cmap[cc]:bc;var prov=city?pmap[city.provinceCode]:null;return{province:prov,city:city,county:useCo?{name:useCo.name,lat:useCo.lat,lon:useCo.lon}:null,cityDistanceKm:bd,accuracy:bd<60?(useCo?"区县级精准":"市级精准"):"就近归属最近地级市"};},\n' +
    '    haversineKm:haversineKm\n' +
    '  };\n' +
    '})();\n';

  fs.writeFileSync(__dirname + '/regions.js', out);

  let totalCounties = 0, realCities = 0;
  Object.keys(counties).forEach((k) => {
    if (counties[k].some((x) => x.name !== '市辖区')) realCities++;
    totalCounties += counties[k].length;
  });
  console.log('regions.js 已重写：省份 ' + provinces.length + '，地级市 ' + cities.length +
    '，含真实区县的城市 ' + realCities + '，区县总条数 ' + totalCounties);
})();

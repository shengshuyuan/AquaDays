/* Shared by the interactive preview and Node checks; no browser APIs. */
(function (root) {
  'use strict';
  const catalog = [
    { id: 'ryukin', name: '琉金', trait: '高背 · 飘尾', color: 'orange' },
    { id: 'ranchu', name: '兰寿', trait: '圆背 · 无背鳍', color: 'white' },
    { id: 'oranda', name: '鹤顶红', trait: '红帽 · 有背鳍', color: 'white' },
    { id: 'moor', name: '黑龙睛', trait: '墨色 · 龙睛', color: 'black' },
    { id: 'pearlscale', name: '珍珠鳞', trait: '圆身 · 珠鳞', color: 'pearl' },
    { id: 'shubunkin', name: '朱文金', trait: '五花 · 单尾', color: 'calico' },
    { id: 'guppy', name: '孔雀鱼', trait: '小身 · 扇尾', color: 'blue' },
    { id: 'crab', name: '螃蟹', trait: '缸底 · 横行', color: 'brown', bottom: true },
  ];
  const MAX_FISH = 8, DAILY_FOOD = 2, GROWTH = 24;
  function isDaytime(hour) { return hour >= 7 && hour < 18; }
  function validDay(day) {
    return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
      && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  }
  function fish(id, kind, adult = false) {
    return { id, kind, adult, growth: adult ? GROWTH : 0, x: [64,155,73,172,119,180,100,145][id],
      y: catalog[kind].bottom ? 249 : [135,145,191,202,226,174,160,180][id], vx: 0, vy: 0, direction: id % 2 ? -1 : 1,
      tx: 50 + (id * 42) % 140, ty: catalog[kind].bottom ? 249 : 177 - id * 8, nextTurn: 3 + id, pauseUntil: 0 };
  }
  function create(day) {
    if (!validDay(day)) throw new Error('Expected a valid YYYY-MM-DD date');
    return { day, fed: 0, water: 68, careDays: 0, stamped: false, selected: 0,
      mode: 'home', choice: 0, adultChoice: false, lane: 0, age: 0, seed: 1179,
      message: '', messageUntil: 0, pellets: [], fish: [fish(0, 0, true), fish(1, 2, true), fish(2, 1), fish(3, 3), fish(4, 5), fish(5, 6, true), fish(6, 7, true)],
      dirt: Array.from({ length: 9 }, (_, i) => ({ lane: Math.floor(i / 3), clean: false })) };
  }
  function note(s, text) { s.message = text; s.messageUntil = s.age + 3; }
  function reward(s) {
    if (!s.stamped && s.fed > 0 && s.water >= 90) {
      s.stamped = true; s.careDays++; note(s, '今日照料完成！');
    }
  }
  function nextDay(s, day) {
    if (!validDay(day)) throw new Error('Invalid calendar date');
    // shortcut: preview state is in memory; firmware must persist date and quotas in NVS.
    if (day <= s.day) return false;
    const elapsed = (Date.parse(day) - Date.parse(s.day)) / 86400000;
    s.day = day; s.fed = 0; s.stamped = false; s.pellets = [];
    s.water = Math.max(20, s.water - Math.min(elapsed, 10) * 8);
    s.dirt.forEach(d => { d.clean = false; }); s.mode = 'home';
    note(s, '新的一天，看看鱼儿'); return true;
  }
  function press(s, key) {
    if (!['up', 'down', 'ok', 'back'].includes(key)) return;
    if (key === 'back') { s.mode = 'home'; return; }
    const delta = key === 'up' ? -1 : 1;
    if (s.mode === 'home') {
      if (key !== 'ok') { s.selected = (s.selected + delta + 3) % 3; return; }
      if (s.selected === 0) {
        if (s.fed >= DAILY_FOOD) { note(s, '今天吃饱啦，明天再喂'); return; }
        if (s.pellets.length) { note(s, '等鱼儿吃完这一份'); return; }
        s.fed++; s.water = Math.max(0, s.water - 3);
        s.pellets = Array.from({ length: s.fish.length * 2 }, (_, i) =>
          ({ x: 45 + (i * 29) % 150, y: 30 - i * 5, target: i % s.fish.length }));
        note(s, '开饭啦！'); reward(s);
      } else if (s.selected === 1) {
        if (s.water >= 99.9) { note(s, '鱼缸已经很干净啦'); return; }
        s.mode = 'clean'; s.cleanBase = s.water;
        const count = s.dirt.filter(d => !d.clean).length;
        s.cleanStep = count ? (100 - s.water) / count : 0;
        if (!count) { s.dirt.forEach(d => { d.clean = false; }); s.cleanStep = (100 - s.water) / 9; }
      } else { s.mode = 'select'; s.choice = 0; }
    } else if (s.mode === 'select') {
      if (key !== 'ok') s.choice = (s.choice + delta + catalog.length) % catalog.length;
      else if (s.fish.length >= MAX_FISH) note(s, '鱼缸满啦，先照料它们');
      else { s.mode = 'size'; s.adultChoice = false; }
    } else if (s.mode === 'size') {
      if (key !== 'ok') s.adultChoice = !s.adultChoice;
      else {
        if (s.fish.length >= MAX_FISH) { note(s, '鱼缸满啦'); return; }
        const f = fish(s.fish.length, s.choice, s.adultChoice);
        f.x = 125; f.y = catalog[f.kind].bottom ? 249 : 190; s.fish.push(f); s.mode = 'home'; note(s, '新朋友入住啦！');
      }
    } else if (s.mode === 'clean') {
      if (key !== 'ok') { s.lane = (s.lane + delta + 3) % 3; return; }
      const dirty = s.dirt.find(d => d.lane === s.lane && !d.clean);
      if (dirty) {
        dirty.clean = true; s.water = Math.min(100, s.water + s.cleanStep);
        if (s.dirt.every(d => d.clean)) { s.water = 100; note(s, '擦干净啦！长按确定返回'); reward(s); }
      } else note(s, '这一区很干净，换一区吧');
    }
  }
  function random(s) {
    s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
    return s.seed / 4294967296;
  }
  function update(s, dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.25); s.age += dt;
    for (const p of s.pellets) p.y = Math.min(catalog[s.fish[p.target].kind].bottom ? 249 : 226, p.y + 28 * dt);
    for (const f of s.fish) {
      const bottom = !!catalog[f.kind].bottom, guppy = catalog[f.kind].id === 'guppy';
      const food = s.pellets.find(p => p.target === f.id && (!bottom || p.y >= 240));
      if (bottom) {
        if (food) { f.tx=food.x; f.pauseUntil=0; }
        else if (s.age>=f.nextTurn) {
          f.tx=40+random(s)*160; f.pauseUntil=s.age+1+random(s)*3;
          f.nextTurn=f.pauseUntil+5+random(s)*8;
        }
        const dx=f.tx-f.x, moving=s.age>=f.pauseUntil && Math.abs(dx)>2;
        const target=moving?Math.sign(dx)*(food?7:4):0;
        f.vx+=(target-f.vx)*Math.min(1,dt*3);
        f.x=Math.max(36,Math.min(204,f.x+f.vx*dt));
        f.y=249+Math.sin(f.x/23)*2;
        if(Math.abs(f.vx)>0.5)f.direction=f.vx>0?1:-1;
        if(food&&Math.abs(f.x-food.x)<10){
          s.pellets.splice(s.pellets.indexOf(food),1);
          if(!f.adult){f.growth=Math.min(GROWTH,f.growth+2);f.adult=f.growth===GROWTH;}
        }
        continue;
      }
      if (food) { f.tx = Math.min(204, Math.max(36, food.x)); f.ty = Math.max(116, food.y); }
      else if (s.age >= f.nextTurn) {
        f.tx = 36 + random(s) * 168; f.ty = 120 + random(s) * (guppy ? 65 : 102);
        f.pauseUntil = s.age + random(s) * 1.2;
        f.nextTurn = s.age + 4 + random(s) * 6;
      }
      let dx = f.tx - f.x, dy = f.ty - f.y;
      for (const other of s.fish) {
        if (other === f || catalog[other.kind].bottom) continue;
        const ox = f.x - other.x, oy = f.y - other.y, d = Math.hypot(ox, oy);
        if (d > 0 && d < 24) { dx += ox * (24 - d) / d; dy += oy * (24 - d) / d; }
      }
      const distance = Math.hypot(dx, dy), speed = food ? 24 : s.age < f.pauseUntil ? 0 : (guppy ? 15 : f.adult ? 9 : 13) * (0.85 + 0.15*Math.sin(s.age+f.id));
      const easing = Math.min(1, dt * 2.5);
      f.vx += ((distance > 3 ? dx / distance * speed : 0) - f.vx) * easing;
      f.vy += ((distance > 3 ? dy / distance * speed : 0) - f.vy) * easing;
      f.x = Math.min(204, Math.max(36, f.x + f.vx * dt));
      f.y = Math.min(226, Math.max(116, f.y + f.vy * dt));
      if (Math.abs(f.vx) > 2) f.direction = f.vx > 0 ? 1 : -1;
      if (food && Math.hypot(f.x - food.x, f.y - food.y) < 16) {
        s.pellets.splice(s.pellets.indexOf(food), 1);
        if (!f.adult) {
          f.growth = Math.min(GROWTH, f.growth + 2);
          if (f.growth === GROWTH) { f.adult = true; note(s, '一条小鱼长大啦！'); }
        }
      }
    }
  }
  const api = { isDaytime, create, press, update, nextDay, catalog, MAX_FISH, DAILY_FOOD, GROWTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AquaGame = api;
})(globalThis);

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
  const X0 = 36, X1 = 204, Y0 = 116, Y1 = 226, FLOOR = 249, TAU = Math.PI * 2;
  // SURFACE is where food enters the water, SAND where uneaten food comes to rest.
  const SURFACE = 30, SAND = 252, ROWS = 3, WIPE = 0.7;
  // The care stamp line shows for STAMP_SECONDS; after IDLE_SECONDS without a key the HUD hides.
  const STAMP_SECONDS = 10, IDLE_SECONDS = 180;
  // Home buttons: feed, clean, choose fish, water sound.
  const HOME_BUTTONS = 4;
  // Motion tuning. TURN is the whole squash-flip-unsquash turn; PITCH_SHEAR is pixels of
  // per-column y offset per pixel from sprite centre at full pitch (firmware applies it at blit time).
  const MOTION = { TURN: 0.36, TURN_COOLDOWN: 1.2, SWIM_FRAMES: 4, STEP_PX: 3, PITCH_SHEAR: 0.06,
    BODY_RX: 34, BODY_RY: 20, MAX_TAIL_HZ: 3 };
  // Per-channel multiply + add on 8-bit RGB before RGB565 quantisation; far layer reads as deeper water.
  const SHADES = {
    day: { mul: [1, 1, 1], add: [0, 0, 0] },
    dayFar: { mul: [0.84, 0.86, 0.86], add: [4, 15, 16] },
    night: { mul: [0.5, 0.53, 0.6], add: [2, 8, 22] },
    nightFar: { mul: [0.42, 0.45, 0.52], add: [3, 10, 25] },
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function isDaytime(hour) { return hour >= 7 && hour < 18; }
  function validDay(day) {
    return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
      && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  }
  function fish(id, kind, adult = false) {
    const bottom = !!catalog[kind].bottom, x = [64,155,73,172,119,180,100,145][id], direction = bottom ? 1 : id % 2 ? -1 : 1;
    const y = bottom ? FLOOR : [135,145,191,202,220,174,160,180][id];
    // layer 0 swims behind layer 1; heading is the facing a turn in progress will end on.
    return { id, kind, adult, growth: adult ? GROWTH : 0, x, y, vx: 0, vy: 0, direction, heading: direction,
      tx: clamp(x + direction * 70, X0 + 4, X1 - 4), ty: y, nextTurn: 3 + id, pauseUntil: 0,
      layer: bottom ? 1 : id % 2, phase: id * 1.7, turn: 0, lastTurn: -9, pitch: 0, stride: 0 };
  }
  function create(day) {
    if (!validDay(day)) throw new Error('Expected a valid YYYY-MM-DD date');
    // sound: the running-water loop (off by default); plops counts food splashes for the audio side.
    return { day, fed: 0, water: 68, careDays: 0, stamped: false, stampUntil: 0, lastInput: 0, immersive: false,
      sound: false, plops: 0, selected: 0,
      mode: 'home', choice: 0, adultChoice: false, lane: 0, age: 0, seed: 1179,
      message: '', messageUntil: 0, pellets: [], fish: [fish(0, 0, true), fish(1, 2, true), fish(2, 1), fish(3, 3), fish(4, 5), fish(5, 6, true), fish(6, 7, true)],
      // One dirt entry per glass row (top / middle / bottom); wipe is the squeegee pass being animated.
      dirt: Array.from({ length: ROWS }, (_, lane) => ({ lane, clean: false })), wipe: null, ripples: [], puffs: [] };
  }
  function note(s, text) { s.message = text; s.messageUntil = s.age + 3; }
  function reward(s) {
    if (!s.stamped && s.fed > 0 && s.water >= 90) {
      s.stamped = true; s.stampUntil = s.age + STAMP_SECONDS; s.careDays++; note(s, '今日照料完成！');
    }
  }
  function nextDay(s, day) {
    if (!validDay(day)) throw new Error('Invalid calendar date');
    // shortcut: preview state is in memory; firmware must persist date and quotas in NVS.
    if (day <= s.day) return false;
    const elapsed = (Date.parse(day) - Date.parse(s.day)) / 86400000;
    s.day = day; s.fed = 0; s.stamped = false; s.pellets = []; s.ripples = []; s.puffs = []; s.wipe = null;
    s.water = Math.max(20, s.water - Math.min(elapsed, 10) * 8);
    s.dirt.forEach(d => { d.clean = false; }); s.mode = 'home';
    note(s, '新的一天，看看鱼儿'); return true;
  }
  function press(s, key) {
    if (!['up', 'down', 'ok', 'back'].includes(key)) return;
    s.lastInput = s.age;
    // The first key after the idle hide only brings the HUD back, so it never feeds by accident.
    if (s.immersive) { s.immersive = false; return; }
    if (key === 'back') { s.mode = 'home'; return; }
    const delta = key === 'up' ? -1 : 1;
    if (s.mode === 'home') {
      if (key !== 'ok') { s.selected = (s.selected + delta + HOME_BUTTONS) % HOME_BUTTONS; return; }
      if (s.selected === 3) { s.sound = !s.sound; note(s, s.sound ? '水声已打开' : '水声已关闭'); return; }
      if (s.selected === 0) {
        if (s.fed >= DAILY_FOOD) { note(s, '今天吃饱啦，明天再喂'); return; }
        if (s.pellets.length) { note(s, '等鱼儿吃完这一份'); return; }
        s.fed++; s.water = Math.max(0, s.water - 3);
        // A pinch of food sprinkled at one spot on the surface, entering the water over about 0.8 s.
        const spot = 70 + random(s) * 100;
        s.pellets = Array.from({ length: s.fish.length * 2 }, (_, i) => ({
          x: clamp(Math.round(spot + (random(s) - 0.5) * 40), X0, X1), y: SURFACE, vy: 34 + random(s) * 10,
          delay: i * 0.05 + random(s) * 0.12, kind: i % 3, target: i % s.fish.length }));
        note(s, '开饭啦！'); reward(s);
      } else if (s.selected === 1) {
        if (s.water >= 99.9) { note(s, '鱼缸已经很干净啦'); return; }
        s.mode = 'clean'; s.lane = 0;
        if (s.dirt.every(d => d.clean)) s.dirt.forEach(d => { d.clean = false; });
        s.cleanStep = (100 - s.water) / s.dirt.filter(d => !d.clean).length;
        s.lane = s.dirt.find(d => !d.clean).lane;
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
        f.x = 125; f.y = catalog[f.kind].bottom ? FLOOR : 190; f.tx = 125 + f.direction * 60; f.ty = f.y; s.fish.push(f); s.mode = 'home'; note(s, '新朋友入住啦！');
      }
    } else if (s.mode === 'clean') {
      if (key !== 'ok') { s.lane = (s.lane + delta + ROWS) % ROWS; return; }
      const dirty = s.dirt.find(d => d.lane === s.lane && !d.clean);
      if (dirty) {
        dirty.clean = true; s.wipe = { lane: s.lane, start: s.age }; s.water = Math.min(100, s.water + s.cleanStep);
        const next = s.dirt.find(d => !d.clean);
        if (next) s.lane = next.lane;
        else { s.water = 100; note(s, '擦干净啦！长按确定返回'); reward(s); }
      } else note(s, '这一行很干净，换一行吧');
    }
  }
  function random(s) {
    s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
    return s.seed / 4294967296;
  }
  function update(s, dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.25); s.age += dt;
    if (!s.immersive && s.age - s.lastInput >= IDLE_SECONDS) { s.immersive = true; s.mode = 'home'; }
    for (const p of s.pellets) {
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay <= 0 && !s.ripples.some(r => Math.abs(r.x - p.x) < 24 && s.age - r.start < 0.4)) {
          s.ripples.push({ x: p.x, start: s.age }); s.plops++;
        }
        continue;
      }
      // Enters fast, slows to a terminal sink speed that differs by pellet shape.
      p.vy += (14 + p.kind * 3 - p.vy) * Math.min(1, dt * 2.5);
      p.y = Math.min(SAND, p.y + p.vy * dt);
    }
    s.ripples = s.ripples.filter(r => s.age - r.start < 0.6);
    s.puffs = s.puffs.filter(p => s.age - p.start < 0.45);
    if (s.wipe && s.age - s.wipe.start > WIPE + 1) s.wipe = null;
    for (const f of s.fish) {
      const food = s.pellets.find(p => p.target === f.id && p.delay <= 0 && (!catalog[f.kind].bottom || p.y >= 240));
      const ate = catalog[f.kind].bottom ? crawl(s, f, food, dt) : swim(s, f, food, dt);
      if (!ate) continue;
      s.puffs.push({ x: food.x, y: food.y, start: s.age });
      s.pellets.splice(s.pellets.indexOf(food), 1);
      if (!f.adult) {
        f.growth = Math.min(GROWTH, f.growth + 2);
        if (f.growth === GROWTH) { f.adult = true; if (!catalog[f.kind].bottom) note(s, '一条小鱼长大啦！'); }
      }
    }
  }
  // Crabs walk sideways and never mirror; the gait frame follows distance walked so feet do not slide.
  function crawl(s, f, food, dt) {
    if (food) { f.tx = food.x; f.pauseUntil = Math.min(f.pauseUntil, s.age); }
    else if (s.age >= f.nextTurn) {
      f.tx = 40 + random(s) * 160; f.pauseUntil = s.age + 1 + random(s) * 3;
      f.nextTurn = f.pauseUntil + 5 + random(s) * 8;
    }
    const dx = f.tx - f.x, moving = s.age >= f.pauseUntil && Math.abs(dx) > 2;
    // Speed dips every 12 px of travel: a scuttle of steps rather than a constant glide.
    const rhythm = 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(f.stride * TAU / 12));
    const target = moving ? Math.sign(dx) * (food ? 9 : 5) * rhythm : 0;
    f.vx += (target - f.vx) * Math.min(1, dt * 4);
    const x = clamp(f.x + f.vx * dt, X0, X1);
    f.stride += Math.abs(x - f.x); f.x = x; f.y = FLOOR + Math.sin(f.x / 23) * 2;
    if (food && Math.abs(f.x - food.x) < 10) { f.pauseUntil = s.age + 0.8; return true; }
    return false;
  }
  function wander(s, f) {
    const guppy = catalog[f.kind].id === 'guppy', ahead = random(s) < 0.75 ? f.direction : -f.direction;
    const reach = 40 + random(s) * 90;
    let tx = f.x + ahead * reach;
    if (tx < X0 + 4 || tx > X1 - 4) tx = f.x - ahead * reach;
    f.tx = clamp(tx, X0 + 4, X1 - 4);
    f.ty = clamp(f.y + (random(s) - 0.5) * 56, Y0 + 4, guppy ? 185 : Y1 - 4);
    f.pauseUntil = random(s) < 0.3 ? s.age + 0.6 + random(s) * 1.4 : 0;
    f.nextTurn = s.age + 5 + random(s) * 6;
  }
  function swim(s, f, food, dt) {
    const guppy = catalog[f.kind].id === 'guppy';
    if (food) { f.tx = clamp(food.x, X0, X1); f.ty = clamp(food.y, Y0, Y1); }
    else if (s.age >= f.nextTurn) wander(s, f);
    const dx = f.tx - f.x, dy = f.ty - f.y, distance = Math.hypot(dx, dy);
    const cruise = (guppy ? 15 : f.adult ? 9 : 13) * (0.85 + 0.15 * Math.sin(s.age * 0.7 + f.id));
    const speed = food ? 24 : s.age < f.pauseUntil ? 0 : cruise * Math.min(1, distance / 20);
    // Real fish travel mostly forward; climbing and diving are capped well below cruise.
    let wx = distance > 3 ? dx / distance * speed : 0;
    let wy = distance > 3 ? clamp(dy / distance * speed, -speed * 0.45, speed * 0.45) : 0;
    // Facing follows the goal only, so being nudged by a neighbour never makes a fish turn round.
    const goal = wx;
    for (const o of s.fish) {
      if (o === f || catalog[o.kind].bottom) continue;
      const ox = (f.x - o.x) / MOTION.BODY_RX, oy = (f.y - o.y) / MOTION.BODY_RY, e = Math.hypot(ox, oy);
      if (e >= 1.8) continue;
      const push = (1.8 - e) / 1.8 * (o.layer === f.layer ? 1 : 0.35) * (food ? 0.5 : 1);
      const nx = e > 1e-6 ? ox / e : (f.id > o.id ? 1 : -1), ny = e > 1e-6 ? oy / e : 0;
      // Mostly yield vertically: passing above or below keeps both fish swimming forward.
      const below = ny > 0 || (ny === 0 && f.id > o.id);
      wx += nx * push * 8; wy += (ny + (below ? 0.4 : -0.4)) * push * 12;
    }
    if (f.x < X0 + 14) wx += (X0 + 14 - f.x) * 0.8; else if (f.x > X1 - 14) wx -= (f.x - X1 + 14) * 0.8;
    if (f.y < Y0 + 8) wy += (Y0 + 8 - f.y) * 0.6; else if (f.y > Y1 - 8) wy -= (f.y - Y1 + 8) * 0.6;
    if (f.turn > 0) {
      f.turn = Math.max(0, f.turn - dt);
      if (f.turn <= MOTION.TURN / 2) f.direction = f.heading;
    }
    const want = Math.abs(goal) > 1.2 ? Math.sign(goal) : f.direction;
    if (!f.turn && want !== f.direction && (food || s.age - f.lastTurn > MOTION.TURN_COOLDOWN)) {
      f.heading = want; f.turn = MOTION.TURN; f.lastTurn = s.age;
      // Depth changes hide inside the turn, where the squashed frame masks the shade change.
      if (!food && random(s) < 0.3) f.layer ^= 1;
    }
    // A fish brakes while turning and never swims backwards at speed.
    if (f.turn || Math.sign(wx) !== f.direction) wx *= 0.25;
    f.vx += (wx - f.vx) * Math.min(1, dt * 2.5);
    f.vy += (wy - f.vy) * Math.min(1, dt * 2);
    f.x = clamp(f.x + f.vx * dt, X0, X1);
    f.y = clamp(f.y + f.vy * dt, Y0, Y1);
    const pitch = f.turn ? 0 : clamp(f.vy / (Math.abs(f.vx) + 3), -0.6, 0.6);
    f.pitch += (pitch - f.pitch) * Math.min(1, dt * 3);
    const hz = Math.min(MOTION.MAX_TAIL_HZ, 0.7 + Math.hypot(f.vx, f.vy) * 0.12);
    f.phase = (f.phase + dt * TAU * hz) % TAU;
    if (!food) return false;
    // Food resting on the sand sits below the swim box; a fish at the bottom of the box can still reach it.
    const reach = Math.max(0, Math.abs(f.y - food.y) - Math.max(0, food.y - Y1));
    return Math.hypot(f.x - food.x, reach) < 16;
  }
  // Which pre-baked frame a creature shows now: swim 0-3, turn 0 (wide) / 1 (narrow), walk 0-3.
  function pose(f) {
    if (catalog[f.kind].bottom)
      return { role: 'walk', frame: Math.abs(f.vx) > 0.4 ? Math.floor(f.stride / MOTION.STEP_PX) % 4 : 0 };
    if (f.turn > 0) {
      const t = 1 - f.turn / MOTION.TURN;
      return { role: 'turn', frame: t < 0.25 || t >= 0.75 ? 0 : 1 };
    }
    return { role: 'swim', frame: Math.floor(f.phase / TAU * MOTION.SWIM_FRAMES) % MOTION.SWIM_FRAMES };
  }
  const api = { isDaytime, create, press, update, nextDay, pose, catalog, MAX_FISH, DAILY_FOOD, GROWTH, MOTION, SHADES,
    SURFACE, SAND, ROWS, WIPE, STAMP_SECONDS, IDLE_SECONDS, HOME_BUTTONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AquaGame = api;
})(globalThis);

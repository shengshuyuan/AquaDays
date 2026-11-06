(function (root) {
  'use strict';
  const { catalog } = AquaGame;
  const W = 240, H = 320, SW = 64, SH = 48;
  const C = { ink: '#082e35', water: '#0e4853', line: '#286574', pale: '#d6e6c7',
    muted: '#8ab4ab', accent: '#f4c783', orange: '#ed8b47', paper: '#eee6c9', green: '#7fba80' };
  const glyphs = new Map();
  const deviceColors = new Map();
  function deviceColor(color) {
    if (deviceColors.has(color)) return deviceColors.get(color);
    const rgb = Number.parseInt(color.slice(1), 16), r = (rgb >> 19) & 31, g = (rgb >> 10) & 63, b = (rgb >> 3) & 31;
    const result = `rgb(${(r << 3) | (r >> 2)},${(g << 2) | (g >> 4)},${(b << 3) | (b >> 2)})`;
    deviceColors.set(color, result); return result;
  }
  const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = deviceColor(color); ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }
  function line(ctx, x0, y0, x1, y1, color) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      rect(ctx, x0, y0, 1, 1, color); if (x0 === x1 && y0 === y1) break;
      const e = 2 * err; if (e >= dy) { err += dy; x0 += sx; } if (e <= dx) { err += dx; y0 += sy; }
    }
  }
  function poly(ctx, points, color) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
      for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i], [xj, yj] = points[j];
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) rect(ctx, x, y, 1, 1, color);
      }
    }
  }
  function ellipse(ctx, cx, cy, rx, ry, color) {
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++)
      if (x * x / (rx * rx) + y * y / (ry * ry) <= 1) rect(ctx, cx + x, cy + y, 1, 1, color);
  }
  function border(ctx, x, y, w, h, color) {
    rect(ctx, x, y, w, 1, color); rect(ctx, x, y + h - 1, w, 1, color);
    rect(ctx, x, y, 1, h, color); rect(ctx, x + w - 1, y, 1, h, color);
  }
  function glyph(ch) {
    if (glyphs.has(ch)) return glyphs.get(ch);
    const source = AquaPixelFont[ch];
    if (!source) throw new Error(`Missing bitmap glyph: ${ch}`);
    const width = source.width, bits = [];
    for (const row of source.rows) for (let x = 0; x < width; x++) bits.push((row >> x) & 1);
    const result = { width, bits }; glyphs.set(ch, result); return result;
  }
  function text(ctx, str, x, y, color = C.pale, align = 'left') {
    const chars = [...str].map(glyph), width = chars.reduce((sum, c) => sum + c.width, 0);
    if (align === 'center') x -= Math.floor(width / 2);
    if (align === 'right') x -= width;
    for (const g of chars) {
      for (let j = 0; j < g.bits.length; j++) if (g.bits[j]) rect(ctx, x + j % g.width, y + Math.floor(j / g.width), 1, 1, color);
      x += g.width;
    }
  }
  const digits = {
    '0': ['01110','11011','11011','11011','11011','11011','01110'],
    '1': ['00110','01110','00110','00110','00110','00110','01111'],
    '2': ['01110','11011','00011','00110','01100','11000','11111'],
    '3': ['11110','00011','00011','01110','00011','00011','11110'],
    '4': ['11011','11011','11011','11111','00011','00011','00011'],
    '5': ['11111','11000','11000','11110','00011','00011','11110'],
    '6': ['01110','11000','11000','11110','11011','11011','01110'],
    '7': ['11111','00011','00110','00110','01100','01100','01100'],
    '8': ['01110','11011','11011','01110','11011','11011','01110'],
    '9': ['01110','11011','11011','01111','00011','00011','01110'],
    ':': ['0','1','1','0','1','1','0'],
  };
  function clock(ctx, time) {
    const widths = [...time].map(ch => digits[ch][0].length * 3 + 4);
    let x = Math.floor((W - widths.reduce((a, b) => a + b, 0) + 4) / 2);
    [...time].forEach((ch, index) => {
      digits[ch].forEach((row, y) => [...row].forEach((v, i) => { if (v === '1') {rect(ctx,x+i*3+1,46+y*3+1,3,3,'#174f54');rect(ctx,x+i*3,46+y*3,3,3,'#d6ece4');} }));
      x += widths[index];
    });
  }
  const sprites = catalog.map(() => [0,1,2].map(() => makeCanvas(SW,SH)));
  const fishReady = Promise.all(catalog.map((kind,k) => new Promise((resolve,reject) => {
    const image=new Image();
    image.onload=()=>{
      for(let frame=0;frame<3;frame++){
        const ctx=sprites[k][frame].getContext('2d');ctx.imageSmoothingEnabled=false;
        // Pre-baked tail movement: keep the head and body stable.
        if(kind.bottom) {
          ctx.drawImage(image,0,0,SW,29,0,0,SW,29);
          for(let x=0;x<SW;x++)ctx.drawImage(image,x,29,1,SH-29,x,29+((Math.floor(x/8)+frame)%3===0?1:0),1,SH-29);
        } else for(let x=0;x<SW;x++){
          const shift=Math.round([-1,0,1][frame]*2*Math.pow(Math.max(0,1-x/29),2));
          ctx.drawImage(image,x,0,1,SH,x,shift,1,SH);
        }
        const pixels=ctx.getImageData(0,0,SW,SH),d=pixels.data;
        for(let i=0;i<d.length;i+=4){const r=d[i]>>3,g=d[i+1]>>2,b=d[i+2]>>3;d[i]=(r<<3)|(r>>2);d[i+1]=(g<<2)|(g>>4);d[i+2]=(b<<3)|(b>>2);}
        ctx.putImageData(pixels,0,0);
      }resolve();
    };
    image.onerror=()=>reject(new Error('Fish asset failed: '+kind.id));
    image.src='assets/'+kind.id+'-v4.png';
  })));
  function drawFish(ctx,f,frame,x=f.x,y=f.y,size=f.adult?1:0.625) {
    if(catalog[f.kind].bottom)size*=0.75;
    else if(catalog[f.kind].id==='guppy')size*=0.8;
    const w=Math.round(SW*size),h=Math.round(SH*size);
    ctx.save();ctx.translate(Math.round(x),Math.round(y));if(f.direction<0)ctx.scale(-1,1);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(sprites[f.kind][frame%3],-w/2,-h/2,w,h);ctx.restore();
  }
  const background = makeCanvas(W,H), nightBackground = makeCanvas(W,H);
  const water = new Image();
  const waterReady = new Promise((resolve, reject) => {
    water.onload = () => {
      const ctx = background.getContext('2d');
      rect(ctx,0,0,W,H,C.ink);
      ctx.drawImage(water,0,21,240,250);
      const image=ctx.getImageData(0,0,W,H),p=image.data;
      for(let i=0;i<p.length;i+=4){
        const r=p[i]>>3,g=p[i+1]>>2,b=p[i+2]>>3;
        p[i]=(r<<3)|(r>>2);p[i+1]=(g<<2)|(g>>4);p[i+2]=(b<<3)|(b>>2);
      }
      ctx.putImageData(image,0,0);
      rect(ctx,0,0,240,19,C.ink);rect(ctx,0,273,240,47,C.ink);
      text(ctx,'AQUADAYS',9,4,C.pale);
      const night=nightBackground.getContext('2d');night.drawImage(background,0,0);
      night.fillStyle='rgba(3,14,42,0.57)';night.fillRect(0,21,240,250);
      const nightImage=night.getImageData(0,0,W,H),n=nightImage.data;
      for(let i=0;i<n.length;i+=4){const r=n[i]>>3,g=n[i+1]>>2,b=n[i+2]>>3;n[i]=(r<<3)|(r>>2);n[i+1]=(g<<2)|(g>>4);n[i+2]=(b<<3)|(b>>2);}
      night.putImageData(nightImage,0,0);resolve();
    };
    water.onerror=()=>reject(new Error('Aquarium background failed to load'));
  });
  water.src='assets/water-v3.png';
  const ready=Promise.all([waterReady,fishReady]);
  function algae(ctx,s,highlight=false) {
    s.dirt.forEach((d,i) => {
      if(d.clean) return;
      if (!highlight && s.water>=90) return;
      const x=198+(i%3)*8, y=113+d.lane*45+(i%3)*4;
      rect(ctx,x,y,5,8,'#456a4b'); rect(ctx,x-2,y+2,8,4,'#567b50');
      rect(ctx,x+1,y+1,2,2,'#75975d');
    });
  }
  function sceneBackground(options) {
    return AquaGame.isDaytime(Number((options.time||'14:36').slice(0,2))) ? background : nightBackground;
  }
  function tank(ctx,s,options) {
    ctx.drawImage(sceneBackground(options),0,0);
    text(ctx,`鱼缸 ${s.fish.length}/${AquaGame.MAX_FISH}`,231,4,C.muted,'right');
    clock(ctx,options.time||'14:36');
    text(ctx,(options.date||s.day.replaceAll('-','.'))+' '+(options.weekday||'周五'),120,79,C.muted,'center');
    const tick=Math.floor(s.age*6);
    for(let i=0;i<4;i++) {
      const y=231-((Math.floor(s.age*8)+i*39)%139), x=224+(i%2)*3;
      border(ctx,x,y,3,4,'#4b9197'); rect(ctx,x,y,1,1,'#9bc4b7');
    }
    for(const f of s.fish) {
      drawFish(ctx,f,catalog[f.kind].bottom && Math.abs(f.vx)<0.5 ? 1 : (tick+f.id)%3);
    }
    for(const p of s.pellets) if(p.y>26) { rect(ctx,p.x,p.y,2,2,C.accent); rect(ctx,p.x,p.y,1,1,'#f9e1a3'); }
    algae(ctx,s,s.mode==='clean');
  }
  function button(ctx,x,y,w,label,selected,disabled=false) {
    rect(ctx,x,y,w,22,selected?'#245958':'#103a40');
    if(selected)rect(ctx,x+8,y+20,w-16,2,disabled?C.muted:C.accent);
    text(ctx,label,x+w/2,y+5,disabled?C.muted:selected?C.accent:C.pale,'center');
  }
  function selection(ctx,s,options) {
    ctx.drawImage(sceneBackground(options),0,0); rect(ctx,6,28,228,215,'#10434d');
    text(ctx,s.mode==='size'?'选择大小':'选择伙伴',120,33,C.pale,'center');
    text(ctx,`${s.fish.length}/${AquaGame.MAX_FISH}`,228,4,C.muted,'right');
    border(ctx,20,58,200,133,'#2e6b70');
    rect(ctx,21,59,198,131,'#134e59');
    const size=s.mode==='size'?(s.adultChoice?1.5:0.9):1.5;
    drawFish(ctx,{kind:s.choice,adult:true,direction:1},Math.floor(s.age*5)%3,120,110,size);
    text(ctx,catalog[s.choice].name,120,156,C.accent,'center');
    text(ctx,catalog[s.choice].trait,120,170,C.muted,'center');
    if(s.mode==='size') {
      button(ctx,24,211,88,catalog[s.choice].bottom?'幼蟹':'幼鱼',!s.adultChoice); button(ctx,128,211,88,catalog[s.choice].bottom?'成蟹':'成鱼',s.adultChoice);
      text(ctx,catalog[s.choice].bottom?'沿着缸底慢慢爬行':s.adultChoice?'入住就能看大鱼':'喂食后慢慢长大',120,245,C.pale,'center');
    } else {
      [-1,0,1].forEach((delta,slot)=>{
        const i=(s.choice+delta+catalog.length)%catalog.length,kind=catalog[i];
        if(delta===0){rect(ctx,12+slot*76,204,65,48,'#285f61');border(ctx,12+slot*76,204,65,48,C.accent);}
        drawFish(ctx,{kind:i,adult:false,direction:1},0,44+slot*76,220,0.55);
        text(ctx,kind.name,44+slot*76,237,delta===0?C.accent:C.muted,'center');
      });
      text(ctx,`${s.choice+1} / ${catalog.length}`,120,53,C.muted,'center');

    }
    const full=s.fish.length>=AquaGame.MAX_FISH;
    button(ctx,20,271,200,full?'鱼缸已满':s.mode==='size'?'放入鱼缸':'下一步：选择大小',true,full);
    text(ctx,'上下切换 · 确定选择',120,302,C.muted,'center');
  }
  function render(canvas,s,options={}) {
    const ctx=canvas.getContext('2d'); ctx.imageSmoothingEnabled=false;
    if(s.mode==='select'||s.mode==='size') selection(ctx,s,options);
    else {
      tank(ctx,s,options);
      if(s.mode==='clean') {
        const y=117+s.lane*45;
        border(ctx,192,y-12,38,33,C.accent);
        rect(ctx,208,y+6,7,15,'#9eac94'); rect(ctx,202,y-3,19,13,'#e9d9ae');
        rect(ctx,202,y+9,19,3,'#74a18b'); rect(ctx,205,y,13,2,'#c4b68d');
        const cleaned=s.dirt.filter(d=>d.clean).length;
        text(ctx,`已擦 ${cleaned}/9`,10,280,C.accent);
        text(ctx,`水质 ${Math.round(s.water)}%`,230,280,C.pale,'right');
        text(ctx,'上下换区 · 确定擦藻',120,302,C.muted,'center');
      } else {
        rect(ctx,9,273,222,1,'#35615e');
        text(ctx,`水质 ${Math.round(s.water)}%`,10,278,s.water<60?C.accent:C.pale);
        rect(ctx,121,277,1,12,'#35615e');
        text(ctx,`喂食 ${s.fed}/2`,230,278,s.fed===2?C.accent:C.pale,'right');
        [s.fed===2?'已喂饱':'喂食','擦缸','选鱼'].forEach((name,i)=>button(ctx,9+i*77,295,68,name,s.selected===i,i===0&&s.fed===2));
      }
      if(s.message && s.age<s.messageUntil) {
        rect(ctx,9,250,222,18,'#153e43'); text(ctx,s.message,120,254,C.paper,'center');
      } else if(s.stamped) {
        text(ctx,`照料章 +1  累计 ${s.careDays}`,120,254,C.accent,'center');
      }
    }
  }
  function scenario(name) {
    const s=AquaGame.create('2026-11-06');
    if(name==='select') { s.mode='select'; s.choice=1; }
    if(name==='feed') {
      s.fed=1; AquaGame.press(s,'ok'); s.age=4;
      s.message='今天吃饱啦，明天再喂'; s.messageUntil=20;
      s.pellets.forEach((p,i)=>{p.y=123+i*11;});
    }
    if(name==='clean') {
      s.selected=1; AquaGame.press(s,'ok');
      for(let i=0;i<3;i++) AquaGame.press(s,'ok');
      AquaGame.press(s,'down'); AquaGame.press(s,'ok');
      s.message='';
    }
    return s;
  }
  root.AquaRender={ ready, render, scenario, background, nightBackground, sprites, glyphs, text, makeCanvas, W,H,SW,SH };
})(globalThis);

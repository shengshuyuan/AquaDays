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
  const makeCanvas = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d', { willReadFrequently: true }); return c;
  };
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
  function quantize(d) {
    for(let i=0;i<d.length;i+=4){const r=d[i]>>3,g=d[i+1]>>2,b=d[i+2]>>3;d[i]=(r<<3)|(r>>2);d[i+1]=(g<<2)|(g>>4);d[i+2]=(b<<3)|(b>>2);}
  }
  // Pre-baked sizes: juvenile in tank / catalogue, adult in tank / size preview, large preview.
  const SIZES=[0.625,1,1.5];
  // Frame list per creature, all facing right; firmware mirrors at blit time by reading columns in reverse.
  function frameSpecs(kind,size) {
    if(kind.bottom) return [0,1,2,3].map(frame=>({role:'walk',frame}));
    const swim=[0,1,2,3].map(frame=>({role:'swim',frame}));
    return size===1.5?swim:swim.concat([{role:'turn',frame:0,squash:0.5},{role:'turn',frame:1,squash:0.22}]);
  }
  const scaleOf=kind=>kind.bottom?0.75:kind.id==='guppy'?0.8:1;
  // Deforms at the destination size so a 1 px tail or leg move survives instead of rounding away.
  function bake(image,kind,size,spec) {
    const w=Math.round(SW*size*scaleOf(kind)),h=Math.round(SH*size*scaleOf(kind));
    const src=makeCanvas(w,h),sctx=src.getContext('2d');sctx.imageSmoothingEnabled=false;sctx.drawImage(image,0,0,w,h);
    const from=sctx.getImageData(0,0,w,h).data,out=makeCanvas(w,h),octx=out.getContext('2d'),img=octx.createImageData(w,h),to=img.data;
    const copy=(dx,dy,sx,sy)=>{
      if(sx<0||sx>=w||sy<0||sy>=h||dy<0||dy>=h)return;
      const a=(dy*w+dx)*4,b=(sy*w+sx)*4;for(let c=0;c<4;c++)to[a+c]=from[b+c];
    };
    const legs=Math.round(h*0.6),lift=Math.max(1,Math.round(size*1.5));
    const root=Math.round(w*0.45),amp=0.5+2*size,theta=spec.frame*Math.PI/2;
    for(let x=0;x<w;x++)for(let y=0;y<h;y++) {
      if(spec.role==='walk') {
        // Alternating leg groups lift in frames 1 and 3, like a crab's tetrapod gait.
        const group=Math.floor(x/(w/8))%2,up=y>=legs&&((spec.frame===1&&group===0)||(spec.frame===3&&group===1));
        copy(x,y,x,up?y+lift:y);
      } else if(spec.role==='turn') {
        // Foreshortened body mid-turn, as if the fish is swinging towards the viewer.
        copy(x,y,Math.round((w-1)/2+(x-(w-1)/2)/spec.squash),y);
      } else if(x>=root) copy(x,y,x,y);
      else {
        // Travelling wave from tail root to tip, plus slight foreshortening as the fin sweeps sideways.
        const t=1-x/root,sweep=Math.sin(theta-1.4*t);
        const sx=Math.round(root-(root-x)/(1-0.12*Math.abs(Math.sin(theta))));
        copy(x,y,sx,y-Math.round(amp*Math.pow(t,1.6)*sweep));
      }
    }
    quantize(to);octx.putImageData(img,0,0);return out;
  }
  // sprites[kind][sizeIndex] = [{role,frame,squash?,canvas}]
  const sprites = catalog.map(() => SIZES.map(() => []));
  const fishReady = Promise.all(catalog.map((kind,k) => new Promise((resolve,reject) => {
    const image=new Image();
    image.onload=()=>{
      SIZES.forEach((size,i)=>{sprites[k][i]=frameSpecs(kind,size).map(spec=>({...spec,canvas:bake(image,kind,size,spec)}));});
      resolve();
    };
    image.onerror=()=>reject(new Error('Fish asset failed: '+kind.id));
    image.src='assets/'+kind.id+'-v4.png';
  })));
  const shaded=new Map();
  // Same per-channel multiply/add the firmware applies to RGB565 pixels at blit time.
  function shadeCanvas(canvas,name) {
    if(name==='day')return canvas;
    if(!shaded.has(canvas))shaded.set(canvas,{});
    const cache=shaded.get(canvas);if(cache[name])return cache[name];
    const {mul,add}=AquaGame.SHADES[name],out=makeCanvas(canvas.width,canvas.height),ctx=out.getContext('2d');
    const img=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),d=img.data;
    for(let i=0;i<d.length;i+=4)for(let c=0;c<3;c++)d[i+c]=Math.min(255,Math.round(d[i+c]*mul[c]+add[c]));
    quantize(d);ctx.putImageData(img,0,0);return cache[name]=out;
  }
  function shadeHex(color,name) {
    if(name==='day')return color;
    const {mul,add}=AquaGame.SHADES[name],rgb=Number.parseInt(color.slice(1),16);
    return '#'+[16,8,0].map((s,c)=>Math.min(255,Math.round(((rgb>>s)&255)*mul[c]+add[c])).toString(16).padStart(2,'0')).join('');
  }
  function spriteFor(kind,size,pose) {
    const list=sprites[kind][SIZES.indexOf(size)];
    return list.find(s=>s.role===pose.role&&s.frame===pose.frame)||list[0];
  }
  // Draws a pre-baked frame with no scaling: mirror by column order, pitch by per-column y offset.
  function drawFish(ctx,f,pose,x=f.x,y=f.y,size=f.adult?1:0.625,shade='day') {
    const sprite=spriteFor(f.kind,size,pose);
    if(!sprite)return;
    const canvas=shadeCanvas(sprite.canvas,shade),w=canvas.width,h=canvas.height;
    const left=Math.round(x-w/2),top=Math.round(y-h/2),k=(f.pitch||0)*AquaGame.MOTION.PITCH_SHEAR;
    if(Math.abs(k*w/2)<0.5) {
      ctx.save();ctx.imageSmoothingEnabled=false;
      if(f.direction<0){ctx.translate(left+w,top);ctx.scale(-1,1);ctx.drawImage(canvas,0,0);}else ctx.drawImage(canvas,left,top);
      ctx.restore();return;
    }
    for(let c=0;c<w;c++) {
      const offset=Math.round((c-(w-1)/2)*k),dx=f.direction<0?left+w-1-c:left+c;
      ctx.drawImage(canvas,c,0,1,h,dx,top+offset,1,h);
    }
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
  // Glass rows below the date: top / middle / bottom. Each row is wiped in one squeegee pass.
  const ROWS=[[92,151],[152,211],[212,270]],GLASS_X0=3,GLASS_X1=237;
  // Fixed grime per row so the same glass looks the same every day: algae near the frame, a few water marks.
  const grime=ROWS.map(([y0,y1],lane)=>{
    let seed=7919*(lane+3);const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    const spots=[];
    for(let i=0;i<26;i++) {
      const edge=rnd()<0.65,side=rnd()<0.5;
      const x=edge?(side?GLASS_X0+1+rnd()*26:GLASS_X1-4-rnd()*26):GLASS_X0+30+rnd()*170;
      const y=lane===2&&rnd()<0.5?y1-4-rnd()*14:y0+2+rnd()*(y1-y0-6);
      spots.push({x:Math.round(x),y:Math.round(y),type:edge?'algae':rnd()<0.6?'algae':'mark',size:1+Math.floor(rnd()*3)});
    }
    return spots;
  });
  function wipeEdge(s,lane) {
    if(!s.wipe||s.wipe.lane!==lane)return null;
    const t=Math.min(1,(s.age-s.wipe.start)/AquaGame.WIPE),eased=1-Math.pow(1-t,2);
    return {x:Math.round(GLASS_X0-6+eased*(GLASS_X1-GLASS_X0+12)),t,after:s.age-s.wipe.start-AquaGame.WIPE};
  }
  // Irregular, semi-transparent algae clusters: 1 = light, 2 = mid, 3 = dark pixel.
  const ALGAE=[
    ['21','02'],
    ['0120','2232','0220'],
    ['001200','012320','223322','022330','002200'],
  ];
  function algaeSpot(ctx,x,y,size,light) {
    const colors=[null,'#93b571','#5f8c53','#3f6a45'].map(c=>c&&deviceColor(shadeHex(c,light)));
    ctx.save();ctx.globalAlpha=0.72;
    ALGAE[size-1].forEach((row,j)=>[...row].forEach((v,i)=>{if(v!=='0'){ctx.fillStyle=colors[v];ctx.fillRect(x+i,y+j,1,1);}}));
    ctx.restore();
  }
  function waterMark(ctx,x,y,light) {
    ctx.save();ctx.globalAlpha=0.45;ctx.fillStyle=deviceColor(shadeHex('#cfe6da',light));
    for(const [dx,dy,w,h] of [[1,0,3,1],[0,1,1,2],[4,1,1,2],[1,3,3,1]])ctx.fillRect(x+dx,y+dy,w,h);
    ctx.restore();
  }
  // Film strength per screen row, faded over 4 px where a dirty row meets a clean one so rows never look boxed.
  function looksDirty(s,lane) { const edge=wipeEdge(s,lane); return !s.dirt[lane].clean||(!!edge&&edge.t<1); }
  function filmAt(s,y) {
    const dirtyAt=yy=>{const i=ROWS.findIndex(([a,b])=>yy>=a&&yy<=b);return i>=0&&looksDirty(s,i);};
    let n=0;for(let d=-4;d<=4;d++)n+=dirtyAt(y+d)?1:0;return n/9;
  }
  function grimeLayer(ctx,s,light,strength) {
    if(strength<=0)return;
    const film=shadeHex('#6b9a5e',light);
    ctx.save();ctx.fillStyle=deviceColor(film);
    for(let y=ROWS[0][0]-4;y<=ROWS[2][1];y++) {
      const a=filmAt(s,y);if(!a)continue;
      const lane=ROWS.findIndex(([y0,y1])=>y>=y0&&y<=y1),edge=lane>=0?wipeEdge(s,lane):null,from=edge?Math.max(GLASS_X0,edge.x):GLASS_X0;
      ctx.globalAlpha=0.2*a*strength;ctx.fillRect(from,y,GLASS_X1-from,1);
      // Algae thickens towards the frame.
      ctx.globalAlpha=0.16*a*strength;
      if(from<GLASS_X0+20)ctx.fillRect(Math.max(from,GLASS_X0),y,GLASS_X0+20-Math.max(from,GLASS_X0),1);
      ctx.fillRect(Math.max(from,GLASS_X1-20),y,GLASS_X1-Math.max(from,GLASS_X1-20),1);
    }
    ctx.restore();
    ROWS.forEach((row,lane)=>{
      if(!looksDirty(s,lane))return;
      const edge=wipeEdge(s,lane),count=Math.ceil(grime[lane].length*strength);
      for(const g of grime[lane].slice(0,count)) {
        if(edge&&g.x<edge.x)continue;
        if(g.type==='algae')algaeSpot(ctx,g.x,g.y,g.size,light);else waterMark(ctx,g.x,g.y,light);
      }
    });
  }
  // Squeegee seen side-on: rubber blade the height of the row, holder and handle trailing behind it.
  function squeegee(ctx,x,y0,y1,light) {
    const mid=Math.round((y0+y1)/2),top=y0+5,h=y1-y0-9;
    rect(ctx,x,top,2,h,shadeHex('#163c40',light));rect(ctx,x+2,top,1,h,shadeHex('#9bc4b7',light));
    rect(ctx,x-3,top+3,3,h-6,shadeHex(C.accent,light));rect(ctx,x-3,top+3,1,h-6,shadeHex('#f9e1a3',light));
    rect(ctx,x-11,mid-2,8,4,shadeHex('#c4b68d',light));rect(ctx,x-11,mid-2,8,1,shadeHex('#e9d9ae',light));
    rect(ctx,x-12,mid-1,1,2,shadeHex('#74a18b',light));
  }
  // Two short diagonal glints left behind on freshly wiped glass, fading out after the pass.
  function shine(ctx,s,lane,light) {
    const edge=wipeEdge(s,lane);if(!edge)return;
    const fade=edge.after<0?1:Math.max(0,1-edge.after);if(!fade)return;
    const [y0,y1]=ROWS[lane],c=deviceColor(shadeHex('#e4f3ea',light));
    ctx.save();ctx.fillStyle=c;
    for(const [sx,len,alpha] of [[60,22,0.55],[66,12,0.35],[150,16,0.45]])
      for(let i=0;i<len;i++){const x=sx+i,y=y1-10-i*2;if(x<edge.x&&y>y0+2){ctx.globalAlpha=alpha*fade;ctx.fillRect(x,y,1,2);}}
    ctx.restore();
  }
  function grimeStrength(s,mode) { return mode==='clean'?1:s.water>=90?0:Math.min(1,0.35+(90-s.water)/30); }
  function pellet(ctx,p,x,light) {
    const y=Math.round(p.y),core=shadeHex('#cf8a40',light),lit=shadeHex('#f4c783',light),dark=shadeHex('#875127',light);
    if(p.kind===0){rect(ctx,x,y,2,2,core);rect(ctx,x,y,1,1,lit);rect(ctx,x+1,y+1,1,1,dark);}
    else if(p.kind===1){rect(ctx,x,y+1,3,1,core);rect(ctx,x+1,y,1,3,core);rect(ctx,x+1,y,1,1,lit);rect(ctx,x+2,y+1,1,1,dark);rect(ctx,x+1,y+2,1,1,dark);}
    else {rect(ctx,x,y,3,2,core);rect(ctx,x,y,2,1,lit);rect(ctx,x+2,y+1,1,1,dark);}
  }
  // Seen side-on, a ripple is two short crests running apart along the surface line.
  function ripple(ctx,r,s,light) {
    const t=(s.age-r.start)/0.6,d=Math.round(2+12*t),y=AquaGame.SURFACE-1,c=shadeHex(t<0.5?'#eef8f0':'#9cc7bb',light);
    if(t<0.2)rect(ctx,r.x-1,y-1,3,1,c);
    rect(ctx,r.x-d-3,y,4,1,c);rect(ctx,r.x+d,y,4,1,c);
    if(t<0.6){rect(ctx,r.x-d-2,y-1,2,1,c);rect(ctx,r.x+d+1,y-1,2,1,c);}
  }
  function puff(ctx,p,s,light) {
    const t=(s.age-p.start)/0.45,d=1+Math.round(3*t),c=shadeHex(t<0.5?'#f4c783':'#cfe3d6',light);
    for(const [dx,dy] of [[-1,-1],[1,-1],[-1,1],[1,0]])rect(ctx,p.x+dx*d,p.y+dy*d,1,1,c);
  }
  function isDay(options) { return AquaGame.isDaytime(Number((options.time||'14:36').slice(0,2))); }
  function sceneBackground(options) { return isDay(options) ? background : nightBackground; }
  // Water occupies rows WATER_TOP..WATER_BOTTOM of the background; the bars above and below hold the HUD.
  const WATER_TOP=21,WATER_BOTTOM=270;
  // Immersive view: mirror the water into both bars so the scene fills the screen, darkening the
  // mirrored sand towards the bottom edge and the mirrored surface slightly towards the top.
  function immersiveBars(ctx,bg) {
    ctx.save();ctx.imageSmoothingEnabled=false;ctx.fillStyle=deviceColor(C.ink);
    for(let y=0;y<WATER_TOP;y++){
      ctx.drawImage(bg,0,2*WATER_TOP-1-y,W,1,0,y,W,1);
      ctx.globalAlpha=0.2*(WATER_TOP-y)/WATER_TOP;ctx.fillRect(0,y,W,1);ctx.globalAlpha=1;
    }
    for(let y=WATER_BOTTOM+1;y<H;y++){
      ctx.drawImage(bg,0,2*WATER_BOTTOM+1-y,W,1,0,y,W,1);
      ctx.globalAlpha=0.5*(y-WATER_BOTTOM)/(H-1-WATER_BOTTOM);ctx.fillRect(0,y,W,1);ctx.globalAlpha=1;
    }
    ctx.restore();
  }
  function tank(ctx,s,options) {
    const light=isDay(options)?'day':'night';
    ctx.drawImage(sceneBackground(options),0,0);
    if(s.immersive) immersiveBars(ctx,sceneBackground(options));
    else {
      statusBar(ctx,s);
      clock(ctx,options.time||'14:36');
      text(ctx,(options.date||s.day.replaceAll('-','.'))+' '+(options.weekday||'周五'),120,79,C.muted,'center');
    }
    for(let i=0;i<4;i++) {
      const y=231-((Math.floor(s.age*8)+i*39)%139), x=224+(i%2)*3;
      border(ctx,x,y,3,4,shadeHex('#4b9197',light)); rect(ctx,x,y,1,1,shadeHex('#9bc4b7',light));
    }
    // Back layer first, then the crab on the floor, then the front layer.
    const order=[...s.fish].sort((a,b)=>a.layer-b.layer||!!catalog[b.kind].bottom-!!catalog[a.kind].bottom||a.id-b.id);
    for(const f of order) drawFish(ctx,f,AquaGame.pose(f),f.x,f.y,f.adult?1:0.625,f.layer?light:light+'Far');
    s.pellets.forEach((p,i)=>{
      if(p.delay>0)return;
      // Sinking food sways by a pixel; food on the sand lies still.
      const sway=p.y<AquaGame.SAND?Math.round(Math.sin(s.age*2.4+i*1.7)):0;
      pellet(ctx,p,p.x+sway,light);
    });
    for(const r of s.ripples)ripple(ctx,r,s,light);
    for(const p of s.puffs)puff(ctx,p,s,light);
    grimeLayer(ctx,s,light,grimeStrength(s,s.mode));
    ROWS.forEach((_,lane)=>shine(ctx,s,lane,light));
    return light;
  }
  function cleanOverlay(ctx,s,light) {
    const [y0,y1]=ROWS[s.lane],c=C.accent;
    // Gold corner ticks mark the selected row, matching the selected-button underline.
    for(const [x,dx] of [[GLASS_X0+1,1],[GLASS_X1-2,-1]])for(const [y,dy] of [[y0,1],[y1,-1]]){
      rect(ctx,Math.min(x,x+dx*6),y,7,1,c);rect(ctx,x,Math.min(y,y+dy*6),1,7,c);
    }
    const edge=s.wipe&&s.wipe.lane!==undefined?wipeEdge(s,s.wipe.lane):null;
    if(edge&&edge.t<1)squeegee(ctx,edge.x,ROWS[s.wipe.lane][0],ROWS[s.wipe.lane][1],light);
    else if(looksDirty(s,s.lane))squeegee(ctx,GLASS_X0+14+Math.round(Math.sin(s.age*3)),y0,y1,light);
  }
  // Pixel keycap: 22 px tall, dual drop shadow, bright L / dark L bevel, optional gold bezel when selected.
  // Pressed keys sink 1 px and invert the bevel so they read as recessed.
  const BTN={ fill:'#103a40', edge:'#2a6368', hi:'#4a8f90', mid:'#2f7074', lo:'#071e22',
    shadow:'#020e11', rim:'#0a252a',
    selFill:'#2c6e66', selHi:'#7ec4b0', selMid:'#3f9184', selLo:'#143836',
    downFill:'#0c2e34', downEdge:'#06181c' };
  function button(ctx,x,y,w,label,selected,disabled=false,pressed=false) {
    const h=22,top=y+(pressed?1:0);
    const edge=selected?(disabled?C.muted:C.accent):(pressed?BTN.downEdge:BTN.edge);
    const face=pressed?BTN.downFill:selected?BTN.selFill:BTN.fill;
    const hi=selected?BTN.selHi:BTN.hi, mid=selected?BTN.selMid:BTN.mid, lo=selected?BTN.selLo:BTN.lo;
    if(!pressed){ rect(ctx,x+2,y+h+1,w-4,1,BTN.shadow); rect(ctx,x+1,y+h,w-2,1,BTN.rim); }
    rect(ctx,x+1,top,w-2,1,edge); rect(ctx,x+1,top+h-1,w-2,1,edge);
    rect(ctx,x,top+1,1,h-2,edge); rect(ctx,x+w-1,top+1,1,h-2,edge);
    rect(ctx,x+1,top+1,w-2,h-2,face);
    if(!pressed){
      rect(ctx,x+1,top+1,w-2,1,hi); rect(ctx,x+1,top+1,1,h-2,hi);
      rect(ctx,x+2,top+2,w-4,1,mid);
      rect(ctx,x+w-2,top+2,1,h-3,lo); rect(ctx,x+2,top+h-2,w-3,1,lo);
    } else {
      rect(ctx,x+1,top+1,w-2,1,BTN.lo); rect(ctx,x+1,top+1,1,h-2,BTN.lo);
      rect(ctx,x+w-2,top+2,1,h-3,BTN.mid); rect(ctx,x+2,top+h-2,w-3,1,BTN.mid);
    }
    text(ctx,label,x+w/2,top+5,disabled?C.muted:selected?C.accent:C.pale,'center');
  }
  const pressedNow=s=>s.age-s.pressedAt<AquaGame.PRESS_SECONDS;
  // Top bar: hairline shelf under the title strip, tank count, beveled battery at the right.
  function statusBar(ctx,s) {
    rect(ctx,0,18,240,1,'#1a4a50'); rect(ctx,0,19,240,1,'#061c20');
    text(ctx,`鱼缸 ${s.fish.length}/${AquaGame.MAX_FISH}`,66,4,C.muted);
    if(s.battery<0) return;
    const low=s.battery<=15, frame=low?C.orange:C.muted, ink=low?C.orange:C.pale;
    rect(ctx,213,6,16,8,low?'#3a2010':'#0a2a30');
    border(ctx,213,6,16,8,frame); rect(ctx,229,8,2,4,frame);
    if(!low){ rect(ctx,214,7,14,1,'#3d6f72'); rect(ctx,214,12,14,1,'#061c20'); }
    const juice=Math.max(1,Math.round(s.battery*12/100));
    rect(ctx,215,8,juice,4,ink);
    if(!low) rect(ctx,215,8,juice,1,'#e8f5e0');
    text(ctx,`${s.battery}%`,209,4,frame,'right');
  }
  function panel(ctx,s,options,title) {
    ctx.drawImage(sceneBackground(options),0,0); rect(ctx,6,28,228,228,'#10434d');
    text(ctx,title,120,33,C.pale,'center'); statusBar(ctx,s);
  }
  const pad2=n=>String(n).padStart(2,'0');
  const SOURCES={ wifi:'已联网同步', saved:'接着上次的时间', build:'未对时', manual:'手动设置', flash:'电脑同步', browser:'跟随电脑' };
  function settings(ctx,s,options) {
    panel(ctx,s,options,'设置');
    border(ctx,20,58,200,70,'#2e6b70'); rect(ctx,21,59,198,68,'#134e59');
    const [y,m,d,h,mi]=s.now;
    [['时间',`${y}.${pad2(m)}.${pad2(d)} ${pad2(h)}:${pad2(mi)}`],['对时',SOURCES[s.clockSource]||'未对时'],
      ['电量',s.battery<0?'未知':`${s.battery}%`]].forEach(([k,v],i)=>{
      text(ctx,k,30,66+i*20,C.muted); text(ctx,v,210,66+i*20,C.pale,'right');
    });
    [s.sound?'水声：开':'水声：关','调整时间','返回鱼缸'].forEach((label,i)=>
      button(ctx,20,144+i*32,200,label,s.setting===i,false,s.setting===i&&pressedNow(s)));
    if(s.message&&s.age<s.messageUntil) text(ctx,s.message,120,239,C.accent,'center');
    text(ctx,'长按确定返回鱼缸',120,280,C.muted,'center');
    text(ctx,'上下选择 · 确定执行',120,302,C.muted,'center');
  }
  // Clock editor: date and time as boxed fields, the field being edited outlined in gold.
  function clockEditor(ctx,s,options) {
    panel(ctx,s,options,'调整时间');
    const e=s.clockEdit,v=e.v;
    const field=(i,x,y,str)=>{
      const w=str.length*6+8,on=e.field===i;
      rect(ctx,x,y,w,18,on?BTN.selFill:'#134e59'); border(ctx,x,y,w,18,on?C.accent:'#2e6b70');
      text(ctx,str,x+4,y+3,on?C.accent:C.pale); return x+w;
    };
    let x=field(0,56,84,String(v[0])); text(ctx,'年',x+4,87,C.muted);
    x=field(1,x+20,84,pad2(v[1])); text(ctx,'月',x+4,87,C.muted);
    x=field(2,x+20,84,pad2(v[2])); text(ctx,'日',x+4,87,C.muted);
    x=field(3,93,124,pad2(v[3])); text(ctx,':',x+4,127,C.muted); field(4,x+14,124,pad2(v[4]));
    text(ctx,'上下改数字 · 确定下一项',120,170,C.pale,'center');
    text(ctx,'改完分钟再按确定保存',120,190,C.muted,'center');
    text(ctx,`第 ${e.field+1}/${AquaGame.CLOCK_FIELDS} 项`,120,230,C.accent,'center');
    text(ctx,'长按确定取消',120,280,C.muted,'center');
  }
  function selection(ctx,s,options) {
    panel(ctx,s,options,s.mode==='size'?'选择大小':'选择伙伴');
    border(ctx,20,58,200,133,'#2e6b70');
    rect(ctx,21,59,198,131,'#134e59');
    const size=s.mode==='size'?(s.adultChoice?1.5:1):1.5,cycle=Math.floor(s.age*6)%4;
    drawFish(ctx,{kind:s.choice,adult:true,direction:1},{role:catalog[s.choice].bottom?'walk':'swim',frame:cycle},120,110,size);
    text(ctx,catalog[s.choice].name,120,156,C.accent,'center');
    text(ctx,catalog[s.choice].trait,120,170,C.muted,'center');
    if(s.mode==='size') {
      button(ctx,24,211,88,catalog[s.choice].bottom?'幼蟹':'幼鱼',!s.adultChoice); button(ctx,128,211,88,catalog[s.choice].bottom?'成蟹':'成鱼',s.adultChoice);
      text(ctx,catalog[s.choice].bottom?'沿着缸底慢慢爬行':s.adultChoice?'入住就能看大鱼':'喂食后慢慢长大',120,245,C.pale,'center');
    } else {
      [-1,0,1].forEach((delta,slot)=>{
        const i=(s.choice+delta+catalog.length)%catalog.length,kind=catalog[i];
        if(delta===0){rect(ctx,12+slot*76,204,65,48,'#285f61');border(ctx,12+slot*76,204,65,48,C.accent);}
        drawFish(ctx,{kind:i,adult:false,direction:1},{role:kind.bottom?'walk':'swim',frame:0},44+slot*76,220,0.625);
        text(ctx,kind.name,44+slot*76,237,delta===0?C.accent:C.muted,'center');
      });
      text(ctx,`${s.choice+1} / ${catalog.length}`,120,53,C.muted,'center');

    }
    const full=s.fish.length>=AquaGame.MAX_FISH;
    button(ctx,20,271,200,full?'鱼缸已满':s.mode==='size'?'放入鱼缸':'下一步：选择大小',true,full,pressedNow(s));
    text(ctx,'上下切换 · 确定选择',120,302,C.muted,'center');
  }
  function render(canvas,s,options={}) {
    const ctx=canvas.getContext('2d'); ctx.imageSmoothingEnabled=false;
    if(s.mode==='select'||s.mode==='size') selection(ctx,s,options);
    else if(s.mode==='settings') settings(ctx,s,options);
    else if(s.mode==='clock') clockEditor(ctx,s,options);
    else {
      const light=tank(ctx,s,options);
      if(s.immersive) return;
      if(s.mode==='clean') {
        cleanOverlay(ctx,s,light);
        const cleaned=s.dirt.filter(d=>d.clean).length;
        text(ctx,`已擦 ${cleaned}/${AquaGame.ROWS}`,10,280,C.accent);
        text(ctx,`水质 ${Math.round(s.water)}%`,230,280,C.pale,'right');
        text(ctx,'上下选行 · 确定擦一下',120,302,C.muted,'center');
      } else {
        rect(ctx,9,273,222,1,'#3d6f72'); rect(ctx,9,274,222,1,'#0a252a');
        text(ctx,`水质 ${Math.round(s.water)}%`,10,278,s.water<60?C.accent:C.pale);
        rect(ctx,121,277,1,12,'#35615e');
        text(ctx,`喂食 ${s.fed}/2`,230,278,s.fed===2?C.accent:C.pale,'right');
        // Recessed tray under the four keys, then the keys themselves (51 px + 6 px gaps).
        rect(ctx,7,293,226,25,'#0a282e'); rect(ctx,8,294,224,1,'#1f555a');
        [s.fed===2?'已喂饱':'喂食','擦缸','选鱼','设置'].forEach((name,i)=>
          button(ctx,9+i*57,295,51,name,s.selected===i,i===0&&s.fed===2,s.selected===i&&pressedNow(s)));
      }
      if(s.message && s.age<s.messageUntil) {
        rect(ctx,9,250,222,18,'#153e43'); text(ctx,s.message,120,254,C.paper,'center');
      } else if(s.stamped&&s.age<s.stampUntil) {
        text(ctx,`照料章 +1  累计 ${s.careDays}`,120,254,C.accent,'center');
      }
    }
  }
  function scenario(name) {
    const s=AquaGame.create('2026-11-06');
    s.battery=76;
    if(name==='select') { s.mode='select'; s.choice=1; }
    if(name==='settings') { s.clockSource='wifi'; s.selected=3; AquaGame.press(s,'ok'); AquaGame.press(s,'down'); }
    if(name==='clock') {
      s.selected=3; AquaGame.press(s,'ok'); AquaGame.press(s,'down'); AquaGame.press(s,'ok');
      AquaGame.press(s,'ok'); AquaGame.press(s,'ok'); AquaGame.press(s,'ok'); AquaGame.press(s,'up');
    }
    if(name==='feed') {
      s.fed=1; AquaGame.press(s,'ok');
      for(let i=0;i<14;i++) AquaGame.update(s,1/12);
      s.message='今天吃饱啦，明天再喂'; s.messageUntil=s.age+20;
    }
    if(name==='clean') {
      s.selected=1; AquaGame.press(s,'ok'); AquaGame.press(s,'ok');
      for(let i=0;i<20;i++) AquaGame.update(s,1/12);
      AquaGame.press(s,'ok');
      for(let i=0;i<4;i++) AquaGame.update(s,1/12);
      s.message='';
    }
    if(name==='immersive') {
      for(let i=0;i<AquaGame.IDLE_SECONDS*12+24;i++) AquaGame.update(s,1/12);
    }
    s.pressedAt=-9;
    return s;
  }
  root.AquaRender={ ready, render, scenario, background, nightBackground, sprites, SIZES, glyphs, text, makeCanvas, W,H,SW,SH };
})(globalThis);

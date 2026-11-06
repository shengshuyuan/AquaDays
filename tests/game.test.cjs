const assert=require('node:assert/strict');
const G=require('../prototype/game.js');
let checks=0;
function test(name,fn){fn();checks++;console.log(`PASS ${name}`);}
function eat(s){for(let i=0;i<2400&&s.pellets.length;i++)G.update(s,1/12);assert.equal(s.pellets.length,0,'fish must finish their portion');}
test('daylight starts at 07:00 and ends at 18:00',()=>{
  for(const [hour,expected] of [[0,false],[6+59/60,false],[7,true],[12,true],[17+59/60,true],[18,false],[23+59/60,false]])assert.equal(G.isDaytime(hour),expected);
});
test('feed limit: two portions, third has no effect',()=>{
  const s=G.create('2026-11-06');G.press(s,'ok');
  const n=s.pellets.length;G.press(s,'ok');assert.equal(s.fed,1);assert.equal(s.pellets.length,n);
  eat(s);G.press(s,'ok');eat(s);const water=s.water;
  G.press(s,'ok');assert.equal(s.fed,2);assert.equal(s.pellets.length,0);assert.equal(s.water,water);
});
test('daily reset is forward-only; clock rollback cannot refill quota',()=>{
  const s=G.create('2026-11-06');s.fed=2;
  assert.equal(G.nextDay(s,'2026-11-06'),false);assert.equal(G.nextDay(s,'2026-11-05'),false);assert.equal(s.fed,2);
  assert.equal(G.nextDay(s,'2026-11-07'),true);assert.equal(s.fed,0);
  assert.throws(()=>G.nextDay(s,'2026-02-30'));assert.throws(()=>G.create('unknown'));
});
test('all eight species can be selected, size chosen, and tank cap enforced',()=>{
  assert.equal(G.catalog.length,8);assert.equal(new Set(G.catalog.map(f=>f.id)).size,8);
  for(let kind=0;kind<G.catalog.length;kind++){
    const s=G.create('2026-11-06');assert.equal(s.fish.length,7);
    G.press(s,'up');G.press(s,'up');assert.equal(s.selected,2);G.press(s,'ok');
    for(let i=0;i<kind;i++)G.press(s,'down');
    G.press(s,'ok');assert.equal(s.mode,'size');
    if(kind%2)G.press(s,'down');G.press(s,'ok');
    assert.equal(s.fish.at(-1).kind,kind);assert.equal(s.fish.at(-1).adult,!!(kind%2));
    assert.equal(s.fish.length,G.MAX_FISH);
    G.press(s,'ok');G.press(s,'ok');assert.equal(s.mode,'select');assert.equal(s.fish.length,G.MAX_FISH);
    G.press(s,'back');assert.equal(s.mode,'home');
  }
});
test('three glass rows: three presses clean the tank; daily care reward cannot be farmed',()=>{
  const s=G.create('2026-11-06');G.press(s,'ok');s.selected=1;G.press(s,'ok');
  assert.equal(s.dirt.length,G.ROWS);assert.equal(s.lane,0);
  G.press(s,'ok');assert.equal(s.lane,1,'cursor moves on to the next dirty row');assert.equal(s.wipe.lane,0);
  G.press(s,'up');G.press(s,'ok');assert.equal(s.dirt.filter(d=>d.clean).length,1,'a clean row cannot be wiped again');
  G.press(s,'down');G.press(s,'ok');G.press(s,'ok');
  assert.equal(s.water,100);assert(s.dirt.every(d=>d.clean));assert.equal(s.careDays,1);
  G.press(s,'ok');G.press(s,'back');G.press(s,'ok');assert.equal(s.careDays,1);assert.equal(s.mode,'home');
  for(let i=0;i<30;i++)G.update(s,1/12);assert.equal(s.wipe,null,'wipe animation expires');
});
test('care stamp line shows for ten seconds; idle hides the HUD and the waking key does nothing else',()=>{
  const s=G.create('2026-11-06');s.water=95;G.press(s,'ok');
  assert(s.stamped);assert.equal(s.stampUntil,s.age+G.STAMP_SECONDS);
  for(let i=0;i<G.STAMP_SECONDS*12+1;i++)G.update(s,1/12);
  assert(s.age>s.stampUntil,'stamp line must expire after ten seconds');
  s.selected=1;G.press(s,'ok');assert.equal(s.mode,'clean');
  for(let i=0;i<G.IDLE_SECONDS*12-24;i++)G.update(s,1/12);
  assert.equal(s.immersive,false,'HUD must stay up before three idle minutes');
  for(let i=0;i<48;i++)G.update(s,1/12);
  assert.equal(s.immersive,true);assert.equal(s.mode,'home','idle leaves clean mode for the tank view');
  const fed=s.fed,selected=s.selected;G.press(s,'ok');
  assert.equal(s.immersive,false);assert.equal(s.fed,fed);assert.equal(s.selected,selected);assert.equal(s.mode,'home');
  G.press(s,'down');assert.equal(s.selected,(selected+1)%G.HOME_BUTTONS,'keys work normally once the HUD is back');
});
test('water sound is off by default, toggles from the fourth button, and food splashes count plops',()=>{
  const s=G.create('2026-11-06');assert.equal(s.sound,false);assert.equal(G.HOME_BUTTONS,4);
  G.press(s,'up');assert.equal(s.selected,3,'up from feed wraps to the sound button');
  G.press(s,'ok');assert.equal(s.sound,true);assert.equal(s.message,'水声已打开');
  G.press(s,'ok');assert.equal(s.sound,false);assert.equal(s.message,'水声已关闭');assert.equal(s.fed,0);assert.equal(s.mode,'home');
  G.press(s,'down');G.press(s,'ok');assert.equal(s.fed,1);
  for(let i=0;i<24;i++)G.update(s,1/12);
  assert(s.plops>=2&&s.plops<G.create('2026-11-06').fish.length*2,'a pinch makes a few splashes, not one per pellet');
});
test('a portion is sprinkled at the surface, slows as it sinks, and rests on the sand',()=>{
  const s=G.create('2026-11-06');s.fish.forEach(f=>{f.tx=f.x;});G.press(s,'ok');
  const xs=s.pellets.map(p=>p.x);assert(Math.max(...xs)-Math.min(...xs)<=42,'food lands in one pinch, not a line');
  assert(s.pellets.every(p=>p.y===G.SURFACE&&p.delay>0));
  const p=s.pellets[0];let entered=false,ripples=0;
  for(let i=0;i<12&&!entered;i++){G.update(s,1/12);entered=p.delay<=0;ripples=Math.max(ripples,s.ripples.length);}
  assert(entered&&ripples>0,'entry makes a ripple');
  const first=p.vy;for(let i=0;i<24;i++)G.update(s,1/12);assert(p.vy<first,'food slows to a sink speed');
  const t=G.create('2026-11-06');t.fish=t.fish.slice(0,1);t.fish[0].x=40;t.fish[0].y=120;G.press(t,'ok');
  t.fish[0].pauseUntil=1e9;const far=t.pellets[0];far.target=99;
  for(let i=0;i<12*20;i++)G.update(t,1/12);assert.equal(far.y,G.SAND,'uneaten food settles on the sand');
  let puffed=false;for(let i=0;i<2400&&s.pellets.length;i++){G.update(s,1/12);puffed ||= s.puffs.length>0;}
  assert.equal(s.pellets.length,0);assert(puffed,'eating leaves a crumb puff');
});
test('juvenile grows from eaten food, adults do not grow without bounds',()=>{
  const s=G.create('2026-11-06'), juvenile=s.fish[2];juvenile.growth=22;
  G.press(s,'ok');eat(s);assert.equal(juvenile.adult,true);assert.equal(juvenile.growth,24);
  G.press(s,'ok');eat(s);assert.equal(juvenile.growth,24);
});
test('simulation is deterministic and respects clock and tank boundaries',()=>{
  const a=G.create('2026-11-06'), b=G.create('2026-11-06');
  for(let i=0;i<4000;i++){G.update(a,1/12);G.update(b,1/12);}
  assert.deepEqual(a,b);
  for(const f of a.fish){assert(Number.isFinite(f.x)&&Number.isFinite(f.y));assert(f.x>=36&&f.x<=204);assert(G.catalog[f.kind].bottom ? f.y>=247&&f.y<=251 : f.y>=116&&f.y<=226);}
  const age=a.age;G.update(a,NaN);G.update(a,-1);assert.equal(a.age,age);
});
test('crab stays on the floor, pauses, moves, and eats settled food',()=>{
  const s=G.create('2026-11-06'),c=s.fish.find(f=>G.catalog[f.kind].bottom);
  let moved=false,paused=false,last=c.x;
  for(let i=0;i<1200;i++){G.update(s,1/12);assert(c.y>=247&&c.y<=251);moved ||= Math.abs(c.x-last)>0.1;paused ||= Math.abs(c.vx)<0.1;last=c.x;}
  assert(moved&&paused);G.press(s,'ok');eat(s);
});
test('crab walks sideways without mirroring and steps with distance, not time',()=>{
  const s=G.create('2026-11-06'),c=s.fish.find(f=>G.catalog[f.kind].bottom),seen=new Set();
  for(let i=0;i<2400;i++){
    const stride=c.stride,frame=G.pose(c).frame;G.update(s,1/12);
    assert.equal(c.direction,1,'crab must not flip');assert(c.stride>=stride);
    if(Math.abs(c.vx)<=0.4)assert.equal(G.pose(c).frame,0,'standing crab keeps its feet planted');
    else if(c.stride===stride)assert.equal(G.pose(c).frame,frame);
    seen.add(G.pose(c).frame);
  }
  assert.deepEqual([...seen].sort(),[0,1,2,3]);
});
function swimmers(s){return s.fish.filter(f=>!G.catalog[f.kind].bottom);}
test('fish keep their distance within a layer and swim mostly level',()=>{
  const s=G.create('2026-11-06');let pairs=0,overlap=0,vx=0,vy=0;
  for(let i=0;i<12*300;i++){
    G.update(s,1/12);const list=swimmers(s);
    for(let a=0;a<list.length;a++)for(let b=a+1;b<list.length;b++){
      if(list[a].layer!==list[b].layer)continue;pairs++;
      if(Math.abs(list[a].x-list[b].x)<26&&Math.abs(list[a].y-list[b].y)<14)overlap++;
    }
    for(const f of list){vx+=Math.abs(f.vx);vy+=Math.abs(f.vy);}
  }
  assert(overlap/pairs<0.03,`same-layer bodies overlap ${(100*overlap/pairs).toFixed(1)}% of the time`);
  assert(vy/vx<0.5,'vertical travel must stay well below horizontal');
});
test('fish turn through squashed frames, rarely, and never dart backwards',()=>{
  const s=G.create('2026-11-06');let flips=0,backward=0,samples=0,poses=new Set();
  for(let i=0;i<12*300;i++){
    if(i===1200)G.press(s,'ok');
    const before=swimmers(s).map(f=>f.direction);G.update(s,1/12);
    swimmers(s).forEach((f,k)=>{
      if(f.direction!==before[k]){flips++;assert(f.turn>0&&G.pose(f).role==='turn','a fish may only flip mid-turn');}
      samples++;if(Math.abs(f.vx)>3&&Math.sign(f.vx)!==f.direction)backward++;
      const p=G.pose(f);poses.add(p.role+p.frame);
    });
  }
  assert(flips/swimmers(s).length/5<=8,'turns per fish per minute');
  assert(backward/samples<0.01,'fish swam backwards at speed');
  for(const p of ['swim0','swim1','swim2','swim3','turn0','turn1'])assert(poses.has(p),`pose ${p} never shown`);
});
test('tail beats faster when swimming fast and pitch follows climb or dive',()=>{
  const s=G.create('2026-11-06'),f=s.fish[0];
  const rate=(vx,vy)=>{f.vx=vx;f.vy=vy;f.tx=f.x+vx;f.ty=f.y+vy;f.pauseUntil=0;const p=f.phase;G.update(s,1/120);return (f.phase-p+2*Math.PI)%(2*Math.PI);};
  assert(rate(20,0)>rate(0.1,0)*1.5);
  f.pitch=0;for(let i=0;i<24;i++){f.ty=f.y-60;f.tx=f.x+f.direction*40;f.nextTurn=s.age+9;G.update(s,1/12);}
  assert(f.pitch<0,'climbing fish tilts head up');assert(Math.abs(f.pitch)<=0.6);
});
test('lighting shades: night darker than day, far layer darker than near',()=>{
  const lum=(name,c=[200,150,100])=>{const {mul,add}=G.SHADES[name];return c.reduce((t,v,i)=>t+Math.min(255,v*mul[i]+add[i]),0);};
  assert(lum('day')>lum('dayFar'));assert(lum('dayFar')>lum('night'));assert(lum('night')>lum('nightFar'));
});
test('pixel font covers every on-device message and weekday',()=>{
  const fs=require('node:fs'),path=require('node:path');require('../prototype/pixel-font.js');
  const source=['game.js','render.js'].map(n=>fs.readFileSync(path.join(__dirname,'../prototype',n),'utf8')).join('')+'周日一二三四五六';
  for(const ch of source)if(ch.codePointAt(0)>127&&!/\s/.test(ch))assert(AquaPixelFont[ch],`Missing glyph ${ch}`);
  for(const [ch,g] of Object.entries(AquaPixelFont)){
    assert.equal(g.rows.length,12);assert([6,12].includes(g.width));
    if(ch!==' ')assert(g.rows.some(r=>r!==0),`Blank glyph ${ch}`);
  }
});
test('exported device assets have valid strides, alpha planes, and exact byte sizes',()=>{
  const fs=require('node:fs'),path=require('node:path'),dir=path.join(__dirname,'../prototype/assets');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),audit=JSON.parse(fs.readFileSync(path.join(dir,'resource-audit.json')));
  const bg=fs.readFileSync(path.join(dir,'background.rgb565')),sprites=fs.readFileSync(path.join(dir,'fish.rgb565a8')),font=fs.readFileSync(path.join(dir,'font-1bpp.bin'));
  assert.equal(bg.length,240*320*2);
  // Swimmers: 4 swim + 2 turn at tank sizes, 4 swim at preview size; crab: 4 walk at every size. All face right.
  const swimmers=G.catalog.filter(k=>!k.bottom).length,crabs=G.catalog.length-swimmers;
  assert.equal(manifest.sprites.frames.length,swimmers*(6+6+4)+crabs*12);
  assert.deepEqual(manifest.sprites.runtime.shades,G.SHADES);assert.equal(manifest.sprites.runtime.pitchShear.perPixel,G.MOTION.PITCH_SHEAR);
  for(const kind of G.catalog)for(const size of [0.625,1,1.5]){
    const list=manifest.sprites.frames.filter(f=>f.species===kind.id&&f.size===size),role=kind.bottom?'walk':'swim';
    assert.deepEqual(list.filter(f=>f.role===role).map(f=>f.frame),[0,1,2,3]);
    assert.equal(list.filter(f=>f.role==='turn').length,kind.bottom||size===1.5?0:2);
  }
  let offset=0;
  for(const f of manifest.sprites.frames){
    assert(!('direction' in f),'mirrored copies are produced at blit time');
    assert.equal(f.offset,offset);assert.equal(f.stride,f.width*2);assert.equal(f.length,f.width*f.height*3);offset+=f.length;
    const alpha=sprites.subarray(f.offset+f.width*f.height*2,f.offset+f.length);assert(alpha.includes(0));assert(alpha.includes(255));assert(alpha.some(a=>a>0&&a<255),'fin transparency must be preserved');
  }
  assert.equal(offset,sprites.length);
  for(const g of manifest.font.glyphs)assert(g.offset+g.length<=font.length);
  assert.equal(audit.totalBitmapBytes,bg.length+fs.statSync(path.join(dir,'background-night.rgb565')).size+sprites.length+font.length);
  assert(audit.totalBitmapBytes<2000*1024);assert.equal(audit.targetDisplayBufferBytes,9600);
});
console.log(`${checks} checks passed`);

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
    G.press(s,'up');G.press(s,'ok');
    for(let i=0;i<kind;i++)G.press(s,'down');
    G.press(s,'ok');assert.equal(s.mode,'size');
    if(kind%2)G.press(s,'down');G.press(s,'ok');
    assert.equal(s.fish.at(-1).kind,kind);assert.equal(s.fish.at(-1).adult,!!(kind%2));
    assert.equal(s.fish.length,G.MAX_FISH);
    G.press(s,'ok');G.press(s,'ok');assert.equal(s.mode,'select');assert.equal(s.fish.length,G.MAX_FISH);
    G.press(s,'back');assert.equal(s.mode,'home');
  }
});
test('nine algae patches clean once; daily care reward cannot be farmed',()=>{
  const s=G.create('2026-11-06');G.press(s,'ok');s.selected=1;G.press(s,'ok');
  for(let lane=0;lane<3;lane++){for(let i=0;i<3;i++)G.press(s,'ok');G.press(s,'down');}
  assert.equal(s.water,100);assert(s.dirt.every(d=>d.clean));assert.equal(s.careDays,1);
  G.press(s,'ok');G.press(s,'back');G.press(s,'ok');assert.equal(s.careDays,1);assert.equal(s.mode,'home');
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
  assert.equal(bg.length,240*320*2);assert.equal(manifest.sprites.frames.length,G.catalog.length*3*2*3);
  let offset=0;
  for(const f of manifest.sprites.frames){
    assert.equal(f.offset,offset);assert.equal(f.stride,f.width*2);assert.equal(f.length,f.width*f.height*3);offset+=f.length;
    const alpha=sprites.subarray(f.offset+f.width*f.height*2,f.offset+f.length);assert(alpha.includes(0));assert(alpha.includes(255));assert(alpha.some(a=>a>0&&a<255),'fin transparency must be preserved');
  }
  assert.equal(offset,sprites.length);
  for(const g of manifest.font.glyphs)assert(g.offset+g.length<=font.length);
  assert.equal(audit.totalBitmapBytes,bg.length+fs.statSync(path.join(dir,'background-night.rgb565')).size+sprites.length+font.length);
  assert(audit.totalBitmapBytes<2000*1024);assert.equal(audit.targetDisplayBufferBytes,9600);
});
console.log(`${checks} checks passed`);

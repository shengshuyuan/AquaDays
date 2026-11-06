/* Design tooling: exports use exactly the same renderer as the live preview. */
(() => {
  'use strict';
  const R=AquaRender, G=AquaGame;
  function base64(bytes) {
    let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(raw);
  }
  function pixels(canvas,alpha=false) {
    const {width:w,height:h}=canvas, data=canvas.getContext('2d').getImageData(0,0,w,h).data;
    const out=new Uint8Array(w*h*(alpha?3:2));
    for(let i=0;i<w*h;i++) {
      const p=i*4, word=((data[p]>>3)<<11)|((data[p+1]>>2)<<5)|(data[p+2]>>3);
      out[i*2]=word&255;out[i*2+1]=word>>8;
      if(alpha)out[w*h*2+i]=data[p+3];
    }
    return out;
  }
  function enlarged(source,scale) {
    const c=R.makeCanvas(source.width*scale,source.height*scale),ctx=c.getContext('2d');
    ctx.imageSmoothingEnabled=false;ctx.drawImage(source,0,0,c.width,c.height);return c;
  }
  function collect() {
    const images={}, scenes={};
    for(const name of ['home','select','feed','clean']) {
      const c=R.makeCanvas(240,320);R.render(c,R.scenario(name));scenes[name]=c;images[`${name}-240.png`]=c.toDataURL();
    }
    const night=R.makeCanvas(240,320);R.render(night,R.scenario('home'),{time:'18:00'});images['night-240.png']=night.toDataURL();
    images['night-3x.png']=enlarged(night,3).toDataURL();
    images['home-3x.png']=enlarged(scenes.home,3).toDataURL();
    const board=R.makeCanvas(1152,568),ctx=board.getContext('2d');
    ctx.fillStyle='#f4f2e9';ctx.fillRect(0,0,board.width,board.height);
    ctx.fillStyle='#233b35';ctx.font='32px Georgia';ctx.fillText('AquaDays',32,46);
    ctx.font='16px sans-serif';ctx.fillText('一缸时光 · 像素交互稿',228,44);
    ctx.fillStyle='#677a71';ctx.font='12px sans-serif';ctx.fillText('每个页面严格为 240 × 320 像素 / 静态水景与动态鱼精灵合成 / RGB565 配色',32,75);
    const labels=['01 / 日常鱼缸','02 / 自由选鱼','03 / 每天两份','04 / 分区擦缸'];
    const captions=[['七种鱼可选，螃蟹沿缸底爬行。','时间与日期放在后景留白区。'],['真实金鱼品种，轮廓各有区别。','可以选幼鱼，也可以选成鱼。'],['鱼儿会追着食物游过来。','当天达到上限就停止投喂。'],['上下换区，确定擦除藻点。','清洁后水质恢复，获得照料章。']];
    ['home','select','feed','clean'].forEach((name,i)=>{
      const x=32+i*280;ctx.fillStyle='#233b35';ctx.font='13px sans-serif';ctx.fillText(labels[i],x,113);
      ctx.drawImage(scenes[name],x,127);ctx.fillStyle='#677a71';ctx.font='12px sans-serif';
      captions[i].forEach((t,j)=>ctx.fillText(t,x,473+j*21));
    });
    ctx.fillStyle='#677a71';ctx.font='11px sans-serif';ctx.fillText('可操作的浏览器原型；固件构建、真机帧率与功耗尚未验证。',32,543);
    images['aquadays-refine-v4-board.png']=board.toDataURL();
    const chunks=[],frames=[];let offset=0;
    for(let kind=0;kind<G.catalog.length;kind++)for(let size of [0.625,1,1.5])for(let direction of [1,-1])for(let frame=0;frame<3;frame++) {
      const factor=G.catalog[kind].bottom?0.75:G.catalog[kind].id==='guppy'?0.8:1;
      const c=R.makeCanvas(Math.round(R.SW*size*factor),Math.round(R.SH*size*factor)),x=c.getContext('2d');x.imageSmoothingEnabled=false;
      if(direction<0){x.translate(c.width,0);x.scale(-1,1);}
      x.drawImage(R.sprites[kind][frame],0,0,c.width,c.height);
      const bytes=pixels(c,true);chunks.push(bytes);
      frames.push({species:G.catalog[kind].id,size,direction,frame,width:c.width,height:c.height,offset,length:bytes.length,stride:c.width*2});offset+=bytes.length;
    }
    const spriteData=new Uint8Array(offset);let pos=0;
    chunks.forEach(chunk=>{spriteData.set(chunk,pos);pos+=chunk.length;});
    const font=[],glyphs=[];
    for(const [ch,g] of Object.entries(AquaPixelFont)) {
      const bits=g.rows.flatMap(row=>Array.from({length:g.width},(_,x)=>(row>>x)&1));
      const start=font.length;
      for(let i=0;i<bits.length;i+=8){let byte=0;for(let j=0;j<8;j++)byte|=(bits[i+j]||0)<<j;font.push(byte);}
      glyphs.push({char:ch,codepoint:ch.codePointAt(0),width:g.width,height:12,offset:start,length:font.length-start});
    }
    const fontData=new Uint8Array(font),background=pixels(R.background),nightBackground=pixels(R.nightBackground);
    const audit={backgroundBytes:background.length,nightBackgroundBytes:nightBackground.length,spriteBytes:spriteData.length,fontBitmapBytes:fontData.length,
      totalBitmapBytes:background.length+nightBackground.length+spriteData.length+fontData.length,glyphCount:glyphs.length,
      spriteFrames:frames.length,targetDisplayBufferBytes:240*20*2,
      note:'Flash asset sizes, not measured firmware heap or frame rate. Adult/juvenile/catalogue and mirrored fish are pre-baked; no runtime image scaling needed.'};
    return {images,files:{'background.rgb565':base64(background),'background-night.rgb565':base64(nightBackground),'fish.rgb565a8':base64(spriteData),'font-1bpp.bin':base64(fontData)},
      manifest:{byteOrder:'little-endian',background:{width:240,height:320,stride:480,format:'RGB565'},lighting:{timeZone:'Asia/Shanghai',dayStartHour:7,nightStartHour:18,nightBackground:'background-night.rgb565'},sprites:{format:'RGB565A8',layout:'each frame: packed RGB565 plane, then A8 plane',frames},font:{bitOrder:'LSB-first, contiguous pixels per glyph',glyphs}},audit};
  }
  function animation() {
    const c=R.makeCanvas(240,320),s=G.create('2026-11-06'),frames=[];
    for(let i=0;i<144;i++) {
      if(i===18)G.press(s,'ok');G.update(s,1/12);R.render(c,s);frames.push(c.toDataURL());
    }
    return frames;
  }
  document.querySelector('#export').addEventListener('click',async()=>{
    await R.ready;
    const url=URL.createObjectURL(new Blob([JSON.stringify(collect())],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='aquadays-v4-export.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.AquaExport={collect,animation};
})();

const fs=require('fs');const p=require('path');const d=p.join(__dirname,'appPackage');
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const ct=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;ct[n]=c;}
function crc(b){let c=-1;for(let i=0;i<b.length;i++)c=ct[(c^b[i])&0xff]^(c>>>8);return(c^-1)>>>0;}
function mk(t,data){const l=Buffer.alloc(4);l.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(t),data]);const cb=Buffer.alloc(4);cb.writeUInt32BE(crc(td));return Buffer.concat([l,td,cb]);}
const zlib=require('zlib');
function zs(r){return zlib.deflateSync(r,{level:9});}

function lerp(a,b,t){return Math.round(a+(b-a)*t);}

// 192x192 color icon — circular word-cloud inspired Change Management icon
// Teal/green center circle with surrounding keyword ring
const W=192,H=192;
const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=2; // RGB
const rs=1+W*3,raw=Buffer.alloc(rs*H);
const cx=W/2,cy=H/2,outerR=88,innerR=52;

for(let y=0;y<H;y++){const o=y*rs;for(let x=0;x<W;x++){const px=o+1+x*3;
  const dx=x-cx,dy=y-cy,dist=Math.sqrt(dx*dx+dy*dy);
  let r=255,g=255,b=255; // white background

  if(dist<=outerR && dist>=innerR){
    // Ring — gradient teal/green/orange segments like a word cloud
    const angle=Math.atan2(dy,dx)+Math.PI; // 0..2PI
    const seg=angle/(2*Math.PI);
    if(seg<0.15){r=0;g=150;b=136;} // teal
    else if(seg<0.3){r=76;g=175;b=80;} // green
    else if(seg<0.45){r=255;g=152;b=0;} // orange
    else if(seg<0.6){r=33;g=150;b=243;} // blue
    else if(seg<0.75){r=156;g=39;b=176;} // purple
    else if(seg<0.9){r=244;g=67;b=54;} // red
    else {r=0;g=188;b=212;} // cyan
    // soft anti-alias edges
    const edgeOuter=outerR-dist, edgeInner=dist-innerR;
    if(edgeOuter<2){const t=edgeOuter/2; r=lerp(255,r,t);g=lerp(255,g,t);b=lerp(255,b,t);}
    if(edgeInner<2){const t=edgeInner/2; r=lerp(255,r,t);g=lerp(255,g,t);b=lerp(255,b,t);}
  } else if(dist<innerR){
    // Center circle — light teal
    r=0;g=150;b=136;
    if(innerR-dist<2){const t=(innerR-dist)/2;r=lerp(255,0,t);g=lerp(255,150,t);b=lerp(255,136,t);}
  }
  raw[px]=r;raw[px+1]=g;raw[px+2]=b;
}}
if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});
fs.writeFileSync(p.join(d,'color.png'),Buffer.concat([sig,mk('IHDR',ih),mk('IDAT',zs(raw)),mk('IEND',Buffer.alloc(0))]));

// 32x32 outline
const OW=32,OH=32;const oi=Buffer.alloc(13);oi.writeUInt32BE(OW,0);oi.writeUInt32BE(OH,4);oi[8]=8;oi[9]=6;
const ors=1+OW*4,or2=Buffer.alloc(ors*OH);
const ocx=OW/2,ocy=OH/2,oor=14,oir=9;
for(let y=0;y<OH;y++){const o=y*ors;for(let x=0;x<OW;x++){const px=o+1+x*4;
  const dx=x-ocx,dy=y-ocy,dist=Math.sqrt(dx*dx+dy*dy);
  let a=0;
  if(dist<=oor && dist>=oir){
    a=255;
    const edgeOuter=oor-dist, edgeInner=dist-oir;
    if(edgeOuter<1)a=Math.round(255*edgeOuter);
    if(edgeInner<1)a=Math.round(255*edgeInner);
  } else if(dist<oir){
    a=255;
    if(oir-dist<1)a=Math.round(255*(oir-dist));
  }
  // Outline icon must be white + transparency only (Teams requirement)
  or2[px]=0xFF;or2[px+1]=0xFF;or2[px+2]=0xFF;or2[px+3]=a;
}}
fs.writeFileSync(p.join(d,'outline.png'),Buffer.concat([sig,mk('IHDR',oi),mk('IDAT',zs(or2)),mk('IEND',Buffer.alloc(0))]));
console.log('Change Management icons generated in appPackage/');

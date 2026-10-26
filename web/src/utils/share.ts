export function shareLink(origin:string,pathname:string,webOnly=false) {
  const url=new URL(origin);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use an HTTP or HTTPS address.');
  url.pathname=webOnly?'/app':/^\/(?:watch|title)\/[1-9]\d*$/.test(pathname)?pathname:'/';
  url.search='';url.hash='';
  return url.href;
}
export async function shareQr(url:string) {
  if(url.length>2000)throw new Error('The link is too long for a QR code.');
  const image=new Image();image.src='/virelo-icon-192.png?v=transparent-1';
  const [{default:qrcode},logo]=await Promise.all([import('qrcode-generator'),image.decode().then(()=>image,()=>null)]);
  const code=qrcode(0,'H');code.addData(url);code.make();
  const count=code.getModuleCount(),cell=12,margin=4;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=(count+margin*2)*cell;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('QR rendering is unavailable.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  const dark=(row:number,col:number)=>row>=0&&col>=0&&row<count&&col<count&&code.isDark(row,col);
  const rounded=(x:number,y:number,width:number,height:number,radius:number|number[],color:string)=>{
    ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,width,height,radius);ctx.fill();
  };
  const ink='#17141c';
  for(let row=0;row<count;row++)for(let col=0;col<count;col++){
    if(!dark(row,col)||(row<7&&(col<7||col>=count-7))||(col<7&&row>=count-7))continue;
    const up=dark(row-1,col),down=dark(row+1,col),left=dark(row,col-1),right=dark(row,col+1),radius=cell*.42;
    rounded((col+margin)*cell,(row+margin)*cell,cell,cell,
      [!up&&!left?radius:0,!up&&!right?radius:0,!down&&!right?radius:0,!down&&!left?radius:0],ink);
  }
  for(const [col,row] of [[0,0],[count-7,0],[0,count-7]]){
    const x=(col+margin)*cell,y=(row+margin)*cell;
    rounded(x,y,7*cell,7*cell,1.6*cell,ink);
    rounded(x+cell,y+cell,5*cell,5*cell,cell,'#ffffff');
    rounded(x+2*cell,y+2*cell,3*cell,3*cell,.7*cell,ink);
  }
  if(logo){
    // Clear only the logo silhouette, not a rectangular badge; keep the outer quiet zone intact.
    const size=Math.round(count*.26)*cell,x=(canvas.width-size)/2,edge=cell*.22;
    const mask=document.createElement('canvas');mask.width=mask.height=size;
    const shape=mask.getContext('2d');if(!shape)throw new Error('QR logo rendering is unavailable.');
    shape.drawImage(logo,0,0,size,size);shape.globalCompositeOperation='source-in';
    shape.fillStyle='#ffffff';shape.fillRect(0,0,size,size);
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])ctx.drawImage(mask,x+dx*edge,x+dy*edge);
    ctx.drawImage(logo,x,x,size,size);
  }
  return canvas.toDataURL('image/png');
}

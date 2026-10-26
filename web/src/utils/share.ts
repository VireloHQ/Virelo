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
  const space=Math.round(count*.3)|1,spaceStart=(count-space)/2,spaceEnd=spaceStart+space;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=(count+margin*2)*cell;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('QR rendering is unavailable.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  const dark=(row:number,col:number)=>row>=0&&col>=0&&row<count&&col<count&&code.isDark(row,col);
  const rounded=(x:number,y:number,width:number,height:number,radius:number|number[],color:string)=>{
    ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,width,height,radius);ctx.fill();
  };
  const ink='#17141c';
  for(let row=0;row<count;row++)for(let col=0;col<count;col++){
    if(logo&&row>=spaceStart&&row<spaceEnd&&col>=spaceStart&&col<spaceEnd)continue;
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
    // Reserve whole modules around the logo so no QR ink shows through its transparent parts.
    const size=Math.round(count*.26)*cell,x=(canvas.width-size)/2;
    ctx.drawImage(logo,x,x,size,size);
  }
  return canvas.toDataURL('image/png');
}

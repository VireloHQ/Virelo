export function shareLink(origin:string,pathname:string,webOnly=false) {
  const url=new URL(origin);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use an HTTP or HTTPS address.');
  url.pathname=webOnly?'/app':/^\/(?:watch|title)\/[1-9]\d*$/.test(pathname)?pathname:'/';
  url.search='';url.hash='';
  return url.href;
}
export async function shareQr(url:string) {
  if(url.length>2000)throw new Error('The link is too long for a QR code.');
  const {default:qrcode}=await import('qrcode-generator');
  const code=qrcode(0,'M');code.addData(url);code.make();
  return code.createDataURL(6,24);
}

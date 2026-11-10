import stringWidth from 'string-width';
import { terminalText } from './terminal-log.js';

export type Tone='normal'|'muted'|'title'|'line'|'accent'|'selected'|'field'|'success'|'danger';
const colors: Record<Tone,string>={normal:'\x1b[37m',muted:'\x1b[38;5;248m',title:'\x1b[1;97m',line:'\x1b[90m',accent:'\x1b[38;5;147m',selected:'\x1b[30m',field:'\x1b[97m',success:'\x1b[32m',danger:'\x1b[91m'};
const segments=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export function terminalInputWindow(value:string,cursor:number,width:number){
  const before=value.slice(0,cursor),parts=[...segments.segment(before)];let start=cursor,used=0;
  for(let i=parts.length-1;i>=0;i--){const size=stringWidth(parts[i].segment);if(used+size>width-1)break;used+=size;start=parts[i].index;}
  return {text:fitTerminal(value.slice(start),width),cursor:used};
}
export function fitTerminal(value: string,width: number): string {
  const text=terminalText(value);
  if(stringWidth(text)<=width)return text;
  let result='',used=0;
  for(const {segment} of segments.segment(text)){
    const size=stringWidth(segment);
    if(used+size>Math.max(0,width-1))break;
    result+=segment;used+=size;
  }
  return width>0?result+'…':'';
}

export class TerminalCanvas {
  private readonly cells: Array<Array<{text:string;tone:Tone;background:number}>>;
  constructor(readonly width:number,readonly height:number,_ascii=false){
    this.cells=Array.from({length:height},()=>Array.from({length:width},()=>({text:' ',tone:'normal',background:232})));
  }
  text(x:number,y:number,value:string,tone:Tone='normal',max=this.width-x):void{
    if(y<0||y>=this.height||max<=0)return;
    const text=fitTerminal(value,Math.min(max,this.width-x));
    for(const {segment} of segments.segment(text)){
      const size=stringWidth(segment);
      if(size===0||x<0||x+size>this.width)continue;
      const background=tone==='selected'?250:tone==='field'?236:this.cells[y][x].background;
      this.cells[y][x]={text:segment,tone,background};
      for(let i=1;i<size;i++)this.cells[y][x+i]={text:'',tone,background};
      x+=size;
    }
  }
  fill(x:number,y:number,width:number,tone:Tone='normal'):void{this.text(x,y,' '.repeat(Math.max(0,width)),tone,width);}
  box(x:number,y:number,width:number,height:number,title=''):void{
    if(width<3||height<3)return;
    const background=this.cells[y]?.[x]?.background===234?233:234;
    for(let row=y;row<Math.min(this.height,y+height);row++)for(let column=x;column<Math.min(this.width,x+width);column++)if(row>=0&&column>=0)this.cells[row][column]={text:' ',tone:'normal',background};
    if(title)this.text(x+2,y,title,'title',width-4);
  }
  lines(color=true):string[]{
    return this.cells.map(row=>{
      let line='',tone:Tone|undefined,background=-1;
      for(const cell of row){if(color&&(cell.tone!==tone||cell.background!==background)){line+='\x1b[0m'+colors[cell.tone]+`\x1b[48;5;${cell.background}m`;tone=cell.tone;background=cell.background;}line+=cell.text;}
      return line+(color?'\x1b[0m':'');
    });
  }
}

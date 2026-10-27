import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'rolldown/utils';

const tokens=text=>Array.from(text.matchAll(/\{(\w+)\}/g),match=>match[1]).sort();
export function catalogIssues(english,catalog) {
  const issues=[],base=Object.keys(english);
  for(const key of base) {
    if(!Object.hasOwn(catalog,key)){issues.push('Missing message: '+key);continue;}
    const entry=catalog[key],variants=typeof entry==='string'?[entry]:entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.values(entry):[];
    if(!variants.length||variants.some(value=>typeof value!=='string'||!value.trim())){issues.push('Empty or invalid translation: '+key);continue;}
    if(typeof entry!=='string'&&(!entry.other||Object.keys(entry).some(form=>!['zero','one','two','few','many','other'].includes(form))))issues.push('Invalid plural forms: '+key);
    for(const value of variants)if(JSON.stringify(tokens(value))!==JSON.stringify(tokens(key)))issues.push('Placeholder mismatch: '+key);
  }
  for(const key of Object.keys(catalog))if(!Object.hasOwn(english,key))issues.push('Unknown message: '+key);
  return issues;
}
export function duplicateKeys(source) {
  const ast=parseSync('catalog.js','('+source+')').program,duplicates=[];
  const walk=node=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='ObjectExpression'){
      const seen=new Set();for(const property of node.properties){const key=property.key?.value??property.key?.name;if(seen.has(key))duplicates.push(key);seen.add(key);}
    }
    for(const[key,value]of Object.entries(node)){if(['tokens','comments'].includes(key))continue;if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
  };walk(ast);return duplicates;
}
export function sourceMessage(node) {
  if(node?.type==='Literal'&&typeof node.value==='string')return node.value;
  if(node?.type==='TemplateLiteral')return node.quasis.map((part,index)=>part.value.cooked+(index<node.expressions.length?'{value'+index+'}':'')).join('');
  if(node?.type==='BinaryExpression'&&node.operator==='+'){
    const parts=[];const collect=part=>part.type==='BinaryExpression'&&part.operator==='+'?(collect(part.left),collect(part.right)):parts.push(part);collect(node);
    let index=0;return parts.map(part=>part.type==='Literal'&&typeof part.value==='string'?part.value:'{value'+index+++'}').join('');
  }
  return null;
}
async function sources(directory) {
  return (await Promise.all((await readdir(directory,{withFileTypes:true})).map(entry=>entry.isDirectory()?sources(join(directory,entry.name)):/\.tsx?$/.test(entry.name)?[join(directory,entry.name)]:[]))).flat();
}
function declaredKeys(source,name) {
  let keys=[];
  const walk=node=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='VariableDeclarator'&&node.id?.name===name){
      let value=node.init;while(value?.type==='TSAsExpression')value=value.expression;
      if(value?.type==='ObjectExpression')keys=value.properties.map(property=>property.key.name??property.key.value);
      if(value?.type==='ArrayExpression')keys=value.elements.map(element=>element.properties?.find(property=>property.key.name==='value')?.value.value).filter(Boolean);
    }
    for(const[key,value]of Object.entries(node)){if(['tokens','comments'].includes(key))continue;if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
  };walk(parseSync('config.ts',source).program);return keys.sort();
}
const identities=new Set(['Virelo','FFmpeg','Termux','PiP','Streamline','Theater','Centerstage','AGPL-3.0-only','{type} {number}','{value0}p','.']);
export async function checkI18n(root) {
  const directory=join(root,'web/src/i18n/messages'),english=JSON.parse(await readFile(join(directory,'en.json'),'utf8')),issues=[];
  const names=(await readdir(directory)).filter(name=>name.endsWith('.json'));
  let languageConfig;try{languageConfig=await readFile(join(root,'src/languages.ts'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;languageConfig=await readFile(join(root,'web/src/i18n/locale.ts'),'utf8');}
  const supported=declaredKeys(languageConfig,'languages'),registered=names.map(name=>name.slice(0,-5)).sort();
  const loaders=declaredKeys(await readFile(join(root,'web/src/i18n/runtime.ts'),'utf8'),'loaders');
  if(JSON.stringify(supported)!==JSON.stringify(registered)||JSON.stringify(loaders)!==JSON.stringify(supported))issues.push('Language registration, lazy loaders and catalog files must match.');
  for(const name of names){
    const source=await readFile(join(directory,name),'utf8'),catalog=JSON.parse(source);
    issues.push(...duplicateKeys(source).map(key=>name+': duplicate '+key),...catalogIssues(english,catalog).map(message=>name+': '+message));
    if(name!=='en.json')for(const[key,value]of Object.entries(catalog))if(value===key&&!identities.has(key))issues.push(name+': untranslated '+key);
  }
  const visibleAttributes=new Set(['aria-label','alt','placeholder','title','label','description','triggerLabel','confirmLabel','message']);
  const brandText=new Set(['Virelo','GitHub','Windows','macOS','Linux','Termux','npm','ffprobe','AGPL-3.0-only','Big Buck Bunny','Sintel','CC BY 3.0','© 2008 / 2010 Blender Foundation ·']);
  const paths=await sources(join(root,'web/src'));
  try{paths.push(...await sources(join(root,'src')));}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const path of paths){
    const source=await readFile(path,'utf8'),parsed=parseSync(path,source);
    if(parsed.errors.length){issues.push(relative(root,path)+': source parse failed');continue;}
    const check=(node,message)=>{if(!Object.hasOwn(english,message))issues.push(relative(root,path)+':'+source.slice(0,node.start).split('\n').length+': missing source message '+message);};
    const visibleExpression=node=>{
      if(node?.type==='ConditionalExpression'){visibleExpression(node.consequent);visibleExpression(node.alternate);return;}
      if(node?.type==='LogicalExpression'){visibleExpression(node.left);visibleExpression(node.right);return;}
      const message=sourceMessage(node);
      if(message&&/[A-Za-z]{2}/.test(message.replace(/\{\w+\}/g,''))&&!brandText.has(message)&&!/^([A-Za-z]:\\|\/(?:home|Users)\/)/.test(message))issues.push(relative(root,path)+': unlocalized visible expression '+message);
    };
    const walk=(node,parents=[])=>{
      if(!node||typeof node!=='object')return;
      if(node.type==='CallExpression'&&node.callee?.name==='t'&&typeof node.arguments[0]?.value==='string')check(node,node.arguments[0].value);
      if(node.type==='NewExpression'&&/Error$/.test(node.callee?.name??'')){
        const message=sourceMessage(node.arguments[0]);
        if(message&&/[A-Za-z]{3}/.test(message.replace(/\{\w+\}/g,'')))check(node,message);
      }
      if(node.type==='JSXAttribute'&&node.name?.name==='message'&&typeof node.value?.value==='string')check(node,node.value.value);
      const inCode=parents.some(parent=>parent.type==='JSXElement'&&['code','pre'].includes(parent.openingElement.name?.name));
      if(node.type==='JSXExpressionContainer'&&!inCode&&parents.at(-1)?.type!=='JSXAttribute')visibleExpression(node.expression);
      if(node.type==='JSXAttribute'&&visibleAttributes.has(node.name?.name)&&node.value?.type==='JSXExpressionContainer')visibleExpression(node.value.expression);
      const nativeLabels=path===join(root,'web/src/i18n/locale.ts')||path===join(root,'src/languages.ts');
      if(!nativeLabels&&path.startsWith(join(root,'web/src'))&&node.type==='Property'&&['label','title','description'].includes(node.key?.name)){
        const inspect=value=>{
          if(value?.type==='Literal'&&typeof value.value==='string'&&/[A-Za-z]{2}/.test(value.value))check(value,value.value);
          if(value?.type==='ConditionalExpression'){inspect(value.consequent);inspect(value.alternate);}
        };inspect(node.value);
      }
      if(node.type==='JSXText'){
        const text=node.value.replace(/\s+/g,' ').trim();
        const code=parents.some(parent=>parent.type==='JSXElement'&&['code','pre'].includes(parent.openingElement.name?.name))||/^npx virelo(?:\s|$)/.test(text);
        if(/[A-Za-z]{2}/.test(text)&&!brandText.has(text)&&!code)issues.push(relative(root,path)+': unlocalized JSX text '+text);
      }
      if(node.type==='JSXAttribute'&&visibleAttributes.has(node.name?.name)&&node.name.name!=='message'&&typeof node.value?.value==='string'){
        const text=node.value.value;
        // File paths, symbols and brand-only labels are not prose.
        const deferred=node.name.name==='label'&&parents.at(-1)?.name?.name==='CommandBlock';
        if(deferred)check(node,text);
        else if(/[A-Za-z]{2}/.test(text)&&!brandText.has(text)&&!/^([A-Za-z]:\\|\/|https?:|#[\da-f]+$|(?:[a-z0-9-]+\.)+[a-z]{2,}$)/i.test(text))issues.push(relative(root,path)+': unlocalized attribute '+node.name.name+'='+text);
      }
      for(const[key,value]of Object.entries(node)){if(['tokens','comments'].includes(key))continue;if(Array.isArray(value))value.forEach(child=>walk(child,[...parents,node]));else if(value&&typeof value==='object')walk(value,[...parents,node]);}
    };walk(parsed.program);
  }
  return {issues,messages:Object.keys(english).length,languages:names.map(name=>name.slice(0,-5))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url)),result=await checkI18n(root);
  if(result.issues.length){console.error(result.issues.join('\n'));process.exitCode=1;}
  else console.log('PASS: '+result.messages+' messages in '+result.languages.length+' languages; placeholders, duplicate keys and UI source checked.');
}

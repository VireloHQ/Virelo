import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {imageFileExists,prepareGeneratedFile} from '../dist/image-files.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4nUAAAAASUVORK5CYII=','base64');
test('image health rejects missing, empty, non-image and truncated cached containers',async t=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-image-health-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'image.jpg');
  assert.equal(await imageFileExists(file),false);assert.equal(await imageFileExists(root),false);
  for(const body of [Buffer.alloc(0),Buffer.from('<html>Not an image</html>'),Buffer.from([255,216,255,217]),png.subarray(0,png.length-12)]){
    await writeFile(file,body);assert.equal(await imageFileExists(file),false);
  }
  await writeFile(file,png);assert.equal(await imageFileExists(file),true);
  assert.deepEqual(await readFile(file),png);
});
test('generated files never traverse cache parent links or overwrite linked targets',async t=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-generated-links-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const cache=join(root,'cache'),originals=join(root,'originals');await mkdir(cache);await mkdir(originals);
  await writeFile(join(originals,'0.vtt'),'Original subtitles');
  await symlink(originals,join(cache,'hls'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(prepareGeneratedFile(join(cache,'hls','new','0.vtt'),cache),/filesystem links/);
  assert.equal(await readFile(join(originals,'0.vtt'),'utf8'),'Original subtitles');
  await assert.rejects(prepareGeneratedFile(join(root,'outside.vtt'),cache),/Invalid generated file path/);
});

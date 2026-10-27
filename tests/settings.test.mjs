import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VireloDB } from '../dist/db.js';
import { DEFAULT_SETTINGS } from '../dist/settings.js';
import { createVireloServer } from '../dist/server.js';
import { authenticatedInjector } from './auth-helper.mjs';

process.env.VIRELO_LOG_LEVEL = 'silent';

test('settings reject invalid values atomically and recover malformed stored values', async t => {
  const root=await mkdtemp(join(tmpdir(),'virelo-settings-')),db=new VireloDB(root);
  t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
  db.updateSettings({externalMetadataEnabled:false,metadataLanguage:'zh-CN',queueBehavior:'loop'});
  const previous=db.getSettings();
  for(const patch of [{externalMetadataEnabled:'false'},{externalImagesEnabled:null},{libraryWatchEnabled:1},{shortsIncludeLandscapes:[]},{metadataProvider:'unknown'},{metadataLanguage:{}},{metadataLanguage:'x'.repeat(65)},{queueBehavior:'unknown'},{tmdbApiKey:'x'.repeat(4097)}]) {
    assert.throws(()=>db.updateSettings({queueBehavior:'manual',...patch}),/Invalid settings/);
    assert.deepEqual(db.getSettings(),previous);
  }
  const insert=db.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
  for(const [key,value] of [['externalMetadataEnabled','"false"'],['metadataLanguage','null'],['queueBehavior','"bad"'],['__proto__','{"polluted":true}']])insert.run(key,value);
  const restored=db.getSettings();
  assert.equal(restored.externalMetadataEnabled,DEFAULT_SETTINGS.externalMetadataEnabled);
  assert.equal(restored.metadataLanguage,DEFAULT_SETTINGS.metadataLanguage);
  assert.equal(restored.queueBehavior,DEFAULT_SETTINGS.queueBehavior);
  assert.equal(restored.polluted,undefined);
});

test('settings API rejects malformed input without persisting partial changes',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'virelo-settings-api-'));
  const {app,db}=await createVireloServer({dataDir,mediaPaths:[],host:'127.0.0.1',port:0});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const inject=await authenticatedInjector(app);
  db.updateSettings({externalMetadataEnabled:false,libraryWatchEnabled:false,tmdbApiKey:'keep-this-key'});
  const previous=db.getSettings();
  for(const payload of [[],{externalMetadataEnabled:'false'},{queueBehavior:'bad',shortsIncludeLandscapes:true},{tmdbApiKey:1},{clearTmdbApiKey:'true'}]) {
    const response=await inject({method:'POST',url:'/api/settings',payload});
    assert.equal(response.statusCode,400,JSON.stringify(payload));
    assert.equal(response.json().message,'Invalid settings.');
    assert.deepEqual(db.getSettings(),previous);
  }
  const saved=await inject({method:'POST',url:'/api/settings',payload:{...previous,queueBehavior:'manual',tmdbApiKey:''}});
  assert.equal(saved.statusCode,200,saved.body);
  assert.equal(saved.json().tmdbApiKey,'');
  assert.equal(db.getSettings().tmdbApiKey,'keep-this-key');
  assert.equal(db.getSettings().queueBehavior,'manual');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppearanceTestModule } from './appearance-test-loader.mjs';

const api = await loadAppearanceTestModule('browser-backup.ts', {
  './local-library': 'export function openDatabase() { return globalThis.__backupTest.open(); } export function editLibraries(operation) { return operation(); }'
});
const INVALID = 'This backup contains invalid or unsafe data.';
const NOT_EMPTY = 'Library backups can only be imported into an empty browser library.';
const settings = { audioAnalysisEnabled: true, shortsIncludeLandscapes: true, queueBehavior: 'manual' };
const track = JSON.stringify(['ja', 'original', 'aac', 2, 'stereo', false]);
const preferences = {
  'virelo.appearance.v1': JSON.stringify({ controllerStyle: 'theater', accentColor: '#ABCDEF' }),
  'virelo.language.v1': 'ja', 'virelo.library-layout': 'explorer', 'virelo.queue-layout': 'vertical',
  'virelo.explorer-width': '320', 'virelo.playback-speed:v1': '1.5', 'virelo-playback-quality:v1': '1080',
  'virelo-playback-audio:v1': JSON.stringify({ configuration: JSON.stringify([track]), selection: track }),
  'virelo-playback-subtitles:v1': JSON.stringify({ configuration: JSON.stringify([track]), selection: null }),
  'virelo-playback-volume:v1': JSON.stringify({ volume: .65, muted: true }), 'virelo-volume-leveling:v1': 'true'
};
function stableId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0) || 1;
}
function fixture(kind = 'library') {
  const source = 'Shows/日本語 S01E02.mp4';
  const video = {
    id: stableId('7:' + source), library_id: 7, source_path: source, path: source, filename: source.split('/').at(-1),
    title: 'My edited title', sort_title: 'my edited title', kind: 'series', series_title: 'My series',
    season: 1, episode: 2, year: 2025, duration: 220.5, width: 1920, height: 1080, video_codec: 'h264',
    audio_codec: 'aac', container: 'mp4', folder: 'Shows', size: 2048, mtime: 1000, overview: 'User metadata\nSecond line',
    genres: '["Drama"]', external_id: '1234', added_at: 2000, updated_at: 3000, audio_loudness: null,
    metadata_blocked: 1, metadata_revision: 5, progress_position: 90.5, progress_duration: 220.5,
    progress_updated_at: 2900, progress_completed: 0, liked: 1
  };
  return { format: 'virelo-browser-backup', version: 1, kind, createdAt: 4000, settings: { ...settings }, preferences: { ...preferences },
    libraries: kind === 'settings' ? [] : [{ id: 7, label: 'Renamed library', path: 'Videos', created_at: 500, persistent: false, folderLabels: { Shows: 'Renamed folder' } }],
    media: kind === 'settings' ? [] : [video],
    playlists: kind === 'settings' ? [] : [{ id: 15, name: 'Watch next', revision: 9, mediaIds: [4294967295, video.id, 1], createdAt: 100, updatedAt: 3000 }] };
}
const json = value => new Blob([JSON.stringify(value)], { type: 'application/json' });
const read = value => api.readBrowserBackup(json(value));

// A deliberately small transactional IDB model: staged writes commit together, aborts discard them.
// Real browser IndexedDB/permission behavior is covered separately by the integration owner.
function environment(t, seed = {}) {
  const stores = new Map(['libraries', 'media', 'settings', 'playlists', 'thumbnails'].map(name => [name, new Map()]));
  for (const [name, values] of Object.entries(seed)) for (const value of values) stores.get(name).set(name === 'settings' ? 'current' : value.id, structuredClone(value));
  const records = new Map(), events = [], queue = [];
  let busy = false;
  const env = { stores, records, events, failWrite: null, failRead: null, beforeWrite: null, storageFailures: new Set(), deniedRead: false,
    open: async () => ({ close() { events.push(['close']); }, transaction(names, mode) {
      names = typeof names === 'string' ? [names] : names;
      events.push(['transaction', [...names], mode]);
      if (mode === 'readwrite') { env.beforeWrite?.(); env.beforeWrite = null; }
      let aborted = false, staged;
      const requests = [];
      const tx = { error: null, abort() { aborted = true; }, objectStore(name) {
        assert.ok(names.includes(name), 'store must belong to the transaction');
        const request = (method, value, key) => {
          const result = {};
          events.push([method, name]);
          const copy = structuredClone(value);
          requests.push(() => {
            if (env.failRead === name && ['get', 'getAll', 'count'].includes(method)) throw new Error('read failed');
            const store = staged.get(name);
            if (method === 'get') result.result = structuredClone(store.get(copy));
            if (method === 'getAll') result.result = structuredClone([...store.values()]);
            if (method === 'count') result.result = store.size;
            if (method === 'add' || method === 'put') {
              assert.equal(mode, 'readwrite');
              if (env.failWrite === name) throw new Error('quota exceeded');
              const id = key ?? copy.id;
              if (method === 'add' && store.has(id)) throw new Error('duplicate key');
              store.set(id, copy);
            }
            result.onsuccess?.();
          });
          return result;
        };
        return { get: key => request('get', key), getAll: () => request('getAll'), count: () => request('count'),
          add: value => request('add', value), put: (value, key) => request('put', value, key),
          clear() { assert.fail('backup must never clear stores'); }, delete() { assert.fail('backup must never delete records'); } };
      } };
      queue.push(() => {
        staged = structuredClone(stores);
        const next = () => {
          if (!aborted && requests.length) {
            try { requests.shift()(); } catch (error) { tx.error = error; aborted = true; }
            setImmediate(next); return;
          }
          if (aborted) { events.push(['abort']); tx.onabort?.(); }
          else {
            if (mode === 'readwrite') for (const name of names) stores.set(name, staged.get(name));
            events.push(['complete']); tx.oncomplete?.();
          }
          busy = false; start();
        };
        next();
      });
      start();
      return tx;
    } }) };
  function start() { if (!busy && queue.length) { busy = true; setImmediate(queue.shift()); } }
  const localStorage = {
    getItem(key) { if (env.deniedRead) throw new Error('blocked'); return records.get(key) ?? null; },
    setItem(key, value) { events.push(['preference', key]); if (env.storageFailures.has(key)) throw new Error('blocked'); records.set(key, value); },
    key() { assert.fail('must not enumerate arbitrary localStorage'); }
  };
  for (const [key, value] of Object.entries({ __backupTest: env, localStorage })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  env.snapshot = () => structuredClone(stores);
  env.seedPreferences = () => { for (const entry of Object.entries(preferences)) records.set(...entry); };
  return env;
}

test('full export preserves IDs, user metadata, ordered stale playlist references and only supported preferences', async t => {
  const expected = fixture(), source = structuredClone(expected);
  source.libraries[0].persistent = true;
  source.libraries[0].handle = { kind: 'directory', privateToken: 'handle-secret' };
  source.media[0].thumbnail_path = 'blob:private-video';
  source.media[0].poster_path = 'C:/private/poster.jpg';
  source.media[0].backdrop_path = '/private/backdrop.jpg';
  source.media[0].file = new Blob(['secret video bytes']);
  source.media[0].token = 'media-secret';
  const env = environment(t, { libraries: source.libraries, media: source.media, playlists: source.playlists, settings: [settings],
    thumbnails: [{ id: source.media[0].id, blob: new Blob(['private artwork']) }] });
  env.seedPreferences(); env.records.set('auth-token', 'top-secret'); env.records.set('virelo.unknown', 'hidden');
  const before = env.snapshot(), prefsBefore = structuredClone(env.records);
  const blob = await api.exportBrowserData('library');
  assert.equal(blob.type, 'application/json');
  const serialized = await blob.text();
  for (const forbidden of ['handle', 'blob:', 'C:/', '/private', 'secret', 'thumbnail_path', 'poster_path', 'backdrop_path', 'auth-token', 'virelo.unknown']) assert.ok(!serialized.includes(forbidden), forbidden);
  const actual = await api.readBrowserBackup(blob);
  expected.createdAt = actual.createdAt;
  expected.preferences['virelo.appearance.v1'] = JSON.stringify({ controllerStyle: 'theater', accentColor: '#abcdef' });
  assert.deepEqual(actual, expected);
  assert.deepEqual(api.backupSummary(actual), { kind: 'library', libraries: 1, videos: 1, playlists: 1 });
  assert.deepEqual(env.snapshot(), before); assert.deepEqual(env.records, prefsBefore);
  assert.deepEqual(env.events.filter(event => event[0] === 'transaction'), [['transaction', ['libraries', 'media', 'playlists', 'settings'], 'readonly']]);
});

test('settings-only export has no catalog data and restores legacy preferences to canonical keys', async t => {
  const full = fixture(), env = environment(t, { libraries: full.libraries, media: full.media, playlists: full.playlists });
  env.records.set('virelo-public-locale:v1', 'ru'); env.records.set('virelo-playback-quality', 'source');
  const before = env.snapshot();
  const result = await api.readBrowserBackup(await api.exportBrowserData('settings'));
  assert.deepEqual(result.settings, { audioAnalysisEnabled: false, shortsIncludeLandscapes: false, queueBehavior: 'auto' });
  assert.deepEqual(result.preferences, { 'virelo.language.v1': 'ru', 'virelo-playback-quality:v1': 'source' });
  assert.deepEqual(api.backupSummary(result), { kind: 'settings', libraries: 0, videos: 0, playlists: 0 });
  assert.deepEqual(env.snapshot(), before);
  assert.deepEqual(env.events.filter(event => event[0] === 'transaction'), [['transaction', ['settings'], 'readonly']]);
});

test('full import restores disconnected libraries, reconnect identity, metadata and playlist revision/order without thumbnails', async t => {
  const env = environment(t), value = await read(fixture()), before = structuredClone(value);
  assert.deepEqual(await api.importBrowserBackup(value), { preferencesRestored: true });
  assert.deepEqual([...env.stores.get('libraries').values()], value.libraries);
  assert.equal(env.stores.get('libraries').get(7).persistent, false);
  assert.equal(Object.hasOwn(env.stores.get('libraries').get(7), 'handle'), false);
  assert.deepEqual([...env.stores.get('media').values()], value.media.map(row => ({ ...row, thumbnail_path: null, poster_path: null, backdrop_path: null })));
  assert.deepEqual([...env.stores.get('playlists').values()], value.playlists);
  assert.equal(env.stores.get('thumbnails').size, 0);
  assert.deepEqual(env.stores.get('settings').get('current'), settings);
  assert.deepEqual(Object.fromEntries(env.records), value.preferences);
  assert.deepEqual(value, before, 'import must not mutate the preview');
  assert.deepEqual(env.events.filter(event => event[0] === 'transaction'), [['transaction', ['libraries', 'media', 'playlists', 'settings'], 'readwrite']]);
  assert.ok(env.events.findIndex(event => event[0] === 'preference') > env.events.findIndex(event => event[0] === 'complete'));
});

test('settings-only import updates preferences on a populated catalog without changing any library data', async t => {
  const full = fixture(), env = environment(t, { libraries: full.libraries, media: full.media, playlists: full.playlists,
    settings: [{ audioAnalysisEnabled: false, shortsIncludeLandscapes: false, queueBehavior: 'auto' }], thumbnails: [{ id: 99, blob: new Blob(['keep']) }] });
  const before = env.snapshot(); env.records.set('unrelated', 'keep');
  assert.deepEqual(await api.importBrowserBackup(await read(fixture('settings'))), { preferencesRestored: true });
  for (const name of ['libraries', 'media', 'playlists', 'thumbnails']) assert.deepEqual(env.stores.get(name), before.get(name));
  assert.deepEqual(env.stores.get('settings').get('current'), settings);
  assert.equal(env.records.get('unrelated'), 'keep');
  assert.deepEqual(env.events.filter(event => event[0] === 'transaction'), [['transaction', ['settings'], 'readwrite']]);
});

for (const store of ['libraries', 'media', 'playlists']) {
  test(`full import refuses a target with existing ${store}, including a last-moment concurrent write`, async t => {
    const env = environment(t), value = await read(fixture());
    env.beforeWrite = () => env.stores.get(store).set(99, { id: 99, marker: 'keep' });
    const expected = env.snapshot(); expected.get(store).set(99, { id: 99, marker: 'keep' });
    await assert.rejects(api.importBrowserBackup(value), { message: NOT_EMPTY });
    assert.deepEqual(env.snapshot(), expected); assert.equal(env.records.size, 0);
    assert.equal(env.events.some(event => event[0] === 'put' || event[0] === 'add'), false);
  });
}

test('two simultaneous full imports cannot both pass the transactional empty check', async t => {
  const env = environment(t), value = await read(fixture());
  const results = await Promise.allSettled([api.importBrowserBackup(value), api.importBrowserBackup(value)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.message, NOT_EMPTY);
  assert.equal(env.stores.get('libraries').size, 1); assert.equal(env.stores.get('playlists').size, 1);
});

test('an aborted IDB import rolls back all staged rows/settings and never writes preferences', async t => {
  const env = environment(t, { settings: [{ audioAnalysisEnabled: false, shortsIncludeLandscapes: false, queueBehavior: 'loop' }] });
  const before = env.snapshot(); env.failWrite = 'playlists';
  await assert.rejects(api.importBrowserBackup(await read(fixture())), { message: 'Could not import browser data. No browser database data was changed.' });
  assert.deepEqual(env.snapshot(), before); assert.equal(env.records.size, 0);
});

test('localStorage failure explicitly reports partial preferences after committed IDB, without promising rollback', async t => {
  const env = environment(t), value = await read(fixture());
  env.storageFailures.add('virelo.appearance.v1');
  assert.deepEqual(await api.importBrowserBackup(value), { preferencesRestored: false });
  assert.equal(env.stores.get('libraries').size, 1); assert.deepEqual(env.stores.get('settings').get('current'), settings);
  assert.equal(env.records.has('virelo.appearance.v1'), false); assert.equal(env.records.get('virelo.library-layout'), 'explorer');
});

test('both modes validate and normalize without database reads or writes', async t => {
  const env = environment(t);
  for (const kind of ['settings', 'library']) {
    const value = fixture(kind), before = structuredClone(value), actual = await read(value);
    assert.equal(actual.preferences['virelo.appearance.v1'].includes('#abcdef'), true);
    assert.equal(actual.kind, kind); assert.deepEqual(value, before);
  }
  assert.deepEqual(env.events, []);
});

const corruptions = [
  ['unknown top-level token', value => { value.token = 'secret'; }],
  ['prototype pollution', value => { Object.defineProperty(value.preferences, '__proto__', { enumerable: true, value: 'pollute' }); }],
  ['arbitrary storage keys', value => { value.preferences['auth-token'] = 'secret'; }],
  ['unknown settings', value => { value.settings.tmdbApiKey = 'secret'; }],
  ['invalid settings type', value => { value.settings.audioAnalysisEnabled = 'true'; }],
  ['unsupported queue', value => { value.settings.queueBehavior = 'shuffle'; }],
  ['unknown library handle', value => { value.libraries[0].handle = {}; }],
  ['persistent imported library', value => { value.libraries[0].persistent = true; }],
  ['absolute root', value => { value.libraries[0].path = 'C:/private'; }],
  ['unknown library data', value => { value.libraries[0].video = {}; }],
  ['duplicate libraries', value => { value.libraries.push(structuredClone(value.libraries[0])); }],
  ['duplicate media', value => { value.media.push(structuredClone(value.media[0])); }],
  ['duplicate playlists', value => { value.playlists.push(structuredClone(value.playlists[0])); }],
  ['cross-library reference', value => { value.media[0].library_id = 8; value.media[0].id = stableId('8:' + value.media[0].source_path); }],
  ['wrong reconnect hash', value => { value.media[0].id = 123; }],
  ['mismatched media path', value => { value.media[0].path = 'other.mp4'; }],
  ['mismatched filename', value => { value.media[0].filename = 'other.mp4'; }],
  ['mismatched folder', value => { value.media[0].folder = 'Other'; }],
  ['thumbnail URL', value => { value.media[0].thumbnail_path = 'blob:secret'; }],
  ['embedded file', value => { value.media[0].file = {}; }],
  ['invalid media kind', value => { value.media[0].kind = 'script'; }],
  ['negative progress', value => { value.media[0].progress_position = -1; }],
  ['non-finite progress', value => { value.media[0].progress_position = Infinity; }],
  ['invalid like', value => { value.media[0].liked = 2; }],
  ['large string', value => { value.media[0].title = 'a'.repeat(4097); }],
  ['control character', value => { value.media[0].title = 'bad\u0000title'; }],
  ['too many records', value => { value.libraries = Array(1001).fill(value.libraries[0]); }],
  ['duplicate playlist references', value => { value.playlists[0].mediaIds.push(value.playlists[0].mediaIds[0]); }],
  ['invalid stale video ID', value => { value.playlists[0].mediaIds.push(4294967296); }],
  ['invalid revision', value => { value.playlists[0].revision = 0; }],
  ['too many playlist items', value => { value.playlists[0].mediaIds = Array.from({ length: 10001 }, (_, index) => index + 1); }],
  ['settings snapshot smuggling catalog', value => { value.kind = 'settings'; }],
  ['invalid appearance', value => { value.preferences['virelo.appearance.v1'] = '{"controllerStyle":"theater","accentColor":"url(secret)"}'; }],
  ['unknown appearance property', value => { value.preferences['virelo.appearance.v1'] = '{"controllerStyle":"theater","accentColor":"#abcdef","token":"secret"}'; }],
  ['invalid volume', value => { value.preferences['virelo-playback-volume:v1'] = '{"volume":2,"muted":false}'; }],
  ['unknown volume property', value => { value.preferences['virelo-playback-volume:v1'] = '{"volume":1,"muted":false,"token":"secret"}'; }],
  ['invalid language', value => { value.preferences['virelo.language.v1'] = 'unsupported'; }],
  ['invalid playback speed', value => { value.preferences['virelo.playback-speed:v1'] = '5'; }],
  ['invalid quality', value => { value.preferences['virelo-playback-quality:v1'] = 'javascript:bad'; }],
  ['invalid sidebar width', value => { value.preferences['virelo.explorer-width'] = '1000'; }],
  ['unknown track property', value => { value.preferences['virelo-playback-audio:v1'] = JSON.stringify({ configuration: '[]', selection: null, token: 'secret' }); }],
  ['audio track cannot be off', value => { value.preferences['virelo-playback-audio:v1'] = JSON.stringify({ configuration: '[]', selection: null }); }],
  ['bad audio analysis', value => { value.media[0].audio_loudness = '{"version":5}'; }],
  ['audio analysis secret property', value => { value.media[0].audio_loudness = JSON.stringify({ version: 1, size: 2048, mtime: 1000, defaultAudioStream: null, tracks: [], token: 'secret' }); }]
];
for (const unsafe of ['/absolute/video.mp4', '../video.mp4', 'Shows/../video.mp4', 'C:\\private\\video.mp4', 'file:///private/video.mp4', 'blob:secret', 'https://example.com/video.mp4', 'Shows//video.mp4', './video.mp4', '\\\\server\\video.mp4']) {
  corruptions.push(['unsafe source path ' + unsafe, value => { value.media[0].source_path = unsafe; }]);
  corruptions.push(['unsafe folder label path ' + unsafe, value => { value.libraries[0].folderLabels = { [unsafe]: 'Label' }; }]);
}

test('literal filenames keep percent signs, tildes and Unix punctuation without URL decoding', async () => {
  const value=fixture(), source='~Clips%2e%2e/Scene: why?.mp4', item=value.media[0];
  value.libraries[0].path='~Videos?'; value.libraries[0].folderLabels={'~Clips%2e%2e':'Clips'};
  Object.assign(item,{id:stableId('7:'+source),path:source,source_path:source,filename:'Scene: why?.mp4',folder:'~Clips%2e%2e'});
  const result=await read(value);
  assert.equal(result.media[0].source_path,source);
  assert.equal(result.libraries[0].path,'~Videos?');
});
for (const [name, corrupt] of corruptions) {
  test(`rejects ${name} on read and on direct import before any storage access`, async t => {
    const env = environment(t), value = fixture(); corrupt(value);
    await assert.rejects(read(value), { message: INVALID });
    await assert.rejects(api.importBrowserBackup(value), { message: INVALID });
    assert.deepEqual(env.events, []); assert.equal(env.records.size, 0);
  });
}

test('unsupported versions, malformed JSON and oversized files fail with stable messages before writes', async t => {
  const env = environment(t), value = fixture(); value.version = 2;
  await assert.rejects(read(value), { message: 'This backup version is not supported.' });
  await assert.rejects(api.importBrowserBackup(value), { message: 'This backup version is not supported.' });
  await assert.rejects(api.readBrowserBackup(new Blob(['{bad json'])), { message: 'Could not read the backup JSON file.' });
  await assert.rejects(api.readBrowserBackup({ size: 32 * 1024 * 1024 + 1, text() { assert.fail('oversized file must not be read'); } }), { message: 'Backup files must be 32 MiB or smaller.' });
  assert.deepEqual(env.events, []);
});

test('a preview modified after reading is revalidated at import', async t => {
  const env = environment(t), value = await read(fixture());
  value.preferences['new-auth-token'] = 'do-not-write';
  await assert.rejects(api.importBrowserBackup(value), { message: INVALID });
  assert.deepEqual(env.events, []);
});

test('direct import rejects sparse and decorated arrays rather than silently dropping rows', async t => {
  const env = environment(t);
  for (const array of [Array(1), Object.assign([fixture().libraries[0]], { token: 'secret' })]) {
    const value = fixture(); value.libraries = array;
    await assert.rejects(api.importBrowserBackup(value), { message: INVALID });
  }
  assert.deepEqual(env.events, []);
});

test('valid measured audio analysis survives a backup round trip', async t => {
  const env = environment(t), value = fixture();
  value.media[0].audio_loudness = JSON.stringify({ version: 1, size: 2048, mtime: 1000, defaultAudioStream: 0,
    tracks: [{ index: 0, loudness: { integratedLufs: -20, truePeakDb: -5 } }] });
  const normalized = await read(value);
  await api.importBrowserBackup(normalized);
  assert.equal(env.stores.get('media').get(value.media[0].id).audio_loudness, value.media[0].audio_loudness);
});

test('migration detection ignores both language keys and unrelated storage, but sees DB settings, orphan catalog rows and every non-language preference', async t => {
  const env = environment(t);
  assert.equal(await api.hasBrowserData(), false);
  env.records.set('virelo.language.v1', 'ja'); env.records.set('virelo-public-locale:v1', 'ja'); env.records.set('unrelated', 'value');
  assert.equal(await api.hasBrowserData(), false);
  for (const [key, value] of [...Object.entries(preferences).filter(([key]) => key !== 'virelo.language.v1'), ['virelo-playback-quality', 'auto']]) {
    env.records.set(key, value); assert.equal(await api.hasBrowserData(), true, key); env.records.delete(key);
  }
  for (const name of ['libraries', 'media', 'playlists', 'settings']) {
    const key = name === 'settings' ? 'current' : 1;
    env.stores.get(name).set(key, name === 'settings' ? settings : { id: 1 });
    assert.equal(await api.hasBrowserData(), true, name); env.stores.get(name).delete(key);
  }
  env.stores.get('thumbnails').set(1, { id: 1, blob: new Blob(['stale']) });
  assert.equal(await api.hasBrowserData(), false, 'regenerable orphan thumbnails do not count');
});

test('blocked preference reads and IDB read failures are reported without modifying source state', async t => {
  const env = environment(t); env.deniedRead = true;
  await assert.rejects(api.exportBrowserData('settings'), { message: 'Could not read browser preferences. Allow browser storage and try again.' });
  await assert.rejects(api.hasBrowserData(), { message: 'Could not read browser preferences. Allow browser storage and try again.' });
  env.deniedRead = false; env.failRead = 'settings';
  await assert.rejects(api.exportBrowserData('settings'), { message: 'Could not read browser data. Please try again.' });
  await assert.rejects(api.hasBrowserData(), { message: 'Could not read browser data. Please try again.' });
  assert.equal(env.events.some(event => ['add', 'put', 'preference'].includes(event[0])), false);
});

import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

let serial = 0;
export async function loadAppearanceTestModule(entry, mocks = {}) {
  const bundle = await rolldown({
    input: fileURLToPath(new URL('../web/src/' + entry, import.meta.url)),
    plugins: [{
      name: 'appearance-test-mocks',
      resolveId(source) {
        if (Object.hasOwn(mocks, source)) return '\0mock:' + source + '.js';
        if (source.endsWith('.css')) return '\0empty-css';
        if (source === 'react/jsx-runtime') return { id: import.meta.resolve(source), external: true };
      },
      load(id) {
        if (id === '\0empty-css') return '';
        if (id.startsWith('\0mock:')) return mocks[id.slice(6, -3)];
      }
    }]
  });
  try {
    const { output } = await bundle.generate({ format: 'es', codeSplitting: false });
    const code = output[0].code + '\n//# sourceURL=appearance-test:' + entry;
    return await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64') + '#' + (++serial));
  } finally { await bundle.close(); }
}


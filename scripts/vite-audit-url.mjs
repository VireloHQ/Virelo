// Direct imports inside Playwright evaluate() bypass Vite's import rewriting.
export const sharedModuleBase = '/@fs' + new URL('../packages/web-ui/src/', import.meta.url).pathname;

export class LibraryNameError extends Error { readonly statusCode = 400; }

export function libraryName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 200 || /[\p{Cc}]/u.test(value))
    throw new LibraryNameError('Enter a name with 1–200 characters.');
  return value.trim();
}

export function libraryFolder(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\\') || value.startsWith('/') || /[\p{Cc}]/u.test(value)
    || Boolean(value && value.split('/').some(part => !part || part === '.' || part === '..')))
    throw new LibraryNameError('Invalid folder');
  return value;
}


# Localization

The interface supports English, Japanese, Simplified Chinese, Korean and Russian.
Change the language in **Settings → Appearance → Language**. The sign-in screen
also has a language menu. The browser's preferred languages are used until a
choice is saved; unsupported languages fall back to English.

On the npm server, every account can save its own language. This preference is
independent of administrator permissions and does not sign out playback sessions.
The standalone Web app stores its choice in the browser. The separate marketing
site maintains its own translations.

## Source layout

- Each edition's `apps/<edition>/web/src/i18n/messages/en.json` is its source catalog.
- Each other `messages/<locale>.json` contains the same message keys.
- `locale.ts` contains language matching, interpolation and plural selection.
- `runtime.ts` loads requested catalogs and handles the browser preference.
- `index.ts` exports `t()` and the `useLocale()` React subscription.
- Shared `Trans.tsx` and `LocaleRoot.tsx` in `packages/web-ui/src/i18n` handle
  React interpolation and React Aria's locale.
- The checks cover both edition-specific and shared source. Run them with
  `npm run i18n:check` at the workspace root.

English sentences are message IDs. Keep complete sentences together rather than
concatenating translated fragments:

```tsx
import { t, useLocale } from '../i18n';

function Example({ name, count }: { name: string; count: number }) {
  useLocale();
  return <p>{t('Saved to {name}.', { name })} {t('{count} videos', { count })}</p>;
}
```

Call `useLocale()` in components that render translated text so an in-place
language change updates them. Keep IDs, routes, API parameters and state-machine
values independent of translated labels. Do not translate user names, library
names, playlist names, titles, filenames, captions or administrator messages.
Pass them as values. Code, URLs, licenses and brand names stay intact.

For markup, use React nodes instead of HTML strings:

```tsx
<Trans message="Saved to {name}." values={{ name: <strong>{name}</strong> }} />
```

Messages with counts may use CLDR plural forms:

```json
{
  "{count} videos": {
    "one": "{count} video",
    "other": "{count} videos"
  }
}
```

Russian also needs `few` and `many` where appropriate. `other` is required.
Every variant must preserve all placeholders. Interpolation is rendered by
React, never as HTML. Dates, numbers and durations use the selected locale.

## Adding a language

1. Copy `en.json` to `<locale>.json` and translate its values, not its keys.
2. Add the BCP 47 code, native name and Open Graph locale to `languages`:
   `apps/server/src/languages.ts` and `apps/web/web/src/i18n/locale.ts`.
3. Add a statically analyzable import to the `loaders` map in `runtime.ts`.
4. Add any new shared UI messages to both editions' catalogs. Keep
   edition-specific messages in the edition that displays them.
5. Run `npm run i18n:check`, the full test/build checks, and browser checks at
   desktop and small mobile widths. Review long labels and sentence word order.

`node apps/server/scripts/audit-communication.mjs` additionally checks language selection,
reload persistence, account isolation, playback preservation and localized
startup recovery. Set `VIRELO_TEST_WEB_REPO` to include the standalone app.

Server/API diagnostic strings remain stable for compatibility and troubleshooting;
the interface translates known diagnostics at display time. Startup recovery
has a build-time catalog subset so it still works if the application bundle
cannot load. Native operating-system controls use the operating-system language.

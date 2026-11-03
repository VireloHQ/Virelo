# Public search visibility

Reviewed 2026-11-03. This is implementation and verification guidance, not a
ranking or AI-citation guarantee.

## Public pages

The landing page and setup guide have stable, self-canonical URLs:

| Language | Overview | Setup |
| --- | --- | --- |
| English | / | /setup |
| Japanese | /ja | /ja/setup |
| Simplified Chinese | /zh-CN | /zh-CN/setup |
| Korean | /ko | /ko/setup |
| Russian | /ru | /ru/setup |

The URL determines the public page language, even when browser or saved app
preferences differ. There are no automatic language redirects. Selecting another
language changes the URL and saves the preference for the player. All public
pages declare reciprocal hreflang and an English x-default.

## Build and maintenance

The Vite build has separate public and player entries. The prerender step renders
the existing React landing/guide components into ten static HTML files. It uses
eager, data-free routes and loads translations before rendering and hydration;
it does not depend on a live SSR server or provide different content to bots.
The private player retains a separate, non-indexable app.html shell.
Static rendering disables the router's inline scroll-restoration script, while
client-side restoration stays enabled. Public HTML must contain no executable
inline scripts; the preview audit enforces the same CSP as the production host.

Public routes, metadata and schema are defined in web/src/public-site.ts.
Localized search copy lives in web/src/i18n/public-seo.json; visible UI copy stays
in the normal language catalogs. The FAQ schema is derived from the actual
rendered questions and answers, not a second manually maintained copy.

The build generates sitemap.xml. Its revision date represents the meaningful
public-content change, not each build time: update the date in
scripts/prerender-public.mjs when that content changes. Do not add app routes,
invented review ratings, an internal library search action, or promises of
universal browser codec support.

The social card uses the current mark and licensed sample films; see ASSETS.md.
product.md is built from llms-full.txt so the optional plain-text product summary
has one source. These files are convenience formats, not special ranking signals.

## Crawling policy

robots.txt permits ordinary search indexing and explicitly permits search/user
retrieval agents from OpenAI, Anthropic and Perplexity. It preserves the existing
Cloudflare training opt-out for GPTBot, ClaudeBot, Google-Extended and CCBot.
This distinguishes search discovery from model training; Google-Extended does
not govern Google Search indexing or its AI features.

Cloudflare can prepend managed robots rules or block requests at the edge. Check
the served robots.txt and any bot-protection rules as well as the repository.
An allow rule is not proof that the edge accepts a crawler. No account-level
Cloudflare policy was changed as part of this implementation.

App routes are excluded from the sitemap and served with noindex. The app is
browser-local: robots.txt is not an access control or a way to protect files.

## Verification

Run npm run check, node scripts/audit-seo.mjs and
node scripts/audit-public-locales.mjs after building. The browser audit checks raw
HTTP output, the first frame with scripts held back, hydration without a layout
shift, metadata, private shells and genuine 404s. The locale audit also checks
five viewport widths, keyboard use, copy controls, storage failures and shared
language preferences. The worker tests isolate each language's offline document.

After deployment, npm run verify:deployment checks all ten live pages, canonical
and alternate URLs, the public entry code, sitemap, private shells, crawler
policy, product facts, social image and the exact landing-media bytes.
Dependency chunk hashes are normalized only for the entry-code comparison,
because Windows and Cloudflare/Linux builds can emit different chunk filenames.

For a hosting-level check, run Wrangler locally against dist and pass its URL to
the same verifier. Workers' clean-HTML handling redirects .html requests: keep
internal rewrite targets extensionless (/app), otherwise a deep app route can
redirect repeatedly. /app itself is served directly from app.html.

## Owner follow-up

1. Verify the HTTPS property in Google Search Console and Bing Webmaster Tools,
   if it has not already been verified. No verification token is embedded or
   guessed by this repository.
2. Submit https://virelo.riyo.me/sitemap.xml to both. Inspect /, /ja and /setup for
   rendered content, selected canonical and indexing status.
3. Track search impressions, clicks and landing-to-player use. Compare AI
   citations in Bing's AI Performance report separately from actual visits:
   a citation is not a conversion.
4. Review real queries and support questions before expanding content. Do not
   produce interchangeable keyword pages, synthetic testimonials, repeated
   product definitions or promotional copy addressed to a developer.

## Current primary-source guidance

- [Google: generative AI optimization](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
  — clear, useful, accessible content and ordinary SEO remain the foundation.
- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
  — no special AI schema or AI text file is required for inclusion.
- [Google: multilingual sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)
  — separate language URLs and hreflang rather than mandatory language redirects.
- [Google: JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
  — make public content and links accessible to crawling and rendering.
- [Bing: AI Performance](https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/)
  and [June 2026 reporting additions](https://blogs.bing.com/search/2026/6/New-AI-Visibility-Insights-in-Bing-Webmaster-Tools-Intents-Topics-Citation-Share-Compare/)
  — first-party reporting for cited pages and query/topic context, not a promise
  of placement in every AI product.
- [OpenAI bots](https://developers.openai.com/api/docs/bots),
  [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
  and [Cloudflare managed robots](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/)
  — separate search/retrieval roles from training and inspect the delivered rules.

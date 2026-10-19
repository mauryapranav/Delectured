# Static deployment, checked 2026-10-16

Target hosting cost: INR 0/month on the chosen free plan; no paid backend, domain or credit-card-dependent service is required. Provider inference is separate and subject to each provider's quota/pricing. No deployment was performed.

## Student Pack first

The [GitHub Student Developer Pack](https://education.github.com/pack) includes GitHub benefits and lists GitHub Pages. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) supports static HTML/CSS/JavaScript. It is a suitable alternative using your existing GitHub account; no additional student cloud credit or expiring server is needed.

## Cloudflare Pages

Cloudflare advertises a [free starting plan without a credit card](https://www.cloudflare.com/plans/). Its [static HTML guide](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/) supports this project. Free Pages currently allows 500 builds/month, 20,000 files and 25 MiB per asset according to its [limits](https://developers.cloudflare.com/pages/platform/limits/). Account eligibility/onboarding was not exercised here; if a payment prompt appears, do not enable paid products.

1. Run `npm ci`, `npm test`, then `npm run build` locally.
2. For a Pages Git integration, set framework to None, build command to `npm run build`, and output directory to `dist`. Use Node 24.13.0 for reproducibility. Alternatively upload the generated dist assets using Pages Direct Upload.
3. Use the provided pages.dev hostname. Do not add Functions, Workers compute, R2, databases, environment API keys or a paid domain.
4. Before release, test microphone permission and one real provider request on the HTTPS deployment using your own credentials. Browser CORS support can differ from mocked contracts.

The build is an allowlist: old backend/v2 files, tests, documentation, configuration and credentials are excluded. It refuses unexpected existing output files instead of silently publishing them. A content-derived service-worker cache version ensures changed builds update the shell. Waiting updates activate after old clients close; export RAM audio before closing.

## GitHub Pages alternative

Upload only generated dist contents through the Pages deployment mechanism; do not publish the repository root. A `.nojekyll` file is included. Relative URLs support a repository subpath. Pages publication is public even when source visibility differs. Keep credentials in browser settings only.

Changing origin creates a separate browser storage area: export the old site's JSON Library before moving, then import it on the new origin. Pending audio is not included in backups; finish, export or discard it separately.

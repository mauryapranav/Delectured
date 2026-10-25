# Static deployment

Live site: **[https://mauryapranav.github.io/Delectured/](https://mauryapranav.github.io/Delectured/)**.

## GitHub Pages

The repository uses [deploy-pages.yml](.github/workflows/deploy-pages.yml). On a push to `main` or a manual workflow run, it uses Node.js 24.13.0, installs locked dependencies, runs the test suite, builds the app and publishes **only `dist`**.

Repository Pages settings must use **GitHub Actions** as the build and deployment source. Provider API keys belong in the user's browser Settings; no provider credentials are required by this workflow.

## Local preview or another static host

```sh
npm ci
npm test
npm run build
python -m http.server 8000 --directory dist
```

Open [localhost:8000](http://localhost:8000/). The preview command needs Python 3; any static server can serve the generated directory. On another static host, use `npm run build` as the build command and `dist` as the output directory. Use HTTPS for microphone access outside localhost.

Do not serve repository-root HTML. The build assembles the shared page shell, packages the local runtime dependencies and versions the offline cache. It excludes tests, documentation, screenshots and assistant workspace files from the deployed site.

## Updates and moving a library

Finish active work and export RAM-only audio before closing tabs to activate an app update. Saved browser data should not be cleared as an update step.

Changing the hostname, protocol or port creates a separate browser storage area. Export a JSON backup on the old origin and import it on the new origin. Backups do not contain pending audio or provider keys; export retained audio separately and enter keys in the new site's Settings.

See [storage and recovery](README.md#storage-privacy-and-offline-use) and [testing and deployment](README.md#testing-and-deployment) for the remaining boundaries. Static hosting does not remove the selected AI providers' limits or charges.

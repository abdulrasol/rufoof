# Rufoof

Rufoof is an open-source inventory ledger built with React and Google Sheets. It supports Arabic and English, stock movements, stock counts, custom fields, Excel import/export, PDF printing, and installation as a web app.

## Attribution and license

Rufoof is released under the MIT License. When redistributing or creating a substantial derivative, retain `LICENSE`, `NOTICE`, and the copyright notice. Please credit **AbdulRasol Al-Hilo / Subul Technology** and identify Rufoof as the original project. The application was built with the assistance of AI tools under the developer's direction and review.

## Data ownership and plans

Users own their inventory and Google Sheets files. Rufoof does not inspect or copy spreadsheet contents to SubulTech servers; the browser accesses selected files directly through Google using the limited `drive.file` scope. SubulTech Identity is used for account identity, application activation, workbook references, and operational statistics—not inventory contents.

The free plan is intended for one ledger and basic usage. Future paid plans may provide multiple ledgers, higher limits, and advanced features; plan limits are active only when shown by SubulTech Identity.

## Development

Requires Node.js 22.12+ and pnpm 12.6.

```sh
pnpm install
pnpm dev
pnpm test
pnpm build
```

Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID`, `VITE_SUBULTECH_API_BASE_URL`, and the SubulTech application slug. Never place a Google client secret in the browser app or repository.

## Google and SubulTech Identity

Rufoof uses the central SubulTech Identity Google Cloud project and its public OAuth client. It requests only `openid email profile` and `https://www.googleapis.com/auth/drive.file`. Google Sheets and Drive APIs are required. Google access tokens remain in memory; the optional remembered session stores only the SubulTech refresh token locally.

The public product name is **Rufoof**. The application slug is an internal SubulTech integration identifier and must match the application registered in the backend.

## Privacy and hosting

The privacy policy and terms are published at [subultech.top/privacy](https://subultech.top/privacy/) and [subultech.top/term](https://subultech.top/term/). Build with `pnpm build` and publish the `dist` directory to Cloudflare Pages.

## Contributing

Run the tests and production build before contributing. Follow `AGENTS.md` when using coding agents. For reuse and redistribution, preserve the attribution notice in `NOTICE`.

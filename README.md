# Focus Study

Deep-focus study app: **run in any browser** (static site) or **install as a desktop app** built on **Chromium** via [Electron](https://www.electronjs.org/).

## Web (browser)

Requires a local HTTP server (ES modules):

```bash
cd focus-study-app
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Desktop (Chromium)

Install dependencies and start Electron:

```bash
npm install
npm start
```

The embedded browser uses Electron’s Chromium engine with a **session-level** `webRequest` filter so blocked/allowed rules apply to navigations and subresources, not only the address bar.

## Build installers

```bash
npm install -D electron-builder
npm run dist
```

Artifacts appear under `release/` (e.g. `.dmg` on macOS, `.AppImage` on Linux, portable `.exe` on Windows).

## GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create focus-study --public --source=. --remote=origin --push
```

Or create an empty repo on GitHub, then:

```bash
git remote add origin https://github.com/YOUR_USER/focus-study.git
git branch -M main
git push -u origin main
```

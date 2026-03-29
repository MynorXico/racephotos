# Tooling Setup — RaceShots

This document covers the one-time setup of developer tooling beyond the core
AWS/LocalStack stack. These tools are used by the Makefile targets and by
Claude Code agents during auto-validation.

---

## Prerequisites

| Tool        | Minimum version      | Check              |
| ----------- | -------------------- | ------------------ |
| Go          | 1.22                 | `go version`       |
| Node.js     | 18 LTS               | `node --version`   |
| npm / yarn  | npm 9+ or yarn 1.22+ | `npm --version`    |
| Angular CLI | 19                   | `ng version`       |
| Docker      | 24+                  | `docker --version` |

---

## 1. golangci-lint

Used by `make lint` and `make lint-check`. Aggregates `go vet`, `staticcheck`,
`errcheck`, and ~30 other linters in a single pass.

### Install

```bash
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh \
  | sh -s -- -b $(go env GOPATH)/bin v1.62.2
```

### Add GOPATH/bin to your shell PATH (if not already there)

```bash
# bash — add to ~/.bashrc
export PATH=$PATH:$(go env GOPATH)/bin

# zsh — add to ~/.zshrc
export PATH=$PATH:$(go env GOPATH)/bin
```

Reload your shell or run `source ~/.bashrc` (or `~/.zshrc`).

### Verify

```bash
golangci-lint --version
# golangci-lint has version 1.62.2 ...
```

### Usage

```bash
make lint            # lint all Lambdas and shared/
make lint-check      # same, used by git hooks — exits non-zero on any issue
```

To lint a single service:

```bash
cd lambdas/photo-upload && golangci-lint run ./...
```

---

## 2. Angular project (frontend/angular)

The Angular project lives at `frontend/angular/`. It was scaffolded with:

```bash
ng new racephotos \
  --directory=frontend/angular \
  --skip-git \
  --style=scss \
  --routing=true \
  --ssr=false
```

Angular CLI version: **19.2.5**

### Install dependencies (after cloning)

```bash
cd frontend/angular && npm install
```

### Useful scripts

| Command                        | What it does                                        |
| ------------------------------ | --------------------------------------------------- |
| `npm start`                    | Dev server on `http://localhost:4200` (hot reload)  |
| `npm run build`                | Production build to `dist/racephotos`               |
| `npm run test:ci`              | Unit tests (Karma/Jasmine), no watch, with coverage |
| `npm run e2e`                  | Playwright E2E tests (auto-starts dev server)       |
| `npm run e2e:update-snapshots` | Regenerate visual baseline screenshots              |

Or via the root Makefile:

```bash
make ng-build    # production build
make ng-test     # unit tests
make e2e         # Playwright E2E
```

---

## 3. Playwright (E2E testing)

Playwright is the E2E test framework for the Angular frontend. It provides:

- Full browser automation (Chromium, Mobile Chrome)
- Visual snapshot comparisons (screenshots committed as baselines)
- Used by agents to auto-validate UI acceptance criteria

### Playwright is already in package.json

It was added during project setup and installs automatically with `npm install`.

### Install browsers (one-time per machine)

```bash
cd frontend/angular && npx playwright install chromium
```

> **Note**: System dependencies (fonts, libs) normally require `sudo`.
> If `npx playwright install chromium --with-deps` fails due to missing sudo,
> install the following yourself:
>
> ```bash
> sudo apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
>   libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
>   libxrandr2 libgbm1 libasound2
> ```
>
> Then re-run `npx playwright install chromium`.

### Config file

`frontend/angular/playwright.config.ts` — key settings:

| Setting     | Value                    | Meaning                               |
| ----------- | ------------------------ | ------------------------------------- |
| `testDir`   | `./e2e`                  | Test files live in `e2e/**/*.spec.ts` |
| `baseURL`   | `http://localhost:4200`  | Angular dev server                    |
| `webServer` | `ng serve`               | Auto-started before tests run         |
| `projects`  | Chromium + Mobile Chrome | Tests run on both viewports           |

### Writing tests

```typescript
// e2e/search.spec.ts
import { test, expect } from '@playwright/test';

test('runner can search by bib number', async ({ page }) => {
  await page.goto('/events/evt-123/search');
  await page.getByLabel('Bib number').fill('42');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('photo-grid')).toBeVisible();
});
```

### Visual snapshot testing

```typescript
await expect(page).toHaveScreenshot('search-results.png');
```

Snapshots are stored alongside test files as `*.png`. **Commit these** — they
are the visual baseline. When a UI change is intentional:

```bash
npm run e2e:update-snapshots
```

Review the diff in your PR. Unexpected changes are caught here before merge.

### Running tests

```bash
# From frontend/angular:
npx playwright test                     # all tests
npx playwright test e2e/search.spec.ts  # single file
npx playwright test --headed            # with visible browser (debug)
npx playwright show-report              # open HTML report after a run
```

---

## 4. Playwright MCP (agent browser control)

The Playwright MCP server lets Claude Code agents control a real browser
directly — navigating, clicking, filling forms, taking screenshots — without
running Playwright test files. Used by validator agents for visual inspection.

### Install (global, one-time)

```bash
npm install -g @playwright/mcp
```

### Configure Claude Code

Register the server with the Claude Code CLI at user scope (applies to all projects):

```bash
claude mcp add playwright -s user -- playwright-mcp
```

> **Do not** create `~/.claude/mcp.json` — that file is not read by Claude Code.
> The correct config location is `~/.claude.json`, managed by the `claude mcp` CLI.

Verify registration:

```bash
claude mcp list
# playwright: playwright-mcp  - ✓ Connected
```

### Restart Claude Code to pick up MCP config

The MCP server connects at session startup. After running `claude mcp add`,
start a new Claude Code session.

### Verify

Start a new Claude Code session and check the available tools — you should see
`browser_navigate`, `browser_screenshot`, `browser_click`, etc.

### What agents use it for

- Navigate to a running dev server and verify rendered output
- Fill in a bib number search form and assert results appear
- Take full-page screenshots for visual comparison
- Check that error states (0 results, network error) render correctly

---

## 5. GitHub MCP server (agent GitHub access)

The GitHub MCP server gives Claude Code agents read/write access to the GitHub
API — opening PRs, reading issues, posting review comments — without leaving
the agent loop. Used by `/ship-feature` to create pull requests and by
`/review-story` to cross-reference open issues.

### Prerequisites

A GitHub Personal Access Token (classic or fine-grained) with at minimum:

- `repo` scope (read/write on code and pull requests)
- `write:discussion` if you want comment posting

Generate one at https://github.com/settings/tokens and store it in your shell
profile or `.env.local`:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

### Install (one-time, user scope)

```bash
claude mcp add github -s user -- npx -y @modelcontextprotocol/server-github
```

> The `-s user` flag installs the server at user scope so it is available in all
> projects, not just this one. The token is read from the environment at startup.

### Verify

```bash
claude mcp list
# github: npx -y @modelcontextprotocol/server-github  - ✓ Connected
```

If you see `✗ Failed`, confirm `GITHUB_PERSONAL_ACCESS_TOKEN` is exported in
your current shell (not just `.env.local` — that is loaded by the Angular dev
server, not by Claude Code itself).

### Restart Claude Code to pick up MCP config

The MCP server connects at session startup. After running `claude mcp add`,
start a new Claude Code session.

### What agents use it for

- Creating pull requests from feature branches after `/ship-feature`
- Posting test plan results as PR comments
- Reading open issues to understand context before writing a story

---

## 6. Adding a golangci-lint config (recommended)

Create `lambdas/.golangci.yml` (one config shared by all Lambdas via `--config`):

```yaml
# .golangci.yml
linters:
  enable:
    - errcheck
    - gosimple
    - govet
    - ineffassign
    - staticcheck
    - unused
    - contextcheck # enforces ctx propagation
    - wrapcheck # enforces error wrapping

linters-settings:
  errcheck:
    check-type-assertions: true
  wrapcheck:
    ignorePackageGlobs:
      - github.com/racephotos/* # internal errors don't need wrapping

issues:
  max-issues-per-linter: 0
  max-same-issues: 0
```

Pass it explicitly when needed:

```bash
golangci-lint run --config ../../.golangci.yml ./...
```

---

## Summary: full toolchain check

Run this after setup to confirm everything is wired correctly:

```bash
# From repo root
export PATH=$PATH:$(go env GOPATH)/bin

golangci-lint --version         # 1.62.2
cd frontend/angular
ng version | grep "Angular CLI" # 19.x
npx playwright --version        # 1.x
playwright-mcp --version        # confirms MCP binary is on PATH
claude mcp list
# playwright: playwright-mcp                         - ✓ Connected
# github:     npx -y @modelcontextprotocol/server-github  - ✓ Connected
```

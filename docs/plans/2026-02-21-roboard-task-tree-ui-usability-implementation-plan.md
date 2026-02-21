# RoBoard Task Tree UI Usability P0 Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix P0 Task Tree UI usability issues: stale auto-connect causing "已断开", unclear errors, and better feedback for task creation.

**Architecture:** Frontend-only changes in `web-frontend/` to clear stale local state, validate persisted `roboard_run_id` before auto-connect, and show actionable WebSocket/API error messages. Avoid backend refactors.

**Tech Stack:** Vanilla JavaScript, localStorage, WebSocket, FastAPI.

---

## Root Cause Evidence (Observed)

- Task Tree UI persists `roboard_run_id` in localStorage and auto-connects if present.
- When the stored run_id is invalid or belongs to a different tenant/session, backend WS `/ws/runs/{run_id}` closes with code `1008` and the UI ends up showing "已断开" without guidance.
- Create-task failures (401/403/429) are not surfaced with actionable messaging.

---

## Notes About Verification Tooling

This repo's most reliable E2E verification path (for this plan) is Playwright MCP `browser_run_code` snippets.

Do NOT assume `npx playwright test` is set up.

---

### Task 1: Clear persisted run_id on Task Tree logout

**Files:**
- Modify: `web-frontend/app.js` (inside `initTaskTreePage()` -> `logout()`)

**Step 1: Reproduce current behavior**

Run via Playwright MCP (snippet assumes you're already logged in):

```javascript
await page.goto('https://roboard.duckdns.org/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#add-task-btn');

// Create a task
await page.locator('#add-task-btn').click();
await page.waitForSelector('#add-task-modal:not(.is-hidden)');
await page.locator('#task-input-nl').fill('Test task');
await page.locator('#add-task-form').dispatchEvent('submit');
await page.waitForTimeout(3000);

const runIdBefore = await page.evaluate(() => localStorage.getItem('roboard_run_id'));
console.log('runIdBeforeLogout', runIdBefore);

await page.locator('#logout-btn').click();
await page.waitForTimeout(1500);

const runIdAfter = await page.evaluate(() => localStorage.getItem('roboard_run_id'));
console.log('runIdAfterLogout', runIdAfter);
```

Expected (buggy): `runIdAfterLogout` may remain set.

**Step 2: Implement minimal fix**

- In `logout()`:
  - call `disconnectWs()`
  - `localStorage.removeItem('roboard_run_id')`
  - clear any UI message and set connection pill to idle

**Step 3: Re-run Step 1**

Expected: `runIdAfterLogout` is null.

**Step 4: Commit**

```bash
git add web-frontend/app.js
git commit -m "fix: clear persisted run_id on task tree logout"
```

---

### Task 2: Validate stored run_id before auto-connect

**Files:**
- Modify: `web-frontend/app.js` (inside `initTaskTreePage()` -> `bootstrapAuth()`)

**Step 1: Reproduce current bug**

```javascript
await page.goto('https://roboard.duckdns.org/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#add-task-btn');

await page.evaluate(() => localStorage.setItem('roboard_run_id', '999999999'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const pillText = await page.locator('#task-connection-pill').innerText().catch(() => '');
const msgText = await page.locator('#task-message').innerText().catch(() => '');
console.log({ pillText, msgText });
```

Expected (buggy): a fast disconnect (or error) without an actionable explanation.

**Step 2: Implement minimal fix**

- In `bootstrapAuth()`:
  - read `storedRunId` from localStorage
  - before calling `connectWs()`, validate it via `GET /api/runs/{id}/tree` (or `GET /api/runs/{id}`):
    - if 200: proceed with `connectWs()`
    - if 401/403/404: clear localStorage `roboard_run_id`, set status idle, set message: "历史任务不可访问，已清理。请创建新任务。"

**Step 3: Re-run Step 1**

Expected: no auto-connect attempt; run_id cleared; actionable message shown.

**Step 4: Commit**

```bash
git add web-frontend/app.js
git commit -m "fix: validate stored run_id before task tree auto-connect"
```

---

### Task 3: Improve WS close messaging (fast-close / 1008)

**Files:**
- Modify: `web-frontend/app.js` (Task Tree WS `close` handler)

**Step 1: Implement**

- In WS close handler, use `event.code`:
  - `1008`: show: "连接被拒绝（会话/租户不匹配或任务不可访问）。已清理历史任务，请创建新任务。"
  - default: keep generic.

**Step 2: Verify**

Use Task 2 reproduction snippet and confirm message changes.

**Step 3: Commit**

```bash
git add web-frontend/app.js
git commit -m "fix: show actionable message on ws close"
```

---

### Task 4: Improve create-task error feedback for POST /api/runs

**Files:**
- Modify: `web-frontend/app.js` (Task Tree `createRun()`)

**Step 1: Implement**

- When `POST /api/runs` fails, map common errors:
  - 401/403: "登录已失效，请重新登录"
  - 429: "触发并发/速率限制，请稍后再试" (append backend `detail`)

**Step 2: Verify**

Create tasks rapidly to trigger 429 and confirm message.

**Step 3: Commit**

```bash
git add web-frontend/app.js
git commit -m "fix: improve task tree create task error messaging"
```

---

## End-to-End Verification (Playwright MCP)

After completing Tasks 1-4, run a final Playwright MCP snippet:

```javascript
await page.goto('https://roboard.duckdns.org/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#add-task-btn');
await page.evaluate(() => localStorage.removeItem('roboard_run_id'));
await page.reload({ waitUntil: 'domcontentloaded' });

await page.locator('#add-task-btn').click();
await page.waitForSelector('#add-task-modal:not(.is-hidden)');
await page.locator('#task-input-nl').fill('Sanity run');
await page.locator('#add-task-form').dispatchEvent('submit');
await page.waitForTimeout(4000);

console.log('pill', await page.locator('#task-connection-pill').innerText().catch(() => ''));
console.log('msg', await page.locator('#task-message').innerText().catch(() => ''));
```

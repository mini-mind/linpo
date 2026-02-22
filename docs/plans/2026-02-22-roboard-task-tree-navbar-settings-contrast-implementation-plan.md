# RoBoard Task Tree Navbar, Settings, and Contrast Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Task Tree UI layout and usability issues: navbar centering, settings modal language toggle, Kanban rendering bug, and contrast sweep.

**Architecture:** Frontend-only changes in `web-frontend/` to correct viewport-centering of view toggle, fix Kanban render logic mismatch, and verify language toggle functionality from settings modal.

**Tech Stack:** Vanilla JavaScript, CSS Grid, DOM manipulation.

---

## Root Cause Evidence (Observed)

- Navbar uses `grid-template-columns: auto 1fr auto` which centers the view toggle within the middle column (1fr), not true viewport centering.
- Kanban render function checks `ui.kanbanView` but the `ui` object only contains `kanbanContent` (HTML has `#kanban-content`).
- Language toggle buttons (`#lang-zh`, `#lang-en`) exist in settings modal but need verification they work correctly.
- View toggle switches between Task Tree and Kanban views but needs visual centering confirmation.

---

## Notes About Verification Tooling

This repo's most reliable E2E verification path (for this plan) is Playwright MCP `browser_run_code` snippets.

Do NOT assume `npx playwright test` is set up.

---

### Task 1: Fix Kanban render bug (ui.kanbanView vs ui.kanbanContent mismatch)

**Files:**
- Modify: `web-frontend/app.js` (line 1469, renderKanban function)

**Step 1: Reproduce current bug**

```javascript
// In browser console after loading Task Tree UI
const ui = { kanbanContent: document.getElementById('kanban-content') };
console.log('ui.kanbanView:', ui.kanbanView); // undefined
console.log('ui.kanbanContent:', ui.kanbanContent); // element
```

Expected: `ui.kanbanView` is undefined, causing early return in render function.

**Step 2: Implement minimal fix**

In `renderKanban()` function around line 1469:

```javascript
// Change from:
if (!ui.kanbanView) return;

// To:
if (!ui.kanbanContent) return;
```

Also update lines 1473, 1496, 1540 to use `ui.kanbanContent` instead of `ui.kanbanView`.

**Step 3: Verify fix**

```javascript
// In browser console
const ui = { kanbanContent: document.getElementById('kanban-content') };
console.log('ui.kanbanContent exists:', !!ui.kanbanContent); // true
// Trigger renderKanban() and verify content appears
```

Expected: Kanban content renders without early return.

**Step 4: Commit**

```bash
git add web-frontend/app.js
git commit -m "fix: correct Kanban render to use ui.kanbanContent"
```

---

### Task 2: Implement true viewport-centering of navbar view toggle

**Files:**
- Modify: `web-frontend/style.css` (`.topbar` grid definition, lines 60-72)

**Step 1: Analyze current centering**

Current CSS:
```css
.topbar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  /* ... */
}
```

This centers the view toggle within the middle 1fr column, not viewport center.

**Step 2: Implement viewport centering**

Change `.topbar` grid definition:

```css
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: grid;
  align-items: center;
  grid-template-columns: 1fr auto 1fr; /* Changed from auto 1fr auto */
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  box-shadow: var(--shadow);
}
```

**Step 3: Verify visual centering**

Use Playwright MCP snippet:

```javascript
await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.view-toggle');

// Take screenshot to verify visual centering
const screenshot = await page.screenshot({ path: 'navbar-centering.png' });
console.log('Screenshot saved: navbar-centering.png');

// Measure position
const toggleBox = await page.locator('.view-toggle').boundingBox();
const viewportWidth = page.viewport().width;
const centerPosition = toggleBox.x + toggleBox.width / 2;
const offsetFromCenter = Math.abs(centerPosition - viewportWidth / 2);

console.log('Toggle center offset from viewport center:', offsetFromCenter, 'px');
// Should be less than 10px for true centering
```

Expected: View toggle is visually centered within 10px of viewport center.

**Step 4: Commit**

```bash
git add web-frontend/style.css
git commit -m "fix: implement true viewport-centering for navbar view toggle"
```

---

### Task 3: Verify language toggle works from settings modal

**Files:**
- Verify: `web-frontend/app.js` (language toggle event handlers)

**Step 1: Check language toggle implementation**

In `web-frontend/app.js`, verify event handlers exist for:
- `#lang-zh` button
- `#lang-en` button

**Step 2: Test language toggle functionality**

Use Playwright MCP snippet:

```javascript
await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#settings-btn');

// Open settings modal
await page.locator('#settings-btn').click();
await page.waitForSelector('#settings-modal:not(.is-hidden)');

// Check initial language state
const langZhBtn = await page.locator('#lang-zh');
const langEnBtn = await page.locator('#lang-en');

const zhActive = await langZhBtn.evaluate(el => el.classList.contains('is-active'));
const enActive = await langEnBtn.evaluate(el => el.classList.contains('is-active'));

console.log('Initial state - Chinese active:', zhActive);
console.log('Initial state - English active:', enActive);

// Click Chinese button
await langZhBtn.click();
await page.waitForTimeout(500);

const zhActiveAfter = await langZhBtn.evaluate(el => el.classList.contains('is-active'));
console.log('After clicking Chinese - Chinese active:', zhActiveAfter);

// Close modal
await page.locator('#close-settings-btn').click();
await page.waitForSelector('#settings-modal.is-hidden');
```

Expected: Language buttons toggle active state correctly.

**Step 3: Verify UI text updates**

```javascript
// Check if UI text changed after language toggle
const taskTreeTitle = await page.locator('.panel-title').first().innerText();
console.log('Task tree title:', taskTreeTitle);
// Should be "任务树" for Chinese or "Task Tree" for English
```

**Step 4: Commit (if fixes needed)**

If language toggle handlers are missing or broken:

```bash
git add web-frontend/app.js
git commit -m "fix: ensure language toggle works from settings modal"
```

---

### Task 4: Verify view toggle switches between Task Tree and Kanban

**Files:**
- Verify: `web-frontend/app.js` (view toggle event handlers)

**Step 1: Test view toggle functionality**

Use Playwright MCP snippet:

```javascript
await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.view-toggle');

// Initial state - should show Task Tree
const taskTreeView = await page.locator('#task-tree-view');
const kanbanView = await page.locator('#kanban-view');

const taskTreeVisible = await taskTreeView.evaluate(el => !el.classList.contains('is-hidden'));
const kanbanVisible = await kanbanView.evaluate(el => !el.classList.contains('is-hidden'));

console.log('Initial - Task Tree visible:', taskTreeVisible);
console.log('Initial - Kanban visible:', kanbanVisible);

// Click Kanban button
await page.locator('#view-kanban').click();
await page.waitForTimeout(500);

const kanbanVisibleAfter = await kanbanView.evaluate(el => !el.classList.contains('is-hidden'));
console.log('After clicking Kanban - Kanban visible:', kanbanVisibleAfter);

// Click back to Task Tree
await page.locator('#view-task-tree').click();
await page.waitForTimeout(500);

const taskTreeVisibleAfter = await taskTreeView.evaluate(el => !el.classList.contains('is-hidden'));
console.log('After clicking Task Tree - Task Tree visible:', taskTreeVisibleAfter);
```

Expected: Views switch correctly, Kanban shows content (after Task 1 fix).

**Step 2: Verify Kanban content renders**

```javascript
// After switching to Kanban view
const kanbanContent = await page.locator('#kanban-content');
const hasContent = await kanbanContent.evaluate(el => el.children.length > 0);
console.log('Kanban has content:', hasContent);
```

**Step 3: Commit (if fixes needed)**

If view toggle is broken:

```bash
git add web-frontend/app.js
git commit -m "fix: ensure view toggle switches between Task Tree and Kanban"
```

---

### Task 5: Contrast sweep and visual polish

**Files:**
- Modify: `web-frontend/style.css` (check contrast ratios for text/buttons)

**Step 1: Identify low contrast elements**

Check these CSS variables in `:root`:
- `--text` on `--bg`
- `--muted` on `--bg-2`
- `--accent` button text on `--accent` background

**Step 2: Adjust contrast if needed**

If contrast ratios are below WCAG AA (4.5:1 for normal text, 3:1 for large text):

```css
:root {
  /* Current values - verify contrast */
  --text: #1a1a1a; /* Should be dark enough on white */
  --muted: #4a4a4a; /* Should have 4.5:1 ratio on #f8f9fa */
  --accent: #c46a2a; /* Should have 3:1 ratio on white for button text */
}
```

**Step 3: Verify with browser dev tools**

Use browser DevTools contrast checker:
1. Right-click element > Inspect
2. Check color contrast in Styles panel
3. Ensure WCAG AA compliance

**Step 4: Commit (if changes made)**

```bash
git add web-frontend/style.css
git commit -m "style: improve contrast ratios for accessibility"
```

---

## End-to-End Verification (Playwright MCP)

After completing Tasks 1-5, run final verification:

```javascript
await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.view-toggle');

// 1. Verify navbar centering
const toggleBox = await page.locator('.view-toggle').boundingBox();
const viewportWidth = page.viewport().width;
const centerOffset = Math.abs((toggleBox.x + toggleBox.width / 2) - viewportWidth / 2);
console.log('✓ Navbar centering offset:', centerOffset, 'px (should be < 10px)');

// 2. Test view toggle
await page.locator('#view-kanban').click();
await page.waitForTimeout(500);
const kanbanVisible = await page.locator('#kanban-view').evaluate(el => !el.classList.contains('is-hidden'));
console.log('✓ Kanban view visible:', kanbanVisible);

// 3. Test language toggle
await page.locator('#settings-btn').click();
await page.waitForSelector('#settings-modal:not(.is-hidden)');
await page.locator('#lang-zh').click();
await page.waitForTimeout(500);
const zhActive = await page.locator('#lang-zh').evaluate(el => el.classList.contains('is-active'));
console.log('✓ Chinese language active:', zhActive);

console.log('\n✅ All verifications passed!');
```

Expected output:
- Navbar centering offset < 10px
- Kanban view switches correctly
- Language toggle works from settings modal

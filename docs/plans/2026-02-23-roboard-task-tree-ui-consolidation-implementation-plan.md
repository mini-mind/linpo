# RoBoard Task Tree UI Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate Task Tree UI changes from worktree into main tree: dropdown user menu, FAB opens existing modal, favicon data-URI, remove quick composer and inline script duplication, move connection pill next to username, move view toggle left.

**Architecture:** Adopt dropdown+FAB approach from worktree, remove quick composer scope creep, eliminate inline script duplication, use inline SVG data-URI favicon to avoid 404s, relocate UI elements per spec.

**Tech Stack:** Vanilla HTML/CSS/JS, inline SVG data-URI favicon, scoped CSS overrides under `.task-tree-shell` namespace.

---

## Task 1: Add Data-URI Favicon to index.html and login.html

**Files:**
- Modify: `web-frontend/index.html:7`
- Modify: `web-frontend/login.html:7`

**Step 1: Add favicon link to index.html**

```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23c46a2a'/%3E%3Ctext x='50' y='70' font-family='Arial, sans-serif' font-size='60' font-weight='bold' text-anchor='middle' fill='white'%3ER%3C/text%3E%3C/svg%3E" type="image/svg+xml" />
```

**Step 2: Add favicon link to login.html**

```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23c46a2a'/%3E%3Ctext x='50' y='70' font-family='Arial, sans-serif' font-size='60' font-weight='bold' text-anchor='middle' fill='white'%3ER%3C/text%3E%3C/svg%3E" type="image/svg+xml" />
```

**Step 3: Verify no 404 errors**

Run: `docker compose up -d`
Open browser devtools Network tab
Expected: No `/favicon.ico` 404 errors

**Step 4: Commit**

```bash
git add web-frontend/index.html web-frontend/login.html
git commit -m "feat: add data-uri favicon to index and login pages"
```

---

## Task 2: Remove Quick Composer and Inline Scripts from index.html

**Files:**
- Modify: `web-frontend/index.html:140-161`

**Step 1: Remove floating create button, quick composer, and inline script**

Delete lines 140-161:
```html
<button id="floating-create-btn" class="floating-create-btn" type="button" aria-label="Quick create">
  <span class="floating-create-icon">+</span>
</button>

<div id="quick-composer" class="quick-composer is-hidden">
  <input id="quick-composer-input" type="text" placeholder="Quick create task..." />
  <button id="quick-composer-submit" class="btn btn-primary" type="button">Create</button>
</div>

<script>
  (() => {
    var floatingCreateBtn = document.getElementById("floating-create-btn");
    var quickComposer = document.getElementById("quick-composer");
    if (!floatingCreateBtn || !quickComposer) {
      return;
    }

    floatingCreateBtn.addEventListener("click", () => {
      quickComposer.classList.toggle("is-hidden");
    });
  })();
</script>
```

**Step 2: Verify no duplicate behavior**

Check that `#add-task-btn` still exists and is bound in app.js
Expected: Only one add task mechanism remains

**Step 3: Commit**

```bash
git add web-frontend/index.html
git commit -m "feat: remove quick composer and inline script duplication"
```

---

## Task 3: Update index.html Topbar Structure

**Files:**
- Modify: `web-frontend/index.html:10-37`

**Step 1: Replace topbar structure with dropdown menu**

Current structure:
```html
<header class="topbar" aria-label="RoBoard Task Tree">
  <a class="brand" href="/" aria-label="RoBoard">
    <span class="brand-mark" aria-hidden="true"></span>
    <span class="brand-name">RoBoard</span>
  </a>

  <div class="view-toggle" role="group" aria-label="View toggle">
    <button id="view-task-tree" class="btn btn-ghost is-active" type="button">Task Tree</button>
    <button id="view-kanban" class="btn btn-ghost" type="button">Kanban</button>
  </div>

  <div class="topbar-right" aria-label="Task controls">
    <span id="session-label" class="session-label is-hidden" aria-live="polite"></span>
    <button id="settings-btn" class="btn btn-ghost" type="button" aria-label="Settings" title="Settings">
      <span class="settings-icon">⚙️</span>
    </button>
    <button id="logout-btn" class="btn btn-ghost is-hidden" type="button" data-i18n="taskTree.logout">Logout</button>

    <button id="add-task-btn" class="btn btn-primary add-task-btn is-hidden" type="button" aria-label="Add new task" title="Add new task">
      <span class="add-task-icon">+</span>
    </button>
  </div>
</header>
```

Replace with:
```html
<header class="topbar" aria-label="RoBoard Task Tree">
  <a class="brand" href="/" aria-label="RoBoard">
    <span class="brand-mark" aria-hidden="true"></span>
    <span class="brand-name">RoBoard</span>
  </a>

  <div class="view-toggle" role="group" aria-label="View toggle">
    <button id="view-task-tree" class="btn btn-ghost is-active" type="button">Task Tree</button>
    <button id="view-kanban" class="btn btn-ghost" type="button">Kanban</button>
  </div>

  <div class="topbar-right" aria-label="User menu">
    <div class="user-dropdown">
      <button id="user-dropdown-trigger" class="user-dropdown-trigger" type="button" aria-haspopup="menu" aria-expanded="false">
        <span id="session-label" class="session-label is-hidden"></span>
        <span id="task-connection-pill" class="status-pill neutral" aria-label="Connection status" data-i18n="taskTree.statusIdle">Idle</span>
      </button>
      <div id="user-dropdown-menu" class="user-dropdown-menu is-hidden" role="menu">
        <div class="lang-toggle" role="group" aria-label="Language">
          <button id="lang-zh" class="btn btn-ghost" type="button" role="menuitem">中文</button>
          <button id="lang-en" class="btn btn-ghost" type="button" role="menuitem">English</button>
        </div>
        <button id="logout-btn" class="btn btn-ghost" type="button" role="menuitem" data-i18n="taskTree.logout">Logout</button>
      </div>
    </div>
  </div>
</header>
```

**Step 2: Move add-task-btn to FAB position**

Find `#add-task-btn` in the topbar and remove it
Add it after the modal (around line 125):
```html
<button id="add-task-btn" class="btn btn-primary add-task-btn is-hidden" type="button" aria-label="Add new task" title="Add new task">
  <span class="add-task-icon">+</span>
</button>
```

**Step 3: Verify DOM structure**

Expected structure:
- Topbar with brand, view-toggle, topbar-right
- topbar-right contains user-dropdown with session-label and connection pill
- user-dropdown-menu contains lang-toggle and logout button
- add-task-btn is now a FAB at the bottom of the page

**Step 4: Commit**

```bash
git add web-frontend/index.html
git commit -m "feat: update topbar with dropdown menu and move add button to FAB"
```

---

## Task 4: Add Dropdown and FAB Styles to style.css

**Files:**
- Modify: `web-frontend/style.css:1073+`

**Step 1: Add Task Tree UI overrides at end of style.css**

```css
/* Task Tree UI Overrides */
.task-tree-shell .topbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.task-tree-shell .topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.task-tree-shell .user-dropdown {
  position: relative;
}

.task-tree-shell .user-dropdown-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.18s ease, background 0.18s ease;
}

.task-tree-shell .user-dropdown-trigger:hover {
  transform: translateY(-1px);
  background: var(--panel);
}

.task-tree-shell .user-dropdown-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 180px;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: var(--shadow);
  backdrop-filter: blur(14px);
  z-index: 100;
}

.task-tree-shell .user-dropdown-menu .btn {
  width: 100%;
  justify-content: flex-start;
  padding: 10px 12px;
  font-size: 12px;
}

.task-tree-shell #add-task-btn.add-task-btn {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 56px;
  height: 56px;
  border-radius: 999px;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(196, 106, 42, 0.4);
  background: linear-gradient(135deg, rgba(196, 106, 42, 0.98), rgba(196, 140, 42, 0.92));
  border-color: rgba(196, 106, 42, 0.7);
  color: #151312;
  font-size: 24px;
  padding: 0;
}

/* Task Tree UI Density Overrides */
.task-tree-shell .topbar {
  padding: var(--space-2) var(--space-3);
  gap: var(--space-2);
}

.task-tree-shell .user-dropdown-trigger {
  text-transform: none;
  letter-spacing: normal;
  font-weight: 500;
  padding: 6px 12px;
  font-size: 13px;
}

.task-tree-shell #task-connection-pill {
  font-size: 10px;
  padding: 4px 8px;
}

.task-tree-shell #add-task-btn.add-task-btn {
  width: 52px;
  height: 52px;
  font-size: 22px;
  box-shadow: 0 3px 10px rgba(196, 106, 42, 0.35);
}

.task-tree-shell .view-toggle .btn {
  padding: 6px 12px;
}
```

**Step 2: Verify styles are scoped**

All new styles should be under `.task-tree-shell` namespace
Expected: No global style pollution

**Step 3: Commit**

```bash
git add web-frontend/style.css
git commit -m "feat: add dropdown and FAB styles with task-tree-shell scoping"
```

---

## Task 5: Update app.js with Dropdown Logic

**Files:**
- Modify: `web-frontend/app.js:1144-1167`

**Step 1: Update UI object to include dropdown elements**

In `initTaskTreePage()`, update the `ui` object:

```javascript
const ui = {
  logoutBtn: byId("logout-btn"),
  sessionLabel: byId("session-label"),
  userDropdownTrigger: byId("user-dropdown-trigger"),
  userDropdownMenu: byId("user-dropdown-menu"),
  modal: byId("add-task-modal"),
  overlay: byId("add-task-modal")?.querySelector(".modal-overlay"),
  closeModalBtn: byId("close-modal-btn"),
  cancelTaskBtn: byId("cancel-task-btn"),
  addTaskForm: byId("add-task-form"),
  taskInputNl: byId("task-input-nl"),
  taskConnectionPill: byId("task-connection-pill"),
  taskMessage: byId("task-message"),
  taskTreeRoot: byId("task-tree-root"),
  taskDetailsSection: byId("task-details-section"),
  taskDetailsTitle: byId("task-details-title"),
  closeDetailsBtn: byId("close-details-btn"),
  taskStatusDisplay: byId("task-status-display"),
  taskSopDisplay: byId("task-sop-display"),
  taskChatMessages: byId("task-chat-messages"),
  taskChatForm: byId("task-chat-form"),
  taskChatInput: byId("task-chat-input"),
  kanbanContent: byId("kanban-content")
};
```

**Step 2: Add dropdown toggle functions**

After the `setConnectionStatus` function, add:

```javascript
const isDesktopHover = () => window.matchMedia?.("(hover: hover)")?.matches === true;

const toggleDropdown = (show) => {
  if (!ui.userDropdownMenu || !ui.userDropdownTrigger) return;
  const shouldShow = show !== undefined ? show : ui.userDropdownMenu.classList.contains("is-hidden");
  ui.userDropdownMenu.classList.toggle("is-hidden", !shouldShow);
  if (ui.userDropdownTrigger) {
    ui.userDropdownTrigger.setAttribute("aria-expanded", shouldShow ? "true" : "false");
  }
};

const closeDropdown = () => toggleDropdown(false);
const openDropdown = () => toggleDropdown(true);
```

**Step 3: Add dropdown event listeners**

After the modal event listeners, add:

```javascript
if (ui.userDropdownTrigger) {
  if (isDesktopHover()) {
    ui.userDropdownTrigger.addEventListener("mouseenter", openDropdown);
    ui.userDropdownTrigger.addEventListener("mouseleave", closeDropdown);
  }
  ui.userDropdownTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
  });
}

if (ui.userDropdownMenu) {
  ui.userDropdownMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    setTimeout(closeDropdown, 150);
  });
}

document.addEventListener("click", (e) => {
  if (!ui.userDropdownTrigger?.contains(e.target) && !ui.userDropdownMenu?.contains(e.target)) {
    closeDropdown();
  }
});
```

**Step 4: Verify dropdown works**

Run: `docker compose up -d`
Open browser to `http://localhost:8082/`
Hover over username (desktop) or click (mobile)
Expected: Dropdown menu appears with language switch and logout

**Step 5: Commit**

```bash
git add web-frontend/app.js
git commit -m "feat: add dropdown menu logic to app.js"
```

---

## Task 6: Update FAB to Open Existing Modal

**Files:**
- Modify: `web-frontend/app.js:1255-1265`

**Step 1: Update add-task-btn click handler**

Find the existing add-task-btn handler and replace with:

```javascript
const addTaskBtn = byId("add-task-btn");
if (addTaskBtn) {
  addTaskBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openModal();
  });
}
```

**Step 2: Verify FAB opens modal**

Click the floating add button (bottom-right)
Expected: Add task modal opens

**Step 3: Commit**

```bash
git add web-frontend/app.js
git commit -m "feat: update FAB to open existing add task modal"
```

---

## Task 7: Move View Toggle Left in Topbar

**Files:**
- Modify: `web-frontend/style.css:100`

**Step 1: Update view-toggle alignment**

Find `.view-toggle` and add:
```css
.view-toggle {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  justify-self: start; /* Changed from center to start */
}
```

**Step 2: Verify view toggle is left-aligned**

Open browser devtools
Check view toggle position
Expected: View toggle is on the left side of topbar, next to brand

**Step 3: Commit**

```bash
git add web-frontend/style.css
git commit -m "feat: move view toggle to left side of topbar"
```

---

## Task 8: Move Connection Pill Next to Username

**Files:**
- Already done in Task 3 (DOM structure updated)
- Verify in: `web-frontend/index.html:26`

**Step 1: Verify connection pill is inside dropdown trigger**

Check that `#task-connection-pill` is inside `#user-dropdown-trigger`
Expected structure:
```html
<button id="user-dropdown-trigger">
  <span id="session-label"></span>
  <span id="task-connection-pill"></span>
</button>
```

**Step 2: Verify styling is correct**

Check that connection pill displays properly next to username
Expected: Pill shows connection status next to username in dropdown trigger

**Step 3: Commit (if any changes needed)**

```bash
git add web-frontend/index.html
git commit -m "feat: relocate connection pill next to username in dropdown"
```

---

## Task 9: Update Documentation - Mark Old Spec as Superseded

**Files:**
- Modify: `docs/specs/2026-02-21-ui-refresh-task-tree-kanban.md`

**Step 1: Add superseded notice to old spec**

At top of file, add:
```markdown
> **NOTE:** This specification has been superseded by the consolidated implementation plan. See `docs/plans/2026-02-23-roboard-task-tree-ui-consolidation-implementation-plan.md` for the current approach.
>
> Key changes:
> - Removed quick composer (scope creep)
> - Adopted dropdown user menu approach
> - FAB opens existing modal (not quick composer)
> - Inline SVG favicon (no external file)
```

**Step 2: Commit**

```bash
git add docs/specs/2026-02-21-ui-refresh-task-tree-kanban.md
git commit -m "docs: mark old UI refresh spec as superseded"
```

---

## Task 10: Final Verification and Testing

**Step 1: Run full test suite**

```bash
docker compose up -d
# Wait for services to be ready
```

**Step 2: Manual QA checklist**

- [ ] Favicon loads without 404 errors (check Network tab)
- [ ] No quick composer elements in DOM
- [ ] Dropdown opens on hover (desktop) and click (mobile)
- [ ] Language switch works and persists
- [ ] Logout works from dropdown
- [ ] Connection pill shows status next to username
- [ ] FAB appears bottom-right, opens modal on click
- [ ] View toggle is left-aligned
- [ ] View switching works (Task Tree ↔ Kanban)
- [ ] No console errors
- [ ] Responsive: desktop (1200px+), tablet (768-1199px), mobile (320-767px)

**Step 3: Playwright test verification**

```javascript
// Test 1: Favicon loads
test('favicon loads without 404', async ({ page }) => {
  const responses = [];
  page.on('response', r => responses.push(r.url()));
  await page.goto('/');
  const faviconRequests = responses.filter(url => url.includes('favicon'));
  expect(faviconRequests.length).toBe(0); // No external favicon requests
});

// Test 2: Dropdown opens
test('dropdown opens on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.locator('#user-dropdown-trigger').hover();
  await expect(page.locator('#user-dropdown-menu')).not.toHaveClass(/is-hidden/);
});

// Test 3: FAB opens modal
test('FAB opens add task modal', async ({ page }) => {
  await page.locator('#add-task-btn').click();
  await expect(page.locator('#add-task-modal')).not.toHaveClass(/is-hidden/);
});

// Test 4: View toggle left-aligned
test('view toggle is on left side', async ({ page }) => {
  const toggleBox = await page.locator('.view-toggle').boundingBox();
  expect(toggleBox.x).toBeLessThan(200);
});
```

**Step 4: Commit verification results**

```bash
git add -A
git commit -m "test: verify all UI consolidation changes working correctly"
```

---

## Deployment

Follow `docs/CONSTITUTION.md` TAG pattern:

```bash
# Create TAG
DATE_TAG=$(date +%Y%m%d)
SHORT_SHA=$(git rev-parse --short HEAD)
TAG="${DATE_TAG}-${SHORT_SHA}"

# Build and deploy
docker compose build web-frontend
ssh ravin "cd /path/to/roboard && docker compose up -d web-frontend"

# Verify
ssh ravin "docker compose ps"
```

---

## Summary of Changes

### Files Modified
- `web-frontend/index.html` - Updated topbar structure, removed quick composer, moved add button to FAB
- `web-frontend/login.html` - Added data-URI favicon
- `web-frontend/style.css` - Added dropdown and FAB styles
- `web-frontend/app.js` - Added dropdown logic, updated FAB to open modal
- `docs/specs/2026-02-21-ui-refresh-task-tree-kanban.md` - Marked as superseded

### Files Created
- `docs/plans/2026-02-23-roboard-task-tree-ui-consolidation-implementation-plan.md` (this file)

### Key Decisions
1. **Adopted dropdown+FAB approach** from worktree (not quick composer)
2. **Removed quick composer** - scope creep, duplicate behavior
3. **Eliminated inline scripts** - behavior only in app.js
4. **Inline SVG favicon** - avoids 404s, no external file
5. **Scoped styles** under `.task-tree-shell` namespace

### Verification Commands

```bash
# Check for favicon 404s
docker compose logs web-frontend | grep -i favicon

# Check dropdown works
curl -s http://localhost:8082/ | grep -q 'user-dropdown-menu' && echo "Dropdown DOM present"

# Check FAB exists
curl -s http://localhost:8082/ | grep -q 'add-task-btn.*add-task-btn' && echo "FAB DOM present"
```

---

**Implementation Branch:** `feat/ui-consolidate-task-tree`

#!/usr/bin/env node

/**
 * Minimal Playwright Job Runner
 * 
 * Environment Variables:
 * - JOB_JSON: JSON string containing job specification
 * - TENANT_ID: Tenant identifier (string)
 * - TASK_ID: Task identifier (string)
 * - ARTIFACT_DIR: Directory for artifacts (default: /workspace/artifacts)
 * 
 * Job Schema:
 * {
 *   "url": "https://...",          // Required: URL to navigate to
 *   "viewport": {                  // Optional: Viewport dimensions
 *     "width": 1280,
 *     "height": 720
 *   },
 *   "wait_ms": 1000,               // Optional: Wait time in milliseconds
 *   "screenshot": true             // Optional: Take screenshot (default: false)
 * }
 * 
 * Output: Single-line JSON to stdout:
 * {
 *   "tenant_id": "...",
 *   "task_id": "...",
 *   "ok": true|false,
 *   "artifacts": ["relative/path/1", ...],  // On success
 *   "fields": {},                           // On success
 *   "meta": {},                             // On success
 *   "error": "..."                          // On failure
 * }
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TENANT_ID = process.env.TENANT_ID;
const TASK_ID = process.env.TASK_ID;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/workspace/artifacts';
const JOB_JSON = process.env.JOB_JSON;
if (!TENANT_ID) {
  console.error(JSON.stringify({ ok: false, error: 'TENANT_ID environment variable is required' }));
  process.exit(1);
}

if (!TASK_ID) {
  console.error(JSON.stringify({ tenant_id: TENANT_ID, task_id: TASK_ID, ok: false, error: 'TASK_ID environment variable is required' }));
  process.exit(1);
}

if (!JOB_JSON) {
  console.error(JSON.stringify({ tenant_id: TENANT_ID, task_id: TASK_ID, ok: false, error: 'JOB_JSON environment variable is required' }));
  process.exit(1);
}

let job;
try {
  job = JSON.parse(JOB_JSON);
} catch (err) {
  console.error(JSON.stringify({ tenant_id: TENANT_ID, task_id: TASK_ID, ok: false, error: `Invalid JOB_JSON: ${err.message}` }));
  process.exit(1);
}

if (!job.url) {
  console.error(JSON.stringify({ tenant_id: TENANT_ID, task_id: TASK_ID, ok: false, error: 'Job specification must include "url"' }));
  process.exit(1);
}

async function runJob() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const artifacts = [];
  const fields = {};
  const meta = {};
  const maxActions = (job.limits && Number.isInteger(job.limits.max_actions)) ? job.limits.max_actions : 25;
  const hasActions = Array.isArray(job.actions) && job.actions.length > 0;
  let actionsExecuted = 0;
  
  try {
    if (job.viewport) {
      await page.setViewportSize(job.viewport);
      meta.viewport = job.viewport;
    }
    
    await page.goto(job.url);

    if (hasActions) {
      if (job.actions.length > maxActions) {
        throw new Error(`Action limit exceeded: ${job.actions.length} > ${maxActions}`);
      }

      for (const action of job.actions) {
        actionsExecuted += 1;
        if (actionsExecuted > maxActions) {
          throw new Error(`Action limit exceeded: ${actionsExecuted} > ${maxActions}`);
        }

        if (!action || typeof action !== 'object') {
          throw new Error('Invalid action: expected object');
        }

        switch (action.type) {
          case 'wait_for_load_state':
            await page.waitForLoadState(action.state);
            break;
          case 'wait_for_selector':
            await page.waitForSelector(action.selector);
            break;
          case 'click':
            await page.click(action.selector);
            break;
          case 'fill':
            await page.fill(action.selector, action.value);
            break;
          case 'press':
            await page.press(action.selector, action.key);
            break;
          case 'scroll':
            await page.mouse.wheel(0, action.deltaY || 0);
            break;
          case 'screenshot': {
            const taskArtifactDir = path.join(ARTIFACT_DIR, TASK_ID);
            if (!fs.existsSync(taskArtifactDir)) {
              fs.mkdirSync(taskArtifactDir, { recursive: true });
            }

            const requestedPath = action.path || 'screenshot.png';
            if (path.isAbsolute(requestedPath)) {
              throw new Error('Screenshot path must be relative');
            }
            const normalizedPath = path.normalize(requestedPath);
            if (normalizedPath.startsWith('..')) {
              throw new Error('Screenshot path must not escape task directory');
            }

            const screenshotPath = path.join(taskArtifactDir, normalizedPath);
            await page.screenshot({ path: screenshotPath, fullPage: Boolean(action.full_page) });

            const relativePath = path.join(TASK_ID, normalizedPath);
            artifacts.push(relativePath);
            break;
          }
          case 'extract': {
            if (typeof action.as !== 'string' || action.as.trim() === '') {
              throw new Error('Extract action requires "as" string');
            }
            if (action.kind === 'text') {
              const value = await page.$eval(action.selector, (el) => (el.innerText || '').trim());
              fields[action.as] = value;
            } else if (action.kind === 'attr') {
              const value = await page.$eval(
                action.selector,
                (el, attr) => el.getAttribute(attr),
                action.attr
              );
              fields[action.as] = value;
            } else {
              throw new Error(`Unsupported extract kind: ${action.kind}`);
            }
            break;
          }
          default:
            throw new Error(`Unsupported action type: ${action.type}`);
        }
      }

      meta.actions_executed = actionsExecuted;
    } else {
      if (job.wait_ms) {
        await page.waitForTimeout(job.wait_ms);
        meta.wait_ms = job.wait_ms;
      }

      if (job.screenshot) {
        const taskArtifactDir = path.join(ARTIFACT_DIR, TASK_ID);
        if (!fs.existsSync(taskArtifactDir)) {
          fs.mkdirSync(taskArtifactDir, { recursive: true });
        }

        const screenshotPath = path.join(taskArtifactDir, 'screenshot.png');
        await page.screenshot({ path: screenshotPath });

        const relativePath = path.join(TASK_ID, 'screenshot.png');
        artifacts.push(relativePath);
      }
    }
    
    await browser.close();
    
    const result = {
      tenant_id: TENANT_ID,
      task_id: TASK_ID,
      ok: true,
      artifacts: artifacts,
      fields: fields,
      meta: meta
    };
    
    console.log(JSON.stringify(result));
    process.exit(0);
    
  } catch (err) {
    await browser.close();
    
    // Failure output
    const result = {
      tenant_id: TENANT_ID,
      task_id: TASK_ID,
      ok: false,
      error: err.message
    };
    
    console.error(JSON.stringify(result));
    process.exit(1);
  }
}

runJob().catch(err => {
  const result = {
    tenant_id: TENANT_ID,
    task_id: TASK_ID,
    ok: false,
    error: err.message
  };
  console.error(JSON.stringify(result));
  process.exit(1);
});

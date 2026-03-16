import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('frontend bootstrap stays observer-only after cleanup', async () => {
  const [indexHtml, mainTsx] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(indexHtml, /<title>灵盘\s*·\s*Observer Bootstrap<\/title>/);
  assert.doesNotMatch(indexHtml, /辩论控制台/);
  assert.doesNotMatch(mainTsx, /\.\/App/);
  assert.doesNotMatch(mainTsx, /\.\/app\.css/);
  assert.doesNotMatch(mainTsx, /debate|session|claw|callback|protocol|relay|replay|onboarding/i);
  assert.match(mainTsx, /BrowserRouter/);
  assert.match(mainTsx, /AgentsList/);
  assert.match(mainTsx, /AgentDetail/);
  assert.match(mainTsx, /\/agents\/:agentId/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const clientSource = await readFile(new URL('../src/api/client.ts', import.meta.url), 'utf8');

test('frontend defaults to openclaw data source', () => {
  assert.match(clientSource, /DEFAULT_OBSERVER_DATA_SOURCE\s*=\s*'openclaw'/);
  assert.match(clientSource, /data_source=\$\{DEFAULT_OBSERVER_DATA_SOURCE\}/);
});

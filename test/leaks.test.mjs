import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultLeakPatterns, findLeaks } from '../lib/hygiene.mjs';

const profile = { trackHarness: false, layout: { moduleContext: 'CONTEXT.md' } };
const leaked = (text) => findLeaks([{ text }], defaultLeakPatterns(profile)).length > 0;

test('commands of the tool are caught as harness leaks under the old and the new name', () => {
  for (const text of ['ran `flow where` before the fix', 'see flow doctor output', 'flow commitmsg passed', 'flowctl check is green', 'updated .flow/rules']) {
    assert.ok(leaked(text), text);
  }
});

test('ordinary English about flow is not a leak', () => {
  for (const text of ['fix the checkout flow', 'flow check on the payment form', 'the login flow where users retry', 'data flow plan for the importer']) {
    assert.equal(leaked(text), false, text);
  }
});

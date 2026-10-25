import test from 'node:test';
import assert from 'node:assert/strict';
import {embeddedCookie} from '../src/host/gateway.js';
test('desktop embedding changes only native HttpOnly auth cookies to secure partitioned cookies', () => {
  const input = 'dsh-auth-abc_123=signed-value; Max-Age=60; Path=/; HttpOnly; SameSite=Strict';
  const result = embeddedCookie(input);
  assert.equal(result, 'dsh-auth-abc_123=signed-value; Max-Age=60; Path=/; HttpOnly; SameSite=None; Secure; Partitioned');
  assert.equal(embeddedCookie(result), result);
  assert.equal(embeddedCookie('other=1; HttpOnly; SameSite=Strict'), 'other=1; HttpOnly; SameSite=Strict');
  assert.equal(embeddedCookie('dsh-auth-abc=1; SameSite=Strict'), 'dsh-auth-abc=1; SameSite=Strict');
});

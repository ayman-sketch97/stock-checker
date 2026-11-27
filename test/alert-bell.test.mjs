// The header bell shows the number of open alerts on every page and links to the Alert Centre. It reads the same count the Alert Centre
// already computes; it adds no alert rule and sends nothing anywhere. The phone table keeps every shown column inside the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('header bell exists and is wired to the Alert Centre count', () => {
  assert.match(html, /id="bellBtn"/);
  assert.match(html, /function updateBell\(n\)/);
  assert.match(html, /updateBell\(alertLast\.count\)/);
  assert.match(html, /getElementById\('bellBtn'\)[^\n]*navigate\('alerts'\)/);
});

test('app icon badge is only set when the browser supports it, and never throws', () => {
  assert.match(html, /if \(navigator\.setAppBadge\)/);
  assert.match(html, /clearAppBadge/);
});

test('phone table rule keeps headers wrapping inside the screen', () => {
  assert.match(html, /@media \(max-width: 520px\) \{ \.tbl th, \.tbl td/);
  assert.match(html, /\.tbl \.th-btn \{ white-space: normal/);
});

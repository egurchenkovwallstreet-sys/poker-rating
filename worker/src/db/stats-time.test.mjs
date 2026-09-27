import assert from 'node:assert/strict';
import {
  demoGameTimestamps,
  isGameDateInMonth,
  isGameDateInStatsWindow,
  monthGameDateFilter,
  monthRangeUtc,
  statsSinceMs,
} from './stats-time.ts';

const now = Date.UTC(2026, 8, 27, 12, 0, 0); // 2026-09-27

assert.equal(monthRangeUtc('2026-09').start, Date.UTC(2026, 8, 1));
assert.equal(monthRangeUtc('2026-09').end, Date.UTC(2026, 9, 1));

const demoDates = demoGameTimestamps(4, now);
assert.equal(demoDates.length, 4);
for (const ts of demoDates) {
  assert.ok(isGameDateInStatsWindow(ts, now), 'demo game must be in 2y window');
}
assert.ok(isGameDateInMonth(demoDates[3], '2026-09', now), 'latest demo in current month');
assert.ok(isGameDateInMonth(demoDates[0], '2026-06', now), 'oldest demo in month -3');

const june = monthGameDateFilter('2026-06', now);
assert.ok(june);
assert.ok(demoDates[0] >= june.fromInclusive && demoDates[0] < june.toExclusive);

const ancient = monthGameDateFilter('2020-01', now);
assert.equal(ancient, null);

console.log('stats-time.test.mjs: OK');

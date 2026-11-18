import { describe, expect, it } from 'vitest';
import { cleanDetail, feedbackRows, joinFeedback, onlyChatFilter, isReportKind } from '../api/_lib/monitor';
import { describeDevice } from '../src/monitor';

describe('moderator monitor', () => {
  it('stores long feedback in parts that fit the chat table and joins them back', () => {
    const text = '畫面'.repeat(150); // 300 characters
    const rows = feedbackRows('abc123def', text);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.body.length).toBeLessThanOrEqual(120);
    const stored = rows.map((row, index) => ({ id: 10 + index, created_at: '2026-11-18T10:00:00Z', name: '陳太', ...row })).reverse();
    const [joined] = joinFeedback(stored);
    expect(joined.body).toBe(text);
    expect(joined.rowIds).toEqual([10, 11, 12]);
    expect(joined.done).toBe(false);
  });

  it('keeps feedback within the limit and knows which was dealt with', () => {
    expect(feedbackRows('abc123def', 'x'.repeat(900)).map(row => row.body).join('')).toHaveLength(480);
    const done = joinFeedback([{ id: 1, created_at: '2026-11-18T10:00:00Z', name: '', body: '謝謝', sender_hash: 'feedback:abc123def:1/1:done' }]);
    expect(done[0].done).toBe(true);
  });

  it('leaves switches, reports and feedback out of the chat list', () => {
    const filter = onlyChatFilter(['moderator-quiet-switch']);
    expect(filter).toContain('not.in.(moderator-quiet-switch)');
    expect(filter).toContain('not.like.report:*');
    expect(filter).toContain('not.like.feedback:*');
  });

  it('reports carry the device and browser only', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1', true)).toBe('手機/平板 · iPhone · Safari');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0', false)).toBe('電腦 · Windows · Edge');
    expect(describeDevice('Mozilla/5.0 (iPhone) FBAN/FBIOS', true)).toContain('Facebook');
    expect(cleanDetail('<script>x</script>')).not.toContain('<');
    expect(isReportKind('graphics-lost')).toBe(true);
    expect(isReportKind('anything')).toBe(false);
  });
});

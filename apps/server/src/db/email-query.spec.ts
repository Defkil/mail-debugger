import {
  buildFilterClause,
  MAX_FILTER_LENGTH,
  normalizeFilter,
  parseDateBound,
} from './email-query.js';

describe('parseDateBound', () => {
  it('expands a date to the whole UTC day', () => {
    expect(parseDateBound('2026-01-31', 'since')).toBe(
      '2026-01-31T00:00:00.000Z',
    );
    expect(parseDateBound('2026-01-31', 'until')).toBe(
      '2026-01-31T23:59:59.999Z',
    );
  });

  it('normalizes date-times with and without zones to UTC', () => {
    expect(parseDateBound('2026-01-31T10:20:30Z', 'since')).toBe(
      '2026-01-31T10:20:30.000Z',
    );
    expect(parseDateBound('2026-01-31T10:20:30.5+02:00', 'since')).toBe(
      '2026-01-31T08:20:30.500Z',
    );
    expect(parseDateBound('2026-01-31T10:20+0100', 'since')).toBe(
      '2026-01-31T09:20:00.000Z',
    );
    // 0.3.x stored "YYYY-MM-DD HH:MM:SS" in UTC; such values stay valid.
    expect(parseDateBound('2026-01-31 10:20:30', 'until')).toBe(
      '2026-01-31T10:20:30.000Z',
    );
  });

  it.each([
    'yesterday',
    '2026-02-30',
    '2026-13-01',
    '2026-01-01T24:00:00Z',
    '2026-01-01T10:60:00Z',
    '2026-01-01T10:00:00+25:00',
    '1700000000',
    '',
  ])('rejects %j', (value) => {
    expect(() => parseDateBound(value, 'since')).toThrow(/Invalid since date/);
  });
});

describe('normalizeFilter', () => {
  it('keeps non-empty text criteria and normalizes dates', () => {
    expect(
      normalizeFilter({
        from: 'alice',
        to: '',
        subject: 'Reset',
        since: '2026-01-01',
      }),
    ).toEqual({
      from: 'alice',
      subject: 'Reset',
      since: '2026-01-01T00:00:00.000Z',
    });
    expect(normalizeFilter(undefined)).toEqual({});
  });

  it('rejects reversed date bounds and overlong criteria', () => {
    expect(() =>
      normalizeFilter({ since: '2026-02-01', until: '2026-01-01' }),
    ).toThrow('The since date is after the until date');
    expect(() =>
      normalizeFilter({ subject: 'x'.repeat(MAX_FILTER_LENGTH + 1) }),
    ).toThrow(/longer than/);
  });
});

describe('buildFilterClause', () => {
  it('returns an empty clause without criteria', () => {
    expect(buildFilterClause({})).toEqual({ where: '', params: [] });
  });

  it('binds every value as a parameter', () => {
    const clause = buildFilterClause({
      from: "a'; DROP TABLE emails; --",
      since: '2026-01-01T00:00:00.000Z',
    });
    expect(clause.where).toBe(
      'WHERE instr(md_fold(from_addr), md_fold(?)) > 0 AND received_at >= ?',
    );
    expect(clause.params).toEqual([
      "a'; DROP TABLE emails; --",
      '2026-01-01T00:00:00.000Z',
    ]);
  });
});

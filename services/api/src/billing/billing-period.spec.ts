import { addBillingPeriod, addUtcMonths } from './billing-period';

describe('billing periods', () => {
  it('adds one month or one year in UTC', () => {
    const start = new Date('2026-11-12T10:20:30.400Z');
    expect(addBillingPeriod(start, 'P1M').toISOString()).toBe('2026-12-12T10:20:30.400Z');
    expect(addBillingPeriod(start, 'P1Y').toISOString()).toBe('2027-11-12T10:20:30.400Z');
  });

  it('clamps to the end of shorter months and rolls over years', () => {
    expect(addUtcMonths(new Date('2027-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(addUtcMonths(new Date('2028-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(addUtcMonths(new Date('2026-12-15T00:00:00.000Z'), 1).toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(addBillingPeriod(new Date('2028-02-29T00:00:00.000Z'), 'P1Y').toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
  });
});

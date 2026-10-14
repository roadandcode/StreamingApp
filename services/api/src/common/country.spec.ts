import { resolveCountry } from './country';

describe('resolveCountry', () => {
  it('uses the default when no trusted header is configured, ignoring client headers', () => {
    expect(resolveCountry({ 'cloudfront-viewer-country': 'US' }, { defaultCountry: 'IN' })).toBe('IN');
  });

  it('reads the configured trusted header', () => {
    expect(
      resolveCountry(
        { 'cloudfront-viewer-country': 'us' },
        { trustedHeader: 'cloudfront-viewer-country', defaultCountry: 'IN' },
      ),
    ).toBe('US');
  });

  it('falls back to the default when the header is missing or malformed', () => {
    const options = { trustedHeader: 'cloudfront-viewer-country', defaultCountry: 'IN' };
    expect(resolveCountry({}, options)).toBe('IN');
    expect(resolveCountry({ 'cloudfront-viewer-country': 'USA' }, options)).toBe('IN');
    expect(resolveCountry({ 'cloudfront-viewer-country': ['GB', 'US'] }, options)).toBe('GB');
  });
});

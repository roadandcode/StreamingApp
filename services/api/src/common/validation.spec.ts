import { IsArray, IsInt, IsString, Min, MinLength } from 'class-validator';
import { AppException } from './errors';
import { createValidationPipe, EachElement } from './validation';

class SampleDto {
  @IsString()
  @MinLength(3)
  title: string;

  @IsInt()
  @Min(0)
  position: number;

  @IsArray()
  @EachElement('isCountryCode', (v) => typeof v === 'string' && /^[A-Z]{2}$/.test(v), 'an ISO-3166 alpha-2 country code')
  regions: string[];
}

async function validate(body: unknown): Promise<AppException> {
  try {
    await createValidationPipe().transform(body, { type: 'body', metatype: SampleDto });
  } catch (error) {
    return error as AppException;
  }
  throw new Error('expected validation to fail');
}

describe('validation pipe', () => {
  it('accepts a valid body', async () => {
    await expect(
      createValidationPipe().transform({ title: 'Hello', position: 0, regions: ['IN'] }, { type: 'body', metatype: SampleDto }),
    ).resolves.toMatchObject({ title: 'Hello' });
  });

  it('reports each invalid field with its path', async () => {
    const error = await validate({ title: 'x', position: -1, regions: ['IN', 'usa', 'US'] });
    expect(error.body.code).toBe('VALIDATION_FAILED');
    expect(error.body.errors).toEqual([
      { field: 'title', message: 'title must be longer than or equal to 3 characters' },
      { field: 'position', message: 'position must not be less than 0' },
      { field: 'regions.1', message: 'regions.1 must be an ISO-3166 alpha-2 country code' },
    ]);
    expect(error.body.message).toContain('regions.1 must be an ISO-3166 alpha-2 country code');
  });

  it('names unknown fields', async () => {
    const error = await validate({ title: 'Hello', position: 1, regions: [], role: 'admin' });
    expect(error.body.errors).toEqual([{ field: 'role', message: 'property role should not exist' }]);
  });

  it('always includes errors on VALIDATION_FAILED, never on other codes', () => {
    expect(new AppException('VALIDATION_FAILED', 'Bad').body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Bad',
      errors: [],
    });
    expect(new AppException('NOT_FOUND').body).not.toHaveProperty('errors');
    expect(AppException.invalidField('parentId', 'parentId is wrong').body.errors).toEqual([
      { field: 'parentId', message: 'parentId is wrong' },
    ]);
  });
});

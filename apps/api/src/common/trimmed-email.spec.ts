import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { LoginDto } from '../auth/dto/login.dto';
import { CreateCustomerDto } from '../customers/dto/customer.dto';

// The pipe as main.ts sets it up.
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const as = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});

describe('email fields', () => {
  it('accept an address with spaces around it, and pass it on trimmed', async () => {
    const dto = (await pipe.transform(
      { email: ' admin@demo-imports.local ', password: 'long-enough' },
      as(LoginDto),
    )) as LoginDto;
    expect(dto.email).toBe('admin@demo-imports.local');
  });

  it('still refuse something that is not an address', async () => {
    await expect(
      pipe.transform(
        { email: 'not an email', password: 'long-enough' },
        as(LoginDto),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leave an optional email optional', async () => {
    const dto = (await pipe.transform(
      { firstName: 'Maria', lastName: 'Christou' },
      as(CreateCustomerDto),
    )) as CreateCustomerDto;
    expect(dto.email).toBeUndefined();
  });
});

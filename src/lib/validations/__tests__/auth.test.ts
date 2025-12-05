import { describe, it, expect } from 'vitest';
import {
  UsernameSchema,
  PasswordSchema,
  LoginSchema,
  RegisterSchema,
} from '../auth';

describe('UsernameSchema', () => {
  it('accepts valid usernames', () => {
    expect(UsernameSchema.safeParse('john').success).toBe(true);
    expect(UsernameSchema.safeParse('john_doe').success).toBe(true);
    expect(UsernameSchema.safeParse('john-doe').success).toBe(true);
    expect(UsernameSchema.safeParse('JohnDoe123').success).toBe(true);
    expect(UsernameSchema.safeParse('abc').success).toBe(true); // min 3
    expect(UsernameSchema.safeParse('a'.repeat(20)).success).toBe(true); // max 20
  });

  it('rejects usernames that are too short', () => {
    const result = UsernameSchema.safeParse('ab');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('at least 3');
    }
  });

  it('rejects usernames that are too long', () => {
    const result = UsernameSchema.safeParse('a'.repeat(21));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('at most 20');
    }
  });

  it('rejects usernames with invalid characters', () => {
    expect(UsernameSchema.safeParse('john doe').success).toBe(false); // space
    expect(UsernameSchema.safeParse('john@doe').success).toBe(false); // @
    expect(UsernameSchema.safeParse('john.doe').success).toBe(false); // .
    expect(UsernameSchema.safeParse('john!').success).toBe(false); // !
  });
});

describe('PasswordSchema', () => {
  it('accepts valid passwords', () => {
    expect(PasswordSchema.safeParse('123456').success).toBe(true); // min 6
    expect(PasswordSchema.safeParse('a'.repeat(128)).success).toBe(true); // max 128
    expect(PasswordSchema.safeParse('MySecureP@ss!').success).toBe(true);
  });

  it('rejects passwords that are too short', () => {
    const result = PasswordSchema.safeParse('12345');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('at least 6');
    }
  });

  it('rejects passwords that are too long', () => {
    const result = PasswordSchema.safeParse('a'.repeat(129));
    expect(result.success).toBe(false);
  });
});

describe('LoginSchema', () => {
  it('accepts valid login data', () => {
    const result = LoginSchema.safeParse({
      username: 'testuser',
      password: 'password123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe('testuser');
      expect(result.data.password).toBe('password123');
    }
  });

  it('requires username', () => {
    const result = LoginSchema.safeParse({
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('requires password', () => {
    const result = LoginSchema.safeParse({
      username: 'testuser',
    });
    expect(result.success).toBe(false);
  });

  it('requires non-empty password', () => {
    const result = LoginSchema.safeParse({
      username: 'testuser',
      password: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('required');
    }
  });
});

describe('RegisterSchema', () => {
  it('accepts valid registration data', () => {
    const result = RegisterSchema.safeParse({
      username: 'newuser',
      password: 'securepass123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts registration with optional email', () => {
    const result = RegisterSchema.safeParse({
      username: 'newuser',
      password: 'securepass123',
      email: 'test@example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
    }
  });

  it('allows empty string for email', () => {
    const result = RegisterSchema.safeParse({
      username: 'newuser',
      password: 'securepass123',
      email: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email format', () => {
    const result = RegisterSchema.safeParse({
      username: 'newuser',
      password: 'securepass123',
      email: 'invalid-email',
    });
    expect(result.success).toBe(false);
  });

  it('validates username according to UsernameSchema', () => {
    const result = RegisterSchema.safeParse({
      username: 'ab', // too short
      password: 'securepass123',
    });
    expect(result.success).toBe(false);
  });

  it('validates password according to PasswordSchema', () => {
    const result = RegisterSchema.safeParse({
      username: 'newuser',
      password: '12345', // too short
    });
    expect(result.success).toBe(false);
  });
});

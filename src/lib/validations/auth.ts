/**
 * Authentication validation schemas
 */

import { z } from 'zod';

// Username validation
export const UsernameSchema = z.string()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Username can only contain letters, numbers, underscores, and hyphens'
  );

// Password validation
export const PasswordSchema = z.string()
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password too long');

// Login request
export const LoginSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// Register request
export const RegisterSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  email: z.string().email('Invalid email').optional().or(z.literal('')),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

// Password reset (admin)
export const AdminPasswordResetSchema = z.object({
  username: UsernameSchema,
  newPassword: PasswordSchema,
});

export type AdminPasswordResetInput = z.infer<typeof AdminPasswordResetSchema>;

// Profile update
export const ProfileUpdateSchema = z.object({
  displayName: z.string().max(50, 'Display name too long').optional().nullable(),
  email: z.string().email('Invalid email').optional().nullable().or(z.literal('')),
});

export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

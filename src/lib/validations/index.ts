/**
 * Zod Validation Library
 *
 * Centralized validation schemas for all API inputs.
 * Use parseBody() helper for consistent error handling.
 */

import { NextResponse } from 'next/server';
import { z, ZodError, ZodSchema } from 'zod';

// Re-export all schemas
export * from './auth';
export * from './cards';
export * from './interactions';
export * from './admin';
export * from './common';

/**
 * Parse and validate request body with Zod schema
 * Returns validated data or NextResponse error
 */
export async function parseBody<T extends ZodSchema>(
  request: Request,
  schema: T
): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  try {
    const body = await request.json();
    const data = schema.parse(body);
    return { data };
  } catch (err) {
    if (err instanceof ZodError) {
      const firstError = err.errors[0];
      const path = firstError.path.join('.');
      const message = path ? `${path}: ${firstError.message}` : firstError.message;

      return {
        error: NextResponse.json(
          { error: message, details: err.errors },
          { status: 400 }
        ),
      };
    }

    if (err instanceof SyntaxError) {
      return {
        error: NextResponse.json(
          { error: 'Invalid JSON body' },
          { status: 400 }
        ),
      };
    }

    throw err;
  }
}

/**
 * Parse and validate query parameters with Zod schema
 */
export function parseQuery<T extends ZodSchema>(
  searchParams: URLSearchParams,
  schema: T
): { data: z.infer<T> } | { error: NextResponse } {
  try {
    // Convert URLSearchParams to object
    const params: Record<string, string | string[]> = {};
    searchParams.forEach((value, key) => {
      if (params[key]) {
        // Multiple values for same key -> array
        if (Array.isArray(params[key])) {
          (params[key] as string[]).push(value);
        } else {
          params[key] = [params[key] as string, value];
        }
      } else {
        params[key] = value;
      }
    });

    const data = schema.parse(params);
    return { data };
  } catch (err) {
    if (err instanceof ZodError) {
      const firstError = err.errors[0];
      const path = firstError.path.join('.');
      const message = path ? `${path}: ${firstError.message}` : firstError.message;

      return {
        error: NextResponse.json(
          { error: message, details: err.errors },
          { status: 400 }
        ),
      };
    }

    throw err;
  }
}

/**
 * Validate data with schema, returning boolean
 */
export function isValid<T extends ZodSchema>(
  data: unknown,
  schema: T
): data is z.infer<T> {
  return schema.safeParse(data).success;
}

/**
 * Standard API error response
 */
export function validationError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

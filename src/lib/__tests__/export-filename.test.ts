import { describe, expect, it } from 'vitest';
import { buildCardExportFilename } from '@/lib/utils';

describe('buildCardExportFilename', () => {
  it('includes creator when provided', () => {
    const filename = buildCardExportFilename(
      { creator: 'Axailotl', name: 'Purrsephone', slug: 'purrsephone-v4oi9K' },
      'png'
    );
    expect(filename).toBe('Axailotl_Purrsephone_v4oi9K.png');
  });

  it('omits creator when empty', () => {
    const filename = buildCardExportFilename(
      { creator: '   ', name: 'Purrsephone', slug: 'purrsephone-v4oi9K' },
      'png'
    );
    expect(filename).toBe('Purrsephone_v4oi9K.png');
  });
});


#!/usr/bin/env node

/**
 * Post-build script to add ImageProcessor Durable Object export to worker.js
 */

const fs = require('fs');
const path = require('path');

const workerPath = path.join(__dirname, '../.open-next/worker.js');
const doPath = path.join(__dirname, '../.open-next/.build/durable-objects');

// Ensure durable-objects directory exists
if (!fs.existsSync(doPath)) {
  fs.mkdirSync(doPath, { recursive: true });
}

// Copy ImageProcessor to .build/durable-objects
const imageProcessorSource = path.join(__dirname, '../src/durable-objects/ImageProcessor.ts');
const imageProcessorDest = path.join(doPath, 'image-processor.js');

// Convert TS to JS manually (simple conversion since it's minimal code)
const tsContent = fs.readFileSync(imageProcessorSource, 'utf-8');
const jsContent = tsContent
  .replace(/import type \{[^}]+\} from[^;]+;/g, '') // Remove type imports
  .replace(/: Promise<[^>]+>/g, '') // Remove return type annotations
  .replace(/: Request/g, '')
  .replace(/: Response/g, '')
  .replace(/: Record<string, unknown>/g, '')
  .replace(/: ProcessImageRequest/g, '')
  .replace(/: string/g, '')
  .replace(/: number/g, '')
  .replace(/: boolean/g, '')
  .replace(/: any/g, '')
  .replace(/: unknown/g, '')
  .replace(/<Env>/g, '') // Remove generic type parameters
  .replace(/: DurableObjectState/g, '')
  .replace(/: Env/g, '')
  .replace(/interface ProcessImageRequest \{[^}]+\}/s, '') // Remove interface
  .replace(/private /g, ''); // Remove private keyword

fs.writeFileSync(imageProcessorDest, jsContent);

// Read worker.js
let workerContent = fs.readFileSync(workerPath, 'utf-8');

// Check if ImageProcessor export already exists
if (!workerContent.includes('export { ImageProcessor }')) {
  // Add export after other DO exports
  const exportLine = '//@ts-expect-error: Will be resolved by wrangler build\nexport { ImageProcessor } from "./.build/durable-objects/image-processor.js";\n';

  // Insert after the last DO export
  const lastExportIndex = workerContent.lastIndexOf('export { ');
  const nextLineIndex = workerContent.indexOf('\n', lastExportIndex);

  workerContent = workerContent.slice(0, nextLineIndex + 1) + exportLine + workerContent.slice(nextLineIndex + 1);

  fs.writeFileSync(workerPath, workerContent);
  console.log('✅ Added ImageProcessor export to worker.js');
} else {
  console.log('✅ ImageProcessor export already exists in worker.js');
}

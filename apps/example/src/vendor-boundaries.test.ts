import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const forbidden = [
  '@nestjs/cqrs',
  '@prisma/',
  'bullmq',
  'ioredis',
  '@aws-sdk/',
  'twilio',
  '@sendgrid/',
  'ably',
];

async function typescriptFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await typescriptFiles(path)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files;
}

describe('feature vendor boundaries', () => {
  it('keeps vendor imports out of feature code', async () => {
    const root = new URL('.', import.meta.url).pathname;
    const files = (await typescriptFiles(root)).filter((file) => !file.includes('/composition/'));
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (forbidden.some((specifier) => source.includes(specifier))) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});

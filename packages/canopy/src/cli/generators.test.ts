import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { generatorTemplate, type GeneratorKind } from './generators.js';

const kinds: readonly GeneratorKind[] = [
  'model',
  'action',
  'query',
  'observer',
  'listener',
  'job',
  'schedule',
  'policy',
  'resource',
  'notification',
];

describe('Canopy generators', () => {
  it.each(kinds)('generates compiler-parseable %s files with framework imports', (kind) => {
    const output = generatorTemplate(kind, 'ExampleThing');
    const transpiled = ts.transpileModule(output, {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext },
      reportDiagnostics: true,
    });
    expect(
      transpiled.diagnostics?.filter(({ category }) => category === ts.DiagnosticCategory.Error),
    ).toEqual([]);
    expect(output).toContain("from '@evergreen/canopy'");
    expect(output).not.toMatch(/@nestjs\/cqrs|@prisma|bullmq|ioredis|twilio|sendgrid|ably/);
  });
});

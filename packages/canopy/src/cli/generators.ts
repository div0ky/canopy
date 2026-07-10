import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type GeneratorKind =
  | 'model'
  | 'action'
  | 'query'
  | 'observer'
  | 'listener'
  | 'job'
  | 'schedule'
  | 'policy'
  | 'resource'
  | 'notification';

export function pascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}

export function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase();
}

export function generatorTemplate(kind: GeneratorKind, rawName: string): string {
  const name = pascalCase(rawName);
  const templates: Record<GeneratorKind, string> = {
    model: `import { DomainModel } from '@evergreen/canopy';

export interface ${name}Attributes extends Record<string, unknown> {
  readonly name: string;
}

export class ${name} extends DomainModel<string, ${name}Attributes> {
  public static create(id: string, attributes: ${name}Attributes): ${name} {
    return new ${name}({ id, attributes, version: 0 }, false);
  }
}
`,
    action: `import { Action, ActionHandler, type Handles } from '@evergreen/canopy';

export class ${name} extends Action<void> {}

@ActionHandler(${name})
export class ${name}Handler implements Handles<${name}, void> {
  public async handle(_action: ${name}): Promise<void> {}
}
`,
    query: `import { Query, QueryHandler, type Handles } from '@evergreen/canopy';

export class ${name} extends Query<unknown> {}

@QueryHandler(${name})
export class ${name}Handler implements Handles<${name}, unknown> {
  public async handle(_query: ${name}): Promise<unknown> {
    return null;
  }
}
`,
    observer: `import { Observer, type ModelObserver } from '@evergreen/canopy';
import { ${name} } from '../models/${kebabCase(name)}.js';

@Observer(${name})
export class ${name}Observer implements ModelObserver<${name}> {
  public async saved(_model: ${name}): Promise<void> {}
}
`,
    listener: `import { Listener, type DomainEvent, type HandlesEvent } from '@evergreen/canopy';

@Listener('${kebabCase(name)}', { queued: false })
export class ${name} implements HandlesEvent {
  public async handle(_event: DomainEvent): Promise<void> {}
}
`,
    job: `import { defineJob, JobHandler, type HandlesJob } from '@evergreen/canopy';
import { z } from 'zod';

export const ${name} = defineJob({
  name: '${kebabCase(name)}',
  version: 1,
  queue: 'events',
  payload: z.object({ id: z.string().uuid() }),
  attempts: 5,
  backoff: { type: 'exponential', delayMs: 1_000 },
  timeoutMs: 30_000,
  retainCompleted: 1_000,
  retainFailed: 5_000,
});

@JobHandler(${name})
export class ${name}Handler implements HandlesJob<{ id: string }> {
  public async handle(_payload: { id: string }): Promise<void> {}
}
`,
    schedule: `import { Schedule } from '@evergreen/canopy';
import { ${name}Job } from '../jobs/${kebabCase(name)}-job.js';

export class ${name}Schedule {
  @Schedule({
    id: '${kebabCase(name)}',
    job: ${name}Job,
    payload: {},
    cron: '0 * * * *',
    timezone: 'UTC',
    overlap: 'skip',
    enabled: true,
  })
  public register(): void {}
}
`,
    policy: `import { PolicyFor, type Actor, type Policy } from '@evergreen/canopy';
import { ${name} } from '../models/${kebabCase(name)}.js';

@PolicyFor(${name})
export class ${name}Policy implements Policy<${name}> {
  public allows(actor: Actor, ability: string, subject: ${name}): boolean {
    return ability === 'view' && actor.id === String(subject.id);
  }
}
`,
    resource: `import { Resource } from '@evergreen/canopy';

export class ${name}Resource extends Resource<${name}, Record<string, unknown>> {
  public serialize(input: ${name}): Record<string, unknown> {
    return input.serialize();
  }
}
`,
    notification: `import type { Notification, Notifiable } from '@evergreen/canopy';

export class ${name} implements Notification {
  public readonly name = '${kebabCase(name)}';
  public via(_notifiable: Notifiable) { return ['database'] as const; }
  public toDatabase(_notifiable: Notifiable): Record<string, unknown> { return {}; }
}
`,
  };
  return templates[kind];
}

export async function generate(kind: GeneratorKind, name: string, root: string): Promise<string> {
  const plural = kind === 'policy' ? 'policies' : `${kind}s`;
  const output = join(root, 'src', plural, `${kebabCase(name)}.ts`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, generatorTemplate(kind, name), { flag: 'wx' });
  return output;
}

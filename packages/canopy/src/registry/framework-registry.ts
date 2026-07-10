import { HandlerRegistrationError } from '../errors.js';

export type Constructor<T = object> = abstract new (...args: never[]) => T;
export type ConcreteConstructor<T = object> = new (...args: never[]) => T;
export type HandlerKind = 'action' | 'query' | 'job';

interface HandlerRegistration {
  readonly kind: HandlerKind;
  readonly message: Constructor;
  readonly handler: ConcreteConstructor;
}

interface ObserverRegistration {
  readonly model: Constructor;
  readonly observer: ConcreteConstructor;
}

interface ListenerRegistration {
  readonly event: string;
  readonly listener: ConcreteConstructor;
  readonly queued: boolean;
}

interface JobRegistration {
  readonly job: { readonly name: string; readonly version: number };
  readonly handler: ConcreteConstructor;
}

export interface ScheduleRegistration {
  readonly id: string;
  readonly target: ConcreteConstructor;
  readonly propertyKey: string;
  readonly cron?: string;
  readonly everyMs?: number;
  readonly timezone: string;
  readonly overlap: 'allow' | 'skip';
  readonly enabled: boolean;
  readonly job: unknown;
  readonly payload: Readonly<Record<string, unknown>>;
}

class GlobalFrameworkRegistry {
  readonly #handlers = new Map<string, HandlerRegistration>();
  readonly #observers: ObserverRegistration[] = [];
  readonly #listeners: ListenerRegistration[] = [];
  readonly #jobs = new Map<string, JobRegistration>();
  readonly #schedules = new Map<string, ScheduleRegistration>();

  public registerHandler(registration: HandlerRegistration): void {
    const key = `${registration.kind}:${registration.message.name}`;
    const existing = this.#handlers.get(key);
    if (existing) {
      throw new HandlerRegistrationError(
        `Duplicate ${registration.kind} handler for ${registration.message.name}`,
        { existing: existing.handler.name, duplicate: registration.handler.name },
      );
    }
    this.#handlers.set(key, registration);
  }

  public registerObserver(registration: ObserverRegistration): void {
    if (
      this.#observers.some(
        ({ model, observer }) => model === registration.model && observer === registration.observer,
      )
    ) {
      throw new HandlerRegistrationError(
        `Duplicate observer ${registration.observer.name} for ${registration.model.name}`,
      );
    }
    this.#observers.push(registration);
  }

  public registerListener(registration: ListenerRegistration): void {
    this.#listeners.push(registration);
  }

  public registerJob(registration: JobRegistration): void {
    const key = `${registration.job.name}@${registration.job.version}`;
    const existing = this.#jobs.get(key);
    if (existing) {
      throw new HandlerRegistrationError(`Duplicate job handler for ${key}`, {
        existing: existing.handler.name,
        duplicate: registration.handler.name,
      });
    }
    this.#jobs.set(key, registration);
  }

  public registerSchedule(registration: ScheduleRegistration): void {
    if (this.#schedules.has(registration.id)) {
      throw new HandlerRegistrationError(`Duplicate schedule id ${registration.id}`);
    }
    this.#schedules.set(registration.id, registration);
  }

  public handlers(): readonly HandlerRegistration[] {
    return [...this.#handlers.values()];
  }

  public observers(): readonly ObserverRegistration[] {
    return [...this.#observers];
  }

  public listeners(): readonly ListenerRegistration[] {
    return [...this.#listeners];
  }

  public schedules(): readonly ScheduleRegistration[] {
    return [...this.#schedules.values()];
  }

  public jobs(): readonly JobRegistration[] {
    return [...this.#jobs.values()];
  }

  public providerTypes(): ConcreteConstructor[] {
    return [
      ...new Set([
        ...this.handlers().map(({ handler }) => handler),
        ...this.observers().map(({ observer }) => observer),
        ...this.listeners().map(({ listener }) => listener),
        ...this.jobs().map(({ handler }) => handler),
        ...this.schedules().map(({ target }) => target),
      ]),
    ];
  }

  public assertHandled(kind: HandlerKind, messages: readonly Constructor[]): void {
    const registered = new Set(
      this.handlers()
        .filter((entry) => entry.kind === kind)
        .map((entry) => entry.message),
    );
    const missing = messages.filter((message) => !registered.has(message));
    if (missing.length > 0) {
      throw new HandlerRegistrationError(
        `Missing ${kind} handlers: ${missing.map(({ name }) => name).join(', ')}`,
      );
    }
  }
}

export const FrameworkRegistry = new GlobalFrameworkRegistry();

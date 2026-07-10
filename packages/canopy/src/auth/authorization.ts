import { Injectable } from '@nestjs/common';
import type { Actor } from '../context/execution-context.js';
import { AuthorizationError } from '../errors.js';
import { type ConcreteConstructor, type Constructor } from '../registry/framework-registry.js';

export interface Policy<TSubject, TAbility extends string = string> {
  allows(actor: Actor, ability: TAbility, subject: TSubject): boolean | Promise<boolean>;
}

class PolicyRegistry {
  readonly #policies = new Map<Constructor, ConcreteConstructor<Policy<unknown>>>();

  public register(subject: Constructor, policy: ConcreteConstructor<Policy<unknown>>): void {
    if (this.#policies.has(subject)) {
      throw new Error(`A policy is already registered for ${subject.name}`);
    }
    this.#policies.set(subject, policy);
  }

  public policyFor(subject: object): ConcreteConstructor<Policy<unknown>> | undefined {
    return this.#policies.get(subject.constructor as Constructor);
  }
}

export const Policies = new PolicyRegistry();

export function PolicyFor(subject: Constructor): ClassDecorator {
  return (target) =>
    Policies.register(subject, target as unknown as ConcreteConstructor<Policy<unknown>>);
}

@Injectable()
export class Authorization {
  readonly #instances = new Map<ConcreteConstructor<Policy<unknown>>, Policy<unknown>>();

  public async authorize<TSubject>(
    actor: Actor,
    ability: string,
    subject: TSubject,
  ): Promise<void> {
    if (actor.abilities?.includes('*') || actor.abilities?.includes(ability)) {
      return;
    }
    if (typeof subject !== 'object' || subject === null) {
      throw new AuthorizationError(ability);
    }
    const PolicyType = Policies.policyFor(subject);
    if (!PolicyType) {
      throw new AuthorizationError(ability);
    }
    let policy = this.#instances.get(PolicyType);
    if (!policy) {
      policy = new PolicyType();
      this.#instances.set(PolicyType, policy);
    }
    if (!(await policy.allows(actor, ability, subject))) {
      throw new AuthorizationError(ability);
    }
  }
}

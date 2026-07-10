import { Inject, Injectable } from '@nestjs/common';
import {
  CommandBus,
  CommandHandler as NestCommandHandler,
  QueryBus as NestQueryBus,
  QueryHandler as NestQueryHandler,
} from '@nestjs/cqrs';
import {
  FrameworkRegistry,
  type ConcreteConstructor,
  type Constructor,
} from '../registry/framework-registry.js';

export abstract class Action<TResult> {
  declare readonly __actionResult: TResult;
}

export abstract class Query<TResult> {
  declare readonly __queryResult: TResult;
}

export interface Handles<TMessage, TResult> {
  handle(message: TMessage): TResult | Promise<TResult>;
}

interface CanopyHandlerPrototype {
  handle?: (message: unknown) => unknown;
  execute?: (message: unknown) => unknown;
}

interface DecoratedHandler {
  readonly name: string;
  readonly prototype: CanopyHandlerPrototype;
}

function bridgeNestExecute(target: DecoratedHandler): void {
  const prototype = target.prototype as CanopyHandlerPrototype;
  if (typeof prototype.execute === 'function') return;
  Object.defineProperty(prototype, 'execute', {
    configurable: false,
    enumerable: false,
    writable: false,
    value(this: CanopyHandlerPrototype, message: unknown): unknown {
      if (typeof this.handle !== 'function') {
        throw new Error(`${target.name} must implement handle()`);
      }
      return this.handle(message);
    },
  });
}

export function ActionHandler<TAction extends Action<unknown>>(
  action: Constructor<TAction>,
): ClassDecorator {
  return (target) => {
    bridgeNestExecute(target as unknown as DecoratedHandler);
    FrameworkRegistry.registerHandler({
      kind: 'action',
      message: action,
      handler: target as unknown as ConcreteConstructor,
    });
    NestCommandHandler(action)(target);
  };
}

export function QueryHandler<TQuery extends Query<unknown>>(
  query: Constructor<TQuery>,
): ClassDecorator {
  return (target) => {
    bridgeNestExecute(target as unknown as DecoratedHandler);
    FrameworkRegistry.registerHandler({
      kind: 'query',
      message: query,
      handler: target as unknown as ConcreteConstructor,
    });
    NestQueryHandler(query)(target);
  };
}

@Injectable()
export class ActionBus {
  public constructor(@Inject(CommandBus) private readonly commandBus: CommandBus) {}

  public execute<TResult>(action: Action<TResult>): Promise<TResult> {
    return this.commandBus.execute(action);
  }
}

@Injectable()
export class QueryBus {
  public constructor(@Inject(NestQueryBus) private readonly queryBus: NestQueryBus) {}

  public execute<TResult>(query: Query<TResult>): Promise<TResult> {
    return this.queryBus.execute(query);
  }
}

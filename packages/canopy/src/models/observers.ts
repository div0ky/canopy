import { Inject, Injectable, type OnModuleInit, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { DomainModel, ModelAttributes, ModelId } from './domain-model.js';
import {
  FrameworkRegistry,
  type ConcreteConstructor,
  type Constructor,
} from '../registry/framework-registry.js';

export type AnyModel = DomainModel<ModelId, ModelAttributes>;

export interface ModelObserver<TModel extends AnyModel> {
  retrieved?(model: TModel): void | Promise<void>;
  creating?(model: TModel): void | Promise<void>;
  saving?(model: TModel): void | Promise<void>;
  updating?(model: TModel): void | Promise<void>;
  deleting?(model: TModel): void | Promise<void>;
  restoring?(model: TModel): void | Promise<void>;
  created?(model: TModel): void | Promise<void>;
  saved?(model: TModel): void | Promise<void>;
  updated?(model: TModel): void | Promise<void>;
  deleted?(model: TModel): void | Promise<void>;
  restored?(model: TModel): void | Promise<void>;
  committed?(model: TModel): void | Promise<void>;
}

export function Observer(model: Constructor<AnyModel>): ClassDecorator {
  return (target) => {
    FrameworkRegistry.registerObserver({
      model,
      observer: target as unknown as ConcreteConstructor,
    });
  };
}

@Injectable()
export class ObserverRegistry implements OnModuleInit {
  readonly #instances = new Map<Constructor, ModelObserver<AnyModel>[]>();

  public constructor(@Inject(ModuleRef) private readonly moduleRef: ModuleRef) {}

  public async onModuleInit(): Promise<void> {
    for (const { model, observer } of FrameworkRegistry.observers()) {
      const instance = this.moduleRef.get(observer as unknown as Type<object>, { strict: false });
      const observers = this.#instances.get(model) ?? [];
      observers.push(instance as ModelObserver<AnyModel>);
      this.#instances.set(model, observers);
    }
  }

  public register<TModel extends AnyModel>(
    model: Constructor<TModel>,
    observer: ModelObserver<TModel>,
  ): void {
    const observers = this.#instances.get(model) ?? [];
    observers.push(observer as ModelObserver<AnyModel>);
    this.#instances.set(model, observers);
  }

  public async dispatch<TModel extends AnyModel>(
    model: TModel,
    lifecycle: keyof ModelObserver<TModel>,
  ): Promise<void> {
    for (const observer of this.#instances.get(model.constructor as Constructor) ?? []) {
      const callback = observer[lifecycle] as
        ((value: AnyModel) => void | Promise<void>) | undefined;
      await callback?.call(observer, model);
    }
  }
}

import type { DomainModel, ModelAttributes, ModelId } from './domain-model.js';
import { ModelNotFoundError } from '../errors.js';
import type { ModelPersistenceAdapter } from '../persistence/ports.js';
import type { UnitOfWork } from '../persistence/unit-of-work.js';
import type { ObserverRegistry } from './observers.js';

export class ModelManager<
  TModel extends DomainModel<TId, TAttributes>,
  TId extends ModelId,
  TAttributes extends ModelAttributes,
> {
  public constructor(
    private readonly modelName: string,
    private readonly adapter: ModelPersistenceAdapter<TModel, TId, TAttributes>,
    private readonly unitOfWork: UnitOfWork,
    private readonly observers: ObserverRegistry,
  ) {}

  public async find(id: TId): Promise<TModel | null> {
    const model = await this.adapter.find(id);
    if (model) {
      await this.observers.dispatch(model, 'retrieved');
    }
    return model;
  }

  public async findOrFail(id: TId): Promise<TModel> {
    const model = await this.find(id);
    if (!model) {
      throw new ModelNotFoundError(this.modelName, String(id));
    }
    return model;
  }

  public save(model: TModel): Promise<TModel> {
    return this.unitOfWork.persist(model, this.adapter);
  }

  public delete(model: TModel): Promise<TModel> {
    return this.unitOfWork.persist(model, this.adapter, 'delete');
  }

  public restore(model: TModel): Promise<TModel> {
    return this.unitOfWork.persist(model, this.adapter, 'restore');
  }
}

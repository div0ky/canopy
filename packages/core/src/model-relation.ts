import type { ModelConstructor } from './model.js'

export type ModelReference = () => ModelConstructor<any, any>

export type ModelRelationship =
  | {
      readonly kind: 'belongsTo'
      readonly related: ModelReference
      readonly foreignKey: string
      readonly ownerKey: string
    }
  | {
      readonly kind: 'hasOne'
      readonly related: ModelReference
      readonly localKey: string
      readonly foreignKey: string
    }
  | {
      readonly kind: 'hasMany'
      readonly related: ModelReference
      readonly localKey: string
      readonly foreignKey: string
    }
  | {
      readonly kind: 'belongsToMany'
      readonly related: ModelReference
      readonly through: ModelReference
      readonly localKey: string
      readonly relatedKey: string
      readonly foreignKey: string
      readonly relatedForeignKey: string
    }

export function belongsTo(
  related: ModelReference,
  options: { readonly foreignKey: string; readonly ownerKey?: string },
): ModelRelationship {
  return Object.freeze({
    kind: 'belongsTo',
    related,
    foreignKey: options.foreignKey,
    ownerKey: options.ownerKey ?? 'id',
  })
}

export function hasOne(
  related: ModelReference,
  options: { readonly foreignKey: string; readonly localKey?: string },
): ModelRelationship {
  return Object.freeze({
    kind: 'hasOne',
    related,
    foreignKey: options.foreignKey,
    localKey: options.localKey ?? 'id',
  })
}

export function hasMany(
  related: ModelReference,
  options: { readonly foreignKey: string; readonly localKey?: string },
): ModelRelationship {
  return Object.freeze({
    kind: 'hasMany',
    related,
    foreignKey: options.foreignKey,
    localKey: options.localKey ?? 'id',
  })
}

export function belongsToMany(
  related: ModelReference,
  options: {
    readonly through: ModelReference
    readonly foreignKey: string
    readonly relatedForeignKey: string
    readonly localKey?: string
    readonly relatedKey?: string
  },
): ModelRelationship {
  return Object.freeze({
    kind: 'belongsToMany',
    related,
    through: options.through,
    foreignKey: options.foreignKey,
    relatedForeignKey: options.relatedForeignKey,
    localKey: options.localKey ?? 'id',
    relatedKey: options.relatedKey ?? 'id',
  })
}

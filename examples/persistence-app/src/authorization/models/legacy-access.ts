import {
  belongsTo,
  belongsToMany,
  Model,
  type ModelAttributes,
  type ModelRelationship,
} from '@doxajs/core'

export interface UserAttributes extends ModelAttributes {
  id: string
  groupId: string
  branchTag: string
}

export interface UserRelations {
  group: Group
  permissions: readonly Permission[]
}

export class User extends Model<UserAttributes, UserRelations> {
  static override readonly id = 'user'
  static override readonly relationships: Readonly<Record<string, ModelRelationship>> = {
    group: belongsTo(() => Group, { foreignKey: 'groupId' }),
    permissions: belongsToMany(() => Permission, {
      through: () => UserPermission,
      foreignKey: 'userId',
      relatedForeignKey: 'permissionId',
    }),
  }

  get branchTag(): string {
    return this.attributes.branchTag
  }

  get group(): Group {
    return this.related('group')
  }

  get permissions(): readonly Permission[] {
    return this.related('permissions')
  }
}

export interface GroupAttributes extends ModelAttributes {
  id: string
  name: string
}

export interface GroupRelations {
  permissions: readonly Permission[]
}

export class Group extends Model<GroupAttributes, GroupRelations> {
  static override readonly id = 'group'
  static override readonly relationships: Readonly<Record<string, ModelRelationship>> = {
    permissions: belongsToMany(() => Permission, {
      through: () => GroupPermission,
      foreignKey: 'groupId',
      relatedForeignKey: 'permissionId',
    }),
  }

  get permissions(): readonly Permission[] {
    return this.related('permissions')
  }
}

export interface PermissionAttributes extends ModelAttributes {
  id: string
  resource: string
  action: string
}

export class Permission extends Model<PermissionAttributes> {
  static override readonly id = 'permission'

  get resource(): string {
    return this.attributes.resource
  }

  get action(): string {
    return this.attributes.action
  }
}

export interface UserPermissionAttributes extends ModelAttributes {
  id: string
  userId: string
  permissionId: string
}

export class UserPermission extends Model<UserPermissionAttributes> {
  static override readonly id = 'user-permission'
}

export interface GroupPermissionAttributes extends ModelAttributes {
  id: string
  groupId: string
  permissionId: string
}

export class GroupPermission extends Model<GroupPermissionAttributes> {
  static override readonly id = 'group-permission'
}

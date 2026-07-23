import { Feature } from '@doxajs/core'

import { ApplicationPermissions } from './application-permissions.js'
import { ApplicationPolicy } from './application-policy.js'
import {
  AuthorizationModelSessionCommand,
  AuthorizationModelSessionEvent,
  AuthorizationModelSessionListener,
  AuthorizationModelSessionRoute,
  AuthorizationModelSessionSchedule,
  AuthorizationModelSessionScheduleJob,
  AuthorizationModelSessionSignal,
  AuthorizationModelSessionSignalHandler,
} from './authorization-entrypoints.js'
import {
  ChangeAuthorizedUserBranch,
  ChangeAuthorizedUserBranchJob,
  DispatchChangeAuthorizedUserBranchJob,
  ReadAuthorizedUser,
  SeedLegacyAccess,
} from './authorization-operations.js'
import { Group, GroupPermission, Permission, User, UserPermission } from './models/legacy-access.js'

export class AuthorizationFeature extends Feature {
  id = 'authorization'
  models = [User, Group, Permission, UserPermission, GroupPermission]
  actions = [SeedLegacyAccess, ChangeAuthorizedUserBranch, DispatchChangeAuthorizedUserBranchJob]
  queries = [ReadAuthorizedUser]
  routes = [AuthorizationModelSessionRoute]
  commands = [AuthorizationModelSessionCommand]
  events = [AuthorizationModelSessionEvent]
  listeners = [AuthorizationModelSessionListener]
  signals = [AuthorizationModelSessionSignal]
  signalHandlers = [AuthorizationModelSessionSignalHandler]
  jobs = [ChangeAuthorizedUserBranchJob, AuthorizationModelSessionScheduleJob]
  schedules = [AuthorizationModelSessionSchedule]
  policies = [ApplicationPolicy]
  permissionSources = [ApplicationPermissions]
}

import type { ActorRef, ExecutionScoped } from '@doxajs/core'

export class ApplicationAccess implements ExecutionScoped {
  async abilitiesFor(actor: ActorRef): Promise<readonly string[]> {
    if (actor.id === 'permission-source-error') {
      throw new Error('Permission source unavailable.')
    }
    if (actor.id === 'permission-source-primitive-error') {
      throw 'primitive permission source details'
    }
    if (actor.id === 'permission-user') return ['contact.read', 'contact.update']
    if (actor.id === 'read-only-user') return ['contact.read']
    if (actor.id === 'undeclared-user') return ['contact.delete']
    return []
  }
}

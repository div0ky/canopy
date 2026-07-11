import { Action } from '@canopy/core'
import { LegacyNote } from '../models/legacy-note.js'

export class SaveLegacyNote extends Action<{ id: string; body: string }, { body: string; version: number }> {
  static id = 'save-legacy-note'
  static override readonly access = 'public'
  async handle(input: { id: string; body: string }): Promise<{ body: string; version: number }> {
    const note = await LegacyNote.find(input.id) ?? LegacyNote.make(input)
    note.revise(input.body)
    await note.save()
    return { body: note.body, version: note.version! }
  }
}

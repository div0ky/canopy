import { Model, type ModelAttributes } from '@canopy/core'

export interface LegacyNoteAttributes extends ModelAttributes { id: string; body: string }

export class LegacyNote extends Model<LegacyNoteAttributes> {
  static override readonly id = 'legacy-note'
  static override readonly table = 'legacy_notes'

  get body(): string { return this.attributes.body }
  revise(body: string): void { this.attributes.body = body }
}

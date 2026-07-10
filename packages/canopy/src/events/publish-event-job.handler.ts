import { PublishEventJob } from '@evergreen/canopy-jobs';
import { EventDispatcher } from './event-dispatcher.js';
import { Inject } from '@nestjs/common';
import type { DomainEvent } from './events.js';
import { JobHandler, type HandlesJob } from '../jobs/jobs.js';

type PublishPayload = ReturnType<typeof PublishEventJob.parse>;

@JobHandler(PublishEventJob)
export class PublishEventJobHandler implements HandlesJob<PublishPayload> {
  public constructor(@Inject(EventDispatcher) private readonly events: EventDispatcher) {}

  public async handle(message: PublishPayload): Promise<void> {
    const payload = message.payload;
    const event: DomainEvent = {
      id: String(payload['eventId']),
      type: message.eventType,
      version: message.eventVersion,
      aggregateType: String(payload['aggregateType']),
      aggregateId: String(payload['aggregateId']),
      aggregateVersion: Number(payload['aggregateVersion']),
      payload: this.record(payload['payload']),
      metadata: message.metadata,
      occurredAt: new Date(String(payload['occurredAt'])),
    };
    await this.events.dispatchQueued([event]);
  }

  private record(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : { value };
  }
}

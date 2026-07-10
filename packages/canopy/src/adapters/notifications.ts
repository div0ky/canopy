import type { DatabaseClient } from '@evergreen/db';
import sendgrid from '@sendgrid/mail';
import Twilio from 'twilio';
import type { Broadcaster } from '../broadcasting/broadcasting.js';
import type {
  Notification,
  NotificationSender,
  Notifiable,
} from '../notifications/notifications.js';

export interface ProductionNotificationOptions {
  readonly database: DatabaseClient;
  readonly broadcaster: Broadcaster;
  readonly twilio?: {
    readonly accountSid: string;
    readonly authToken: string;
    readonly from: string;
  };
  readonly sendgrid?: {
    readonly apiKey: string;
    readonly from: string;
  };
}

export class ProductionNotificationSender implements NotificationSender {
  readonly #twilio?: ReturnType<typeof Twilio>;

  public constructor(private readonly options: ProductionNotificationOptions) {
    if (options.twilio) this.#twilio = Twilio(options.twilio.accountSid, options.twilio.authToken);
    if (options.sendgrid) sendgrid.setApiKey(options.sendgrid.apiKey);
  }

  public async send<TData>(
    notifiable: Notifiable,
    notification: Notification<TData>,
  ): Promise<void> {
    for (const channel of notification.via(notifiable)) {
      switch (channel) {
        case 'database': {
          if (!notification.toDatabase)
            throw new Error(`${notification.name} has no database representation`);
          const data = await notification.toDatabase(notifiable);
          await this.options.database.notification.create({
            data: {
              userId: notifiable.id,
              type: notification.name,
              data: data as object,
            },
          });
          break;
        }
        case 'sms': {
          if (!this.#twilio || !this.options.twilio || !notifiable.phone || !notification.toSms) {
            throw new Error(`SMS channel is not configured for ${notification.name}`);
          }
          await this.#twilio.messages.create({
            to: notifiable.phone,
            from: this.options.twilio.from,
            body: await notification.toSms(notifiable),
          });
          break;
        }
        case 'email': {
          if (!this.options.sendgrid || !notifiable.email || !notification.toMail) {
            throw new Error(`Email channel is not configured for ${notification.name}`);
          }
          const mail = await notification.toMail(notifiable);
          await sendgrid.send({
            to: notifiable.email,
            from: this.options.sendgrid.from,
            subject: mail.subject,
            text: mail.text,
            html: mail.html ?? mail.text,
          });
          break;
        }
        case 'broadcast': {
          if (!notification.toBroadcast)
            throw new Error(`${notification.name} has no broadcast representation`);
          await this.options.broadcaster.broadcast({
            channel: `users.${notifiable.id}`,
            event: notification.name,
            payload: await notification.toBroadcast(notifiable),
          });
          break;
        }
      }
    }
  }
}

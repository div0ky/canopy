export type NotificationChannel = 'database' | 'sms' | 'email' | 'broadcast';

export interface Notifiable {
  readonly id: string;
  readonly email?: string;
  readonly phone?: string;
  readonly locale?: string;
}

export interface MailMessage {
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface Notification<TData = Readonly<Record<string, unknown>>> {
  readonly name: string;
  via(notifiable: Notifiable): readonly NotificationChannel[];
  toDatabase?(notifiable: Notifiable): TData | Promise<TData>;
  toSms?(notifiable: Notifiable): string | Promise<string>;
  toMail?(notifiable: Notifiable): MailMessage | Promise<MailMessage>;
  toBroadcast?(notifiable: Notifiable): TData | Promise<TData>;
}

export interface NotificationSender {
  send<TData>(notifiable: Notifiable, notification: Notification<TData>): Promise<void>;
}

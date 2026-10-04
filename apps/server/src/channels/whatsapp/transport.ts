/**
 * Messaging transport abstraction. The investigation engine and the conversation logic depend
 * only on this interface, so the Twilio sandbox can be replaced by a production Twilio sender or
 * by Meta's WhatsApp Cloud API without touching either.
 */
export interface InboundMedia {
  url: string;
  contentType: string;
  /** Provider id of the media item (used to delete it after reading). */
  providerMediaId: string | null;
}

export interface InboundMessage {
  providerMessageId: string;
  /** Stable user identifier (WhatsApp user id / BSUID / phone), hashed before storage. */
  userKey: string;
  /** Address replies are sent to; kept only encrypted, only until the reply is sent. */
  replyTo: string;
  text: string;
  media: InboundMedia[];
  forwarded: boolean;
  frequentlyForwarded: boolean;
  receivedAt: string;
}

export interface MessagingTransport {
  readonly provider: string;
  send(to: string, body: string): Promise<{ id: string }>;
  downloadMedia(
    media: InboundMedia,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; contentType: string }>;
  deleteMedia?(messageId: string, media: InboundMedia): Promise<void>;
  /** Recent inbound messages, used to catch up after downtime (e.g. a cold start). */
  listRecentInbound?(since: Date): Promise<InboundMessage[]>;
}

/** Provider errors that retrying will not fix (user left sandbox, outside 24h window...). */
export class PermanentSendError extends Error {
  constructor(
    message: string,
    readonly code: string | number | null,
  ) {
    super(message);
  }
}

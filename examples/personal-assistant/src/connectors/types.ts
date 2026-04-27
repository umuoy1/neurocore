import type { CredentialVault } from "../security/credential-vault.js";

export interface WebSearchConfig {
  apiKey?: string;
  apiKeyRef?: string;
  credentialVault?: CredentialVault;
  credentialScope?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResults?: number;
}

export interface WebBrowserConfig {
  fetch?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  maxChars?: number;
}

export interface EmailMessage {
  from: string;
  subject: string;
  date: string;
  body_preview: string;
  has_attachments: boolean;
}

export interface EmailReadProvider {
  read(args: {
    query?: string;
    max_results?: number;
    unread_only?: boolean;
  }): Promise<{ emails: EmailMessage[] }>;
}

export interface EmailSendProvider {
  send(args: {
    to: string[];
    subject: string;
    body: string;
    cc?: string[];
  }): Promise<{ message_id: string; sent_at: string }>;
}

export interface CalendarEvent {
  event_id: string;
  title: string;
  start_time: string;
  end_time: string;
  location?: string;
  attendees?: string[];
}

export interface CalendarReadProvider {
  read(args: {
    start_date?: string;
    end_date?: string;
    max_results?: number;
  }): Promise<{ events: CalendarEvent[] }>;
}

export interface CalendarWriteProvider {
  write(args: {
    title: string;
    start_time: string;
    end_time: string;
    location?: string;
    attendees?: string[];
  }): Promise<{ event_id: string }>;
}

export interface ServiceConnectorConfig {
  search?: WebSearchConfig;
  browser?: WebBrowserConfig;
  email?: {
    reader?: EmailReadProvider;
    sender?: EmailSendProvider;
  };
  calendar?: {
    reader?: CalendarReadProvider;
    writer?: CalendarWriteProvider;
  };
}

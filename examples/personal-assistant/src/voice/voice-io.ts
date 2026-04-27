import type { UnifiedMessage, PersonalMediaAttachment, MessageContent } from "../im-gateway/types.js";

export interface SpeechToTextInput {
  message: UnifiedMessage;
  attachment: PersonalMediaAttachment;
}

export interface SpeechToTextResult {
  text: string;
  provider: string;
  language?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface TextToSpeechInput {
  text: string;
  message: UnifiedMessage;
  voice_id?: string;
  format?: "mp3" | "ogg" | "wav";
}

export interface TextToSpeechResult {
  url: string;
  mime_type: string;
  provider: string;
  transcript: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult>;
}

export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(input: TextToSpeechInput): Promise<TextToSpeechResult>;
}

export interface VoiceIOServiceOptions {
  sttProvider?: SpeechToTextProvider;
  ttsProvider?: TextToSpeechProvider;
  defaultVoiceOutput?: boolean;
  fallbackToText?: boolean;
  voiceId?: string;
}

export interface VoiceIOTranscriptionReport {
  message: UnifiedMessage;
  metadata: Record<string, unknown>;
}

export interface VoiceIOSynthesisReport {
  content?: Extract<MessageContent, { type: "voice" }>;
  error?: string;
  metadata: Record<string, unknown>;
}

export class VoiceIOService {
  private readonly voiceOutputPreferences = new Map<string, boolean>();

  public constructor(private readonly options: VoiceIOServiceOptions = {}) {}

  public setVoiceOutput(message: UnifiedMessage, enabled: boolean): void {
    this.voiceOutputPreferences.set(this.voicePreferenceKey(message), enabled);
  }

  public getVoiceOutput(message: UnifiedMessage): boolean | undefined {
    return this.voiceOutputPreferences.get(this.voicePreferenceKey(message));
  }

  public async transcribeMessage(message: UnifiedMessage): Promise<VoiceIOTranscriptionReport> {
    const pushToTalk = isPushToTalkMessage(message);
    const attachments = message.attachments ?? [];
    const results: Record<string, unknown>[] = [];
    const errors: Record<string, unknown>[] = [];
    const nextAttachments: PersonalMediaAttachment[] = [];

    for (const attachment of attachments) {
      if (!isSpeechAttachment(attachment) || attachment.transcript || !this.options.sttProvider) {
        nextAttachments.push(attachment);
        continue;
      }
      try {
        const result = await this.options.sttProvider.transcribe({ message, attachment });
        results.push({
          attachment_id: attachment.attachment_id,
          provider: result.provider,
          text: result.text,
          language: result.language,
          confidence: result.confidence,
          metadata: result.metadata
        });
        nextAttachments.push({
          ...attachment,
          transcript: result.text,
          metadata: {
            ...attachment.metadata,
            stt_provider: result.provider,
            stt_language: result.language,
            stt_confidence: result.confidence
          }
        });
      } catch (error) {
        errors.push({
          attachment_id: attachment.attachment_id,
          error: error instanceof Error ? error.message : String(error)
        });
        nextAttachments.push(attachment);
      }
    }

    const nextContent = applyPrimaryTranscript(message.content, nextAttachments);
    const metadata = {
      push_to_talk: pushToTalk,
      stt_provider: this.options.sttProvider?.name,
      transcription_count: results.length,
      transcriptions: results,
      errors
    };

    return {
      message: {
        ...message,
        content: nextContent,
        attachments: nextAttachments,
        metadata: {
          ...message.metadata,
          voice_io: metadata
        }
      },
      metadata
    };
  }

  public shouldSynthesize(message: UnifiedMessage, sessionMetadata: Record<string, unknown> | undefined): boolean {
    if (!this.options.ttsProvider) {
      return false;
    }
    const preference = this.getVoiceOutput(message);
    if (preference === false) {
      return false;
    }
    if (preference === true) {
      return true;
    }
    if (message.metadata.voice_output === true || message.metadata.tts === true) {
      return true;
    }
    if (sessionMetadata?.voice_output_enabled === true) {
      return true;
    }
    return this.options.defaultVoiceOutput === true && message.channel?.capabilities.voice === true;
  }

  public async synthesizeResponse(message: UnifiedMessage, text: string): Promise<VoiceIOSynthesisReport> {
    if (!this.options.ttsProvider) {
      return {
        error: "TTS provider is not configured.",
        metadata: {
          tts_provider: undefined,
          fallback_to_text: true
        }
      };
    }
    try {
      const result = await this.options.ttsProvider.synthesize({
        text,
        message,
        voice_id: this.options.voiceId
      });
      return {
        content: {
          type: "voice",
          url: result.url,
          mime_type: result.mime_type,
          transcript: result.transcript,
          duration_ms: result.duration_ms
        },
        metadata: {
          tts_provider: result.provider,
          fallback_to_text: false,
          metadata: result.metadata
        }
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          tts_provider: this.options.ttsProvider.name,
          fallback_to_text: this.options.fallbackToText !== false
        }
      };
    }
  }

  private voicePreferenceKey(message: UnifiedMessage): string {
    const routeKey = message.channel?.route_key ?? `${message.platform}:${message.chat_id}`;
    const userId = message.identity?.canonical_user_id ?? message.sender_id;
    return `${routeKey}:${userId}`;
  }
}

export interface FixtureSpeechToTextProviderOptions {
  transcript?: string;
  fail?: boolean;
}

export class FixtureSpeechToTextProvider implements SpeechToTextProvider {
  public readonly name = "fixture-stt";

  public constructor(private readonly options: FixtureSpeechToTextProviderOptions = {}) {}

  public async transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult> {
    if (this.options.fail) {
      throw new Error("fixture STT failure");
    }
    return {
      text: this.options.transcript ?? input.attachment.transcript ?? input.attachment.text_excerpt ?? `transcribed ${input.attachment.attachment_id}`,
      provider: this.name,
      language: "en",
      confidence: 0.99
    };
  }
}

export interface FixtureTextToSpeechProviderOptions {
  audioUrl?: string;
  fail?: boolean;
}

export class FixtureTextToSpeechProvider implements TextToSpeechProvider {
  public readonly name = "fixture-tts";

  public constructor(private readonly options: FixtureTextToSpeechProviderOptions = {}) {}

  public async synthesize(input: TextToSpeechInput): Promise<TextToSpeechResult> {
    if (this.options.fail) {
      throw new Error("fixture TTS failure");
    }
    return {
      url: this.options.audioUrl ?? `fixture://voice/${encodeURIComponent(input.message.message_id)}.ogg`,
      mime_type: "audio/ogg",
      provider: this.name,
      transcript: input.text,
      duration_ms: Math.max(500, input.text.length * 25)
    };
  }
}

function isSpeechAttachment(attachment: PersonalMediaAttachment): boolean {
  return attachment.kind === "audio" || attachment.kind === "voice";
}

function isPushToTalkMessage(message: UnifiedMessage): boolean {
  return message.content.type === "voice" ||
    message.metadata.push_to_talk === true ||
    message.metadata.event_type === "push_to_talk";
}

function applyPrimaryTranscript(content: MessageContent, attachments: PersonalMediaAttachment[]): MessageContent {
  if (content.type !== "audio" && content.type !== "voice") {
    return content;
  }
  if (content.transcript) {
    return content;
  }
  const transcript = attachments.find((attachment) => attachment.kind === content.type && attachment.transcript)?.transcript;
  return transcript ? { ...content, transcript } : content;
}

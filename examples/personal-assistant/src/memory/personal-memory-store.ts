import type { IMPlatform, UnifiedMessage } from "../im-gateway/types.js";

export type PersonalMemoryStatus = "active" | "tombstoned";

export interface PersonalMemorySource {
  platform?: IMPlatform;
  chat_id?: string;
  message_id?: string;
}

export interface PersonalMemoryRecord {
  memory_id: string;
  user_id: string;
  content: string;
  status: PersonalMemoryStatus;
  correction_of?: string;
  source?: PersonalMemorySource;
  created_at: string;
  updated_at: string;
  tombstoned_at?: string;
}

export interface RememberPersonalMemoryInput {
  user_id: string;
  content: string;
  correction_of?: string;
  source?: PersonalMemorySource;
  created_at?: string;
}

export interface PersonalMemoryStore {
  remember(input: RememberPersonalMemoryInput): PersonalMemoryRecord;
  listActive(userId: string, limit?: number): PersonalMemoryRecord[];
  forget(userId: string, target: string, forgottenAt?: string): PersonalMemoryRecord[];
  correct(
    userId: string,
    target: string,
    content: string,
    source?: PersonalMemorySource,
    correctedAt?: string
  ): { forgotten: PersonalMemoryRecord[]; memory: PersonalMemoryRecord };
  close?(): void;
}

export function memorySourceFromMessage(message: UnifiedMessage): PersonalMemorySource {
  return {
    platform: message.platform,
    chat_id: message.chat_id,
    message_id: message.message_id
  };
}

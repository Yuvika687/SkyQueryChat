// Recent chats live only in this browser (no login). Every access is guarded: storage can be blocked.
import type { Turn } from "./chat-state";

export interface SavedChat {
  id: string;
  title: string;
  updatedAt: number;
  sessionId?: string;
  turns: Turn[];
}

const KEY = "sq_recent_chats_v1";
const MAX = 12;

export function loadChats(): SavedChat[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as SavedChat[]) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveChat(chat: SavedChat): SavedChat[] {
  const list = [chat, ...loadChats().filter((c) => c.id !== chat.id)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // quota or blocked storage: keep the in-memory list only
  }
  return list;
}

export function deleteChat(id: string): SavedChat[] {
  const list = loadChats().filter((c) => c.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

export function getPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(`sq_${key}`) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: string) {
  try {
    localStorage.setItem(`sq_${key}`, value);
  } catch {
    /* ignore */
  }
}

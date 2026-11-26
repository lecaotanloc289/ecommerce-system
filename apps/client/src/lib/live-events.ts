'use client';

import * as React from 'react';
import { SendLiveChatMessageSchema } from '@repo/core';
import type { LiveEventSchema, LiveSessionStatus, ReactionKind } from '@repo/core';
import { getLiveSession, liveChatLines, mockLiveUser } from '../mocks/live';

/**
 * Mock realtime layer for the live watch page.
 *
 * The reducer consumes core `LiveEvent`s via the schema's INPUT type (ids are plain strings,
 * which is also what the non-ULID mock ids are). The mock source is the `setInterval` timers
 * in `useLiveEvents`; the real source is an `EventSource` on `/v1/live-sessions/:id/events`
 * whose `message` handler runs `LiveEventSchema.parse` and calls the same `dispatch`.
 * `sendMessage` / `sendReaction` become `POST .../chat` and `POST .../reactions` (the server
 * echoes `chat.message` / `reaction.burst`). Nothing outside this file changes.
 */
type LiveEventInput = (typeof LiveEventSchema)['_zod']['input'];

export type LiveChatLine = Extract<LiveEventInput, { type: 'chat.message' }>['message'] & {
  isOwn: boolean;
};

/** Max chat length, read from the core request schema (undefined if core drops the bound). */
export const CHAT_MAX_LENGTH = SendLiveChatMessageSchema.shape.text.maxLength ?? undefined;

export interface ReactionBurst {
  /** Monotonic — a new value means a new burst to animate. */
  seq: number;
  count: number;
}

interface LiveState {
  status: LiveSessionStatus;
  messages: LiveChatLine[];
  viewers: number;
  productIds: string[];
  pinnedProductId: string | null;
  burst: ReactionBurst;
}

const MAX_MESSAGES = 100; // server keeps ~200 (live:{id}:chat MAXLEN); the UI needs fewer

function reduce(state: LiveState, event: LiveEventInput): LiveState {
  switch (event.type) {
    case 'chat.message':
      if (state.messages.some((m) => m.id === event.message.id)) return state;
      return {
        ...state,
        messages: [...state.messages, { ...event.message, isOwn: false }].slice(-MAX_MESSAGES),
      };
    case 'chat.deleted':
      return { ...state, messages: state.messages.filter((m) => m.id !== event.messageId) };
    case 'viewers.updated':
      return { ...state, viewers: event.count };
    case 'product.pinned':
      return { ...state, pinnedProductId: event.productId };
    case 'product.unpinned':
      return state.pinnedProductId === event.productId
        ? { ...state, pinnedProductId: null }
        : state;
    case 'products.updated': {
      const productIds = [...event.products]
        .sort((a, b) => a.position - b.position)
        .map((p) => p.productId);
      const pinned = event.products.find((p) => p.pinnedAt !== null)?.productId ?? null;
      return { ...state, productIds, pinnedProductId: pinned };
    }
    case 'reaction.burst': {
      const count = Object.values(event.counts).reduce((sum, n) => sum + n, 0);
      return { ...state, burst: { seq: state.burst.seq + 1, count } };
    }
    case 'session.live':
      return { ...state, status: 'LIVE' };
    case 'session.ended':
      return { ...state, status: 'ENDED', pinnedProductId: null };
    case 'session.cancelled':
      return { ...state, status: 'CANCELLED', pinnedProductId: null };
    // Vendor-side lifecycle signals: nothing to render on the storefront.
    case 'session.provisioned':
    case 'encoder.status':
    case 'recording.ready':
      return state;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

type Action = LiveEventInput | { type: 'local.message'; line: LiveChatLine };

function reduceAction(state: LiveState, action: Action): LiveState {
  if (action.type === 'local.message') {
    return { ...state, messages: [...state.messages, action.line].slice(-MAX_MESSAGES) };
  }
  return reduce(state, action);
}

const SEEDED_LINES = 8;
const CHAT_INTERVAL_MS = 2600;
const VIEWERS_INTERVAL_MS = 4000;
const PIN_INTERVAL_MS = 30_000;
const REACTION_INTERVAL_MS = 3500;

function chatLine(sessionId: string, n: number, sentAt: string): LiveChatLine {
  const line = liveChatLines[n % liveChatLines.length] ?? { displayName: '', text: '' };
  return {
    id: `${sessionId}-${n}`,
    sessionId,
    userId: `mock-viewer-${n % liveChatLines.length}`,
    displayName: line.displayName,
    text: line.text,
    sentAt,
    isOwn: false,
  };
}

function initialState(sessionId: string): LiveState {
  const session = getLiveSession(sessionId);
  const isLive = session?.status === 'LIVE';
  return {
    status: session?.status ?? 'CANCELLED',
    // Stable seed timestamps keep the prerendered HTML hydration-safe.
    messages: isLive
      ? liveChatLines
          .slice(0, SEEDED_LINES)
          .map((_, n) => chatLine(sessionId, n, session?.startedAt ?? ''))
      : [],
    viewers: isLive ? Math.round((session?.peakViewers ?? 0) * 0.85) : 0,
    productIds: session?.products.map((p) => p.productId) ?? [],
    pinnedProductId: session?.products.find((p) => p.pinnedAt !== null)?.productId ?? null,
    burst: { seq: 0, count: 0 },
  };
}

export interface UseLiveEvents {
  status: LiveSessionStatus;
  messages: LiveChatLine[];
  viewers: number;
  productIds: string[];
  pinnedProductId: string | null;
  /** Latest reaction burst (own + other viewers) for the floating-hearts layer. */
  burst: ReactionBurst;
  sendMessage: (text: string) => void;
  sendReaction: (kind: ReactionKind) => void;
}

export function useLiveEvents(sessionId: string): UseLiveEvents {
  const session = getLiveSession(sessionId);
  const isMockLive = session?.status === 'LIVE';
  const [state, dispatch] = React.useReducer(reduceAction, sessionId, initialState);
  const counterRef = React.useRef(SEEDED_LINES);

  React.useEffect(() => {
    if (!isMockLive || !session) return;
    const productIds = session.products.map((p) => p.productId);
    const timers: ReturnType<typeof setInterval>[] = [];

    timers.push(
      setInterval(() => {
        dispatch({
          type: 'chat.message',
          message: chatLine(sessionId, counterRef.current++, new Date().toISOString()),
        });
      }, CHAT_INTERVAL_MS),
    );
    timers.push(
      setInterval(() => {
        const base = Math.round(session.peakViewers * 0.85);
        const count = Math.max(0, base + Math.round((Math.random() - 0.5) * 80));
        dispatch({ type: 'viewers.updated', sessionId, count });
      }, VIEWERS_INTERVAL_MS),
    );
    timers.push(
      setInterval(() => {
        dispatch({
          type: 'reaction.burst',
          sessionId,
          counts: { HEART: 1 + Math.floor(Math.random() * 3) },
        });
      }, REACTION_INTERVAL_MS),
    );
    let pinIndex = 0;
    if (productIds.length > 1) {
      timers.push(
        setInterval(() => {
          pinIndex = (pinIndex + 1) % productIds.length;
          const productId = productIds[pinIndex];
          if (productId) {
            dispatch({
              type: 'product.pinned',
              sessionId,
              productId,
              pinnedAt: new Date().toISOString(),
            });
          }
        }, PIN_INTERVAL_MS),
      );
    }
    return () => timers.forEach(clearInterval);
  }, [isMockLive, session, sessionId]);

  const sendMessage = React.useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !mockLiveUser.isSignedIn) return;
      const n = counterRef.current++;
      dispatch({
        type: 'local.message',
        line: {
          id: `${sessionId}-own-${n}`,
          sessionId,
          userId: 'mock-self',
          displayName: mockLiveUser.displayName,
          text: CHAT_MAX_LENGTH ? trimmed.slice(0, CHAT_MAX_LENGTH) : trimmed,
          sentAt: new Date().toISOString(),
          isOwn: true,
        },
      });
    },
    [sessionId],
  );

  const sendReaction = React.useCallback(
    (kind: ReactionKind) => {
      dispatch({ type: 'reaction.burst', sessionId, counts: { [kind]: 1 } });
    },
    [sessionId],
  );

  return {
    status: state.status,
    messages: state.messages,
    viewers: state.viewers,
    productIds: state.productIds,
    pinnedProductId: state.pinnedProductId,
    burst: state.burst,
    sendMessage,
    sendReaction,
  };
}

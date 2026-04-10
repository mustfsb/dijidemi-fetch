import { useRef, useCallback } from 'react';

interface StreamMeta {
  resolvedImageUrl?: string;
  resolvedImageUrls?: string[];
}

interface StreamCallbacks {
  onMeta?: (meta: StreamMeta) => void;
  onToken?: (token: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (error: string) => void;
}

export function useStreamingChat() {
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startStream = useCallback(async (
    url: string,
    body: Record<string, unknown>,
    callbacks: StreamCallbacks,
    authFetchFn: (url: string, init?: RequestInit) => Promise<Response>
  ) => {
    abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await authFetchFn(url, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Handle non-stream error responses (JSON)
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        const data = await response.json();
        callbacks.onError?.(data.error || 'Beklenmeyen yanıt formatı.');
        return;
      }

      if (!response.body) {
        callbacks.onError?.('Yanıt akışı alınamadı.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr);

            if (event.meta) {
              callbacks.onMeta?.(event.meta);
            } else if (event.token) {
              callbacks.onToken?.(event.token);
            } else if (event.done) {
              callbacks.onDone?.(event.fullText || '');
            } else if (event.error) {
              callbacks.onError?.(event.error);
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      callbacks.onError?.(err.message || 'Bağlantı hatası.');
    } finally {
      abortRef.current = null;
    }
  }, [abort]);

  return { startStream, abort };
}

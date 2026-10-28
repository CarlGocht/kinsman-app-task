import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { MovementCommand } from '../shared/protocol';

const arrows = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function useMapMovement(container: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element || !enabled) return;
    setMoving(false);
    setError('');
    const keys = new Set<string>();
    let pending: MovementCommand | null = null;
    let sending = false;
    let disposed = false;
    let active = false;
    async function drain() {
      if (sending) return;
      sending = true;
      while (pending) {
        const command = pending;
        pending = null;
        try {
          const response = await fetch('/api/movement', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(command), signal: AbortSignal.timeout(700), keepalive: true,
          });
          if (!response.ok) throw new Error(`Movement request failed (${response.status})`);
          if (!disposed) setError('');
        } catch {
          if (!disposed) setError('Movement command failed. The server stops automatically if commands expire.');
        }
      }
      sending = false;
    }
    function send() {
      const north = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
      const east = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
      active = Boolean(north || east);
      if (!disposed) setMoving(active);
      pending = { north, east };
      void drain();
    }
    function stop() {
      keys.clear();
      if (active) send();
    }
    function down(event: KeyboardEvent) {
      if (!arrows.has(event.key) || event.target !== element) return;
      event.preventDefault();
      if (!keys.has(event.key)) { keys.add(event.key); send(); }
    }
    function up(event: KeyboardEvent) {
      if (!keys.has(event.key)) return;
      event.preventDefault();
      keys.delete(event.key); send();
    }
    function focusMap(event: MouseEvent) {
      if (event.target instanceof Element && !event.target.closest('button, a')) element!.focus({ preventScroll: true });
    }
    element.addEventListener('click', focusMap);
    const heartbeat = setInterval(() => { if (active) send(); }, 200);
    const hidden = () => { if (document.hidden) stop(); };
    element.addEventListener('keydown', down);
    element.addEventListener('focusout', stop);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      disposed = true;
      stop();
      clearInterval(heartbeat);
      element.removeEventListener('click', focusMap);
      element.removeEventListener('keydown', down);
      element.removeEventListener('focusout', stop);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [container, enabled]);
  return { error, moving: enabled && moving };
}

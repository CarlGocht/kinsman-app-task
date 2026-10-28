import { useCallback, useEffect, useRef, useState } from 'react';
import type { Measurement, MovementState, SensorSettings, ServerMessage } from '../shared/protocol';

export function useSensor() {
  const [motion, setMotion] = useState<{ state: MovementState; receivedAt: number } | null>(null);
  const [connection, setConnection] = useState('Connecting');
  const [settings, setSettings] = useState<SensorSettings | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<Measurement[]>([]);
  const [clients, setClients] = useState<number | null>(null);
  const [streamError, setStreamError] = useState('');
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch('/api/settings', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Settings request failed (${response.status})`);
      const data = await response.json() as SensorSettings;
      if (controller.signal.aborted) return;
      setSettings(data);
      setSettingsError('');
      setUpdatedAt(new Date().toISOString());
    } catch (error) {
      if (!controller.signal.aborted) setSettingsError(error instanceof Error ? error.message : 'Unable to load settings');
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void refresh();
    function connect() {
      setConnection('Connecting');
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      socket.onopen = () => {
        if (disposed) return;
        setConnection('Connected');
        setStreamError('');
        setMotion(null);
        setHistory([]); // A server restart can reset sequence IDs; start a fresh connection history.
        void refresh();
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          if (message.type === 'motion') setMotion({ state: message.data, receivedAt: performance.now() });
          if (message.type === 'measurement') setHistory((previous) => [message.data, ...previous].slice(0, 50));
          if (message.type === 'status') setClients(message.data.connectedClients);
        } catch {
          setStreamError('Unable to read a server message.');
        }
      };
      socket.onerror = () => { if (!disposed) setStreamError('Cannot reach the sensor stream. Check that the server is running.'); };
      socket.onclose = () => {
        if (disposed) return;
        setConnection('Disconnected');
        setClients(null);
        retry = setTimeout(connect, 2000);
      };
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.onclose = null;
      socket.close();
      request.current?.abort();
    };
  }, [refresh]);

  return { motion, connection, settings, settingsError, refreshing, updatedAt, history, clients, streamError, refresh };
}

import type { SettingsPatch } from '../shared/settingsControls';
import { appendReading, emptyReadingHistory } from './readingHistory';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FaultState, MovementState, SensorSettings, ServerMessage } from '../shared/protocol';

export function useSensor() {
  const [faultState, setFaultState] = useState<FaultState | null>(null);
  const [triggeringFault, setTriggeringFault] = useState(false);
  const [faultError, setFaultError] = useState('');
  const faultGeneration = useRef(0);
  const [motion, setMotion] = useState<{ state: MovementState; receivedAt: number } | null>(null);
  const [connection, setConnection] = useState('Connecting');
  const [settings, setSettings] = useState<SensorSettings | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsUpdateError, setSettingsUpdateError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [readings, setReadings] = useState(emptyReadingHistory);
  const history = useMemo(() => readings.pairs.map((pair) => pair.raw), [readings.pairs]);
  const [clients, setClients] = useState<number | null>(null);
  const [streamError, setStreamError] = useState('');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settingsGeneration = useRef(0);
  const request = useRef<AbortController | null>(null);

  const acceptSettings = useCallback((next: SensorSettings) => {
    settingsRef.current = next;
    setSettings(next);
    setSettingsError('');
    setUpdatedAt(new Date().toISOString());
  }, []);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const generation = settingsGeneration.current;
    setRefreshing(true);
    try {
      const response = await fetch('/api/settings', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Settings request failed (${response.status})`);
      const data = await response.json() as SensorSettings;
      if (controller.signal.aborted || generation !== settingsGeneration.current) return;
      acceptSettings(data);
    } catch (error) {
      if (!controller.signal.aborted) setSettingsError(error instanceof Error ? error.message : 'Unable to load settings');
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, [acceptSettings]);

  const updateSettings = useCallback(async (patch: SettingsPatch) => {
    setSavingSettings(true);
    setSettingsUpdateError('');
    const generation = settingsGeneration.current;
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch), signal: AbortSignal.timeout(5000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Settings update failed (${response.status})`);
      if (settingsGeneration.current === generation) acceptSettings(body as SensorSettings);
      return true;
    } catch (error) {
      setSettingsUpdateError(error instanceof Error ? error.message : 'Settings update failed');
      return false;
    } finally { setSavingSettings(false); }
  }, [acceptSettings]);

  const triggerBadDataFault = useCallback(async () => {
    setTriggeringFault(true); setFaultError('');
    const generation = faultGeneration.current;
    try {
      const response = await fetch('/api/faults/bad-data', { method: 'POST', signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Unable to trigger fault');
      if (faultGeneration.current === generation) setFaultState(body as FaultState);
    } catch (error) { setFaultError(error instanceof Error ? error.message : 'Unable to trigger fault'); }
    finally { setTriggeringFault(false); }
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
        setFaultState(null);
        setFaultError('');
        setReadings(emptyReadingHistory()); // A server restart can reset sequence IDs; start a fresh connection history.
        void refresh();
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          if (message.type === 'faults') {
            faultGeneration.current++;
            setFaultState(message.data);
          }
          if (message.type === 'settings') {
            settingsGeneration.current++;
            request.current?.abort();
            setRefreshing(false);
            acceptSettings(message.data);
          }
          if (message.type === 'motion') setMotion({ state: message.data, receivedAt: performance.now() });
          if (message.type === 'measurement') {
            setReadings((previous) => appendReading(previous, message.data, settingsRef.current));
          }
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
  }, [refresh, acceptSettings]);

  return { detections: readings.detections, faultState, triggeringFault, faultError, triggerBadDataFault, updateSettings, savingSettings, settingsUpdateError, predictions: readings.predictions, pairs: readings.pairs, motion, connection, settings, settingsError, refreshing, updatedAt, history, clients, streamError, refresh };
}

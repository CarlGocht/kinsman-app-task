import { useState } from 'react';
import { SETTINGS_CONTROLS, settingsPatchError } from '../shared/settingsControls';
import type { SettingsPatch } from '../shared/settingsControls';
import type { SensorSettings } from '../shared/protocol';

interface Props {
  settings: SensorSettings | null;
  connected: boolean;
  saving: boolean;
  error: string;
  onApply: (patch: SettingsPatch) => Promise<boolean>;
}

export function SettingsControls({ settings, connected, saving, error, onApply }: Props) {
  // Keep only edited fields: changes from another client still update unedited controls.
  const [edits, setEdits] = useState<SettingsPatch>({});
  const [applied, setApplied] = useState(false);
  if (!settings) return <section className="panel settings-controls"><h2>Sensor controls</h2><p className="empty">Waiting for server settings…</p></section>;
  const values = { ...settings, ...edits };
  const patch = Object.fromEntries(Object.entries(edits).filter(([key, value]) => value !== settings[key as keyof SensorSettings])) as SettingsPatch;
  const dirty = Object.keys(patch).length > 0;
  const validation = dirty ? settingsPatchError(patch, settings) : null;
  return <section className="panel settings-controls" aria-label="Sensor controls">
    <div className="panel-head"><div><p className="eyebrow">LIVE SIMULATOR SETTINGS</p><h2>Sensor controls</h2></div><span className="tag">{values.sampleIntervalMs > 0 ? (1000 / values.sampleIntervalMs).toFixed(2) : '—'} samples/s</span></div>
    <p className="footnote">Adjust the sliders or enter exact values, then apply. Changes affect the running sensor and sync to every connected client. Position jitter applies to latitude/longitude together as a radius.</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!dirty || validation || saving || !connected) return;
      void onApply(patch).then((success) => { if (success) { setEdits({}); setApplied(true); } });
    }}>
      <fieldset disabled={saving || !connected}>
        <div className="settings-grid">{SETTINGS_CONTROLS.map((control) => <div className="setting-control" key={control.key}>
          <div className="setting-label"><label htmlFor={`setting-${control.key}`}>{control.label}</label><span>{control.unit}</span></div>
          <div className="setting-inputs">
            <input type="range" aria-label={`${control.label} slider`} min={control.min} max={Math.max(control.max, values[control.key])} step={control.step} value={values[control.key]} onChange={(event) => { setEdits((previous) => ({ ...previous, [control.key]: Number(event.target.value) })); setApplied(false); }} />
            <input type="number" id={`setting-${control.key}`} min={control.min} max={Math.max(control.max, settings[control.key])} step="any" value={values[control.key]} onChange={(event) => { setEdits((previous) => ({ ...previous, [control.key]: Number(event.target.value) })); setApplied(false); }} />
          </div>
        </div>)}</div>
      </fieldset>
      {validation && <p className="notice" role="alert">{validation}</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      {!connected && <p className="footnote">Connect to the sensor server to apply settings.</p>}
      <div className="settings-actions"><button type="submit" disabled={!dirty || !!validation || saving || !connected}>{saving ? 'Applying…' : 'Apply settings'}</button><button type="button" disabled={!dirty || saving} onClick={() => { setEdits({}); setApplied(false); }}>Discard edits</button>{applied && !dirty && <span role="status">Settings applied</span>}</div>
    </form>
    <p className="footnote">Timing jitter and send delay must fit inside the sample interval. Accuracy jitter must stay below its baseline so reported accuracy stays positive. The history window affects weighting, historical accuracy comparison, and prediction fits on subsequent readings. Its recency half-life stays at 3 seconds. Changes last until the server restarts.</p>
  </section>;
}

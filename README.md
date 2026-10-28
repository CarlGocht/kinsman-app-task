# Kinsman App

A local location-sensor simulator with a Node.js/TypeScript server and a React/TypeScript browser client. The initial phase establishes a healthy sensor data stream and a working client/server setup.

## Scope

- Simulate a single, precise location sensor with small measurement jitter and arrow-key-controlled movement.
- Generate one measurement per second initially.
- Stream measurements to the browser over WebSocket.
- Show live measurements and recent sample history in a dashboard.
- Run the server in a terminal and the client as a webpage on localhost.
- Keep recent history in memory.

Deployment setup, fault injection, and fault detection are deferred until the healthy stream and client/server setup work.

## Components

### Simulator server

Use Node.js and TypeScript to generate stationary or moving sensor measurements from server-owned ground truth. Each measurement includes position, velocity, accuracy, timestamps, and identifiers. The server accepts browser WebSocket connections and reports connection and simulation status.

### WebSocket stream

Send sensor measurements from the server to the client. Keep sensor messages separate from connection and simulation status messages. Define shared TypeScript message types so both components use the same contract.

### Browser client

Use React and TypeScript to display connection status, current coordinates, velocity, accuracy, timestamps, identifiers, and recent sample history.

## API and settings

- **WebSocket `/ws`:** stream raw sensor measurements at the configured sample interval, independent ground-truth `motion` snapshots every 50 ms (20 Hz), and simulation status messages to connected clients.
- **HTTP `GET /api/settings`:** return the effective settings currently used by the running simulator, so the client can display them for debugging.
- **Central configuration:** define `sampleIntervalMs` with a default of `1000` (one sample per second), plus `sensorId`, the fixed base coordinates, nominal `accuracyMeters`, a random seed, and the jitter limits below. Allow startup configuration overrides so changing the interval does not require editing the sampling loop. Validate settings before starting.
- **Client settings display:** fetch settings on connection and reconnection, and provide a refresh action to retrieve the current values. The sampling loop and settings endpoint must use the same configuration source.

Settings are read-only through the API initially; runtime editing can be added later. Expose the effective random seed and all jitter settings through the settings endpoint for debugging.

## Simulation and randomness

Start stationary at one configurable base location. Movement commands update the server-owned ground truth using elapsed monotonic time, independently of sampling frequency. Add small, bounded noise around that current position so measurement noise never accumulates into drift.

Use a seeded pseudorandom generator for simulation noise. Generate a seed at startup unless one is supplied, and expose it in settings so a run can be reproduced. Keep UUID generation separate. With the same seed, configuration, movement command timing, and controlled clock, tests should reproduce the same measurements and schedule.

Initial defaults (configurable):

| Value | Randomness |
| --- | --- |
| Position | Uniformly sample an offset within a disk of radius `0.01` meters around the current ground-truth location. Convert local east/north offsets to latitude/longitude with longitude scaled for latitude. |
| `accuracyMeters` | Uniform variation of `±0.005` meters around the nominal `0.02` meters (reported range `0.015–0.025`). This is a simulated uncertainty estimate, separate from the position noise radius. |
| Speed | While stationary: uniform apparent speed from `0` to `0.005` m/s. While moving: actual commanded speed plus uniform `±0.005` m/s noise, clamped to nonnegative values. |
| Heading | Small circular jitter of `±2` degrees around the current direction of motion (initially `0`, retained after stopping), normalized to `[0, 360)`. At rest this is only a synthetic reading, not a meaningful direction of travel. |
| Sample timing | Add uniform `±10` milliseconds to the configured sample interval, initially `1000` milliseconds. |
| Send timing | Add a uniform processing delay of `0–5` milliseconds after measurement generation, then transmit. |
| IDs | No injected jitter: fixed `sensorId`, increasing `sequentialId`, and a fresh UUID per measurement. |

Record `timeAtSample` and `timeAtSend` from the actual clock at measurement generation and transmission. Timing jitter comes from scheduling, rather than altering timestamps; send time must not precede sample time. Operating-system scheduling may add extra delay beyond the configured jitter.

Sample noise once per measurement and broadcast that measurement to all clients. Validate configuration so intervals remain positive, accuracy stays positive, and timing settings cannot overlap successive sampling cycles. Larger noise and faults remain future work.

## Server tests

Use [Vitest](https://vitest.dev/guide/) in the Node environment for unit and integration tests. Use [fake timers](https://vitest.dev/guide/mocking/timers) and a controlled clock for deterministic timing tests, plus real local HTTP and WebSocket connections on temporary ports for integration tests.

Tests cover:

- **Configuration:** defaults, startup overrides, and rejection of invalid settings such as a zero or negative sample interval.
- **Measurement contract:** required fields, valid coordinates, centimeter-scale accuracy, velocity units, and valid timestamps with sample time no later than send time.
- **Identifiers:** stable sensor ID, unique measurement UUIDs, and sequential IDs increasing from `1`.
- **Stationary noise and timing:** repeatable results with a fixed seed and clock; positions remain within the configured radius without drift; accuracy, speed, and heading stay within their bounds; sample and send timing follow configured jitter. Verify both default and overridden intervals and reject invalid jitter settings.
- **Settings endpoint:** successful JSON response containing the effective configuration, including overridden values matching the simulator's behavior.
- **WebSocket delivery:** valid serialized samples arriving in order, multiple clients receiving the same measurement IDs, and a disconnected client not interrupting other clients.
- **Movement:** cardinal and diagonal directions, constant total speed, turning/stopping at command times, lease refresh/expiry, input validation, and streamed positions/velocity.
- **Avatar timing:** independent motion streaming with a slow sample interval, frame projection between readings, stopped states, and lease-limited extrapolation.
- **Lifecycle:** clean shutdown closes connections and stops sampling timers.

These tests cover normal server behavior only; sensor fault injection and detection remain deferred.

## Measurement format

Measurements use the following shared TypeScript contract (`shared/protocol.ts`):

```ts
{
  sensorId: string;
  uniqueId: string;
  sequentialId: number;
  latitude: number;
  longitude: number;
  timeAtSample: string;
  timeAtSend: string;
  accuracyMeters: number;
  velocityData: {
    speedMetersPerSecond: number;
    headingDegrees: number;
  };
}
```

| Field | Convention |
| --- | --- |
| `sensorId` | Fixed identifier for the app's single sensor. |
| `uniqueId` | UUID identifying a measurement. Any later retransmission of that measurement retains this ID, allowing duplicate sends to be identified in a future phase. |
| `sequentialId` | Increases for each new measurement, starting at `1` when the server starts. |
| `latitude`, `longitude` | Coordinates in decimal degrees, retaining sufficient precision for centimeter-scale movement. |
| `timeAtSample` | UTC ISO 8601 timestamp for when the measurement was generated. |
| `timeAtSend` | UTC ISO 8601 timestamp for each transmission of the measurement. |
| `accuracyMeters` | Estimated horizontal accuracy expressed in meters, at centimeter scale. Start with a nominal `0.02` (two centimeters), with the small jitter described above. |
| `velocityData.speedMetersPerSecond` | Speed in meters per second. |
| `velocityData.headingDegrees` | Heading in degrees clockwise from north; a synthetic noisy reading while stationary. |

The client can also record its local receive time separately from the transmitted measurement.

## Implementation plan

1. **Project setup:** establish the Node.js/TypeScript server, React/TypeScript client, shared message types, and the server test framework.
2. **Healthy simulator:** generate stationary or controlled moving measurements around ground truth at approximately one sample per second, with seeded, bounded jitter and measurement metadata.
3. **API setup:** stream measurements over WebSocket, report connection and simulation status, and expose current settings through HTTP.
4. **Client dashboard:** show current measurement details, current settings, and recent sample history.
5. **Local workflow:** document commands to start both components and verify continuous delivery of measurements.

## Getting started

```sh
git clone https://github.com/CarlGocht/kinsman-app-task.git kinsman-app
cd kinsman-app
```

The server and basic React client are implemented. Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

In a second terminal, start the browser client:

```sh
npm run dev:client
```

Open [the sensor monitor](http://127.0.0.1:5173/). It displays an OpenStreetMap view with a dot at the latest received sensor coordinates, all effective settings, the latest full measurement payload, and a rolling table of the most recent 50 samples. Settings load initially and whenever the stream reconnects; use **Refresh settings** to fetch them manually. The client automatically retries disconnected streams every two seconds and starts a fresh history after reconnecting. Last received data remains visible while disconnected.

The map uses Leaflet and OpenStreetMap tiles with visible attribution. Map tiles require an internet connection; the sensor stream remains local. The avatar animates independently while raw dots update on sensor samples, without resetting manual pan/zoom; **Center on sensor** returns to the latest position. While disconnected, the last received position is retained and labeled. Centimeter-scale jitter is not visibly distinguishable at street-map zoom.

The Vite development server proxies `/api` and `/ws` to the sensor server. If you change its port, set the proxy target when starting the client, for example `SENSOR_SERVER_URL=http://127.0.0.1:4001 npm run dev:client`. The client runs locally without a deployment setup.

The server binds to `127.0.0.1:3001`. Stop it with Ctrl+C. It samples continuously while running, including when no clients are connected; a new connection receives future samples, without replaying history.

```sh
curl http://127.0.0.1:3001/api/settings
```

To inspect the stream, open a browser's developer console:

```js
const sensor = new WebSocket('ws://127.0.0.1:3001/ws');
sensor.onmessage = (event) => console.log(JSON.parse(event.data));
// When finished:
// sensor.close();
```

WebSocket messages are JSON envelopes: `{ type: "measurement", data: measurement }`, `{ type: "motion", data: movementState }`, or `{ type: "status", data: { simulation: "running", connectedClients: 1 } }`. Motion snapshots are simulation ground truth for visualization, not sensor measurements; they do not consume sample IDs or add to raw history. Status messages are sent on connection and disconnection. Settings are read-only; movement controls are described below. The API supports cross-origin local browser requests, including JSON preflight requests.

### Movement API and map controls

Click the map or Tab to focus it, then hold arrow keys: up is north, right is east, down is south, and left is west. Movement defaults to 20 m/s, giving approximately 20 meters between raw samples at the default one-second interval. Combinations move diagonally at the same total speed. Opposing keys cancel. Leaflet arrow-key panning is disabled; dragging and zoom controls still work. Commands refresh every 200 ms while held and stop on key release, map/window focus loss, tab hiding, or client unmount. The server stops after the command timeout if refreshes cease. When overriding the timeout, keep it comfortably above the 200 ms refresh interval.

- **`POST /api/movement`** accepts JSON `{ "north": 1, "east": 0 }`. Both components must be finite numbers in `[-1, 1]`; the server normalizes nonzero vectors and uses the configured movement speed. `{ "north": 0, "east": 0 }` stops immediately.
- **`GET /api/movement`** returns current ground-truth motion and position. POST returns the same state after applying the command: `latitude`, `longitude`, normalized `north`/`east`, `speedMetersPerSecond`, `headingDegrees`, and remaining `expiresInMs`.
- Malformed commands return 400, oversized bodies return 413 (1 KiB limit), and non-JSON bodies return 415. Unsupported methods return 405.

There is one shared sensor: the latest accepted command from any client wins. Movement is integrated up to each command, sample, or state read; command expiry is honored even if it falls between samples. Releasing a key stops ground truth immediately, while the next scheduled measurement reports the change. Very short movements between samples may only appear as displacement in the next sample.

The taller map separates the green live avatar from blue raw sensor points. The avatar and its travel-direction arrow follow server ground truth independently of the sensor sample interval, rendered with `requestAnimationFrame` and projected between 20 Hz motion snapshots. Projection is capped at the command lease, and the avatar is removed while disconnected. The raw points and chronological line update only on sensor measurements; history is limited to the current connection's last 50 samples and is cleared on reconnect. Manual panning/zooming is preserved; use **Center on sensor** to return to the current location.

### Startup configuration

Set environment variables before starting the server; `.env` files are not loaded automatically. All effective sensor settings, including the generated or supplied seed, are returned by `GET /api/settings`.

```sh
SAMPLE_INTERVAL_MS=250 SEED=42 npm run dev
```

| Environment variable | Default |
| --- | --- |
| `PORT` | `3001` (`0` chooses an available port) |
| `SENSOR_ID` | `sensor-1` |
| `SEED` | Random unsigned 32-bit integer |
| `LATITUDE` | `43.61811797437582` |
| `LONGITUDE` | `-72.20972127777227` |
| `SAMPLE_INTERVAL_MS` | `1000` |
| `SAMPLE_JITTER_MS` | `10` |
| `SEND_DELAY_MAX_MS` | `5` |
| `POSITION_RADIUS_METERS` | `0.01` |
| `ACCURACY_METERS` | `0.02` |
| `ACCURACY_JITTER_METERS` | `0.005` |
| `SPEED_MAX_METERS_PER_SECOND` | `0.005` |
| `HEADING_JITTER_DEGREES` | `2` |
| `MOVEMENT_SPEED_METERS_PER_SECOND` | `20` |
| `MOVEMENT_TIMEOUT_MS` | `1000` |

Invalid configuration fails at startup with an error. Timing settings must leave at least one millisecond between samples and keep the maximum send delay below the minimum sample interval. Accuracy must remain positive. The local coordinate approximation supports base latitudes strictly between -89 and 89 degrees and position radii up to 1000 meters; longitudes wrap at the date line. Heading jitter is limited to 180 degrees. Movement speed must be greater than zero and no more than 100 m/s; command timeout must be between 250 and 10000 ms. Reproducing a seed reproduces noise and requested delays, but real clock timestamps and UUIDs differ between runs.

### Checks and compiled execution

```sh
npm test                 # Unit tests and local HTTP/WebSocket integration tests
npm run test:watch       # Watch tests during development
npm run typecheck        # Check server, client, shared, and test types
npm run build            # Build server, shared types, and browser client into dist/
npm run build:server     # Compile only the server
npm run build:client     # Bundle only the browser client into dist/client/
npm start                # Run the compiled server
```

`npm start` runs the compiled sensor server; use `npm run dev:client` to serve the local browser UI. SIGINT and SIGTERM stop sampling and close active connections. Slow WebSocket consumers exceeding a 1 MiB send buffer are disconnected to bound memory use.

## Development

Keep secrets in local environment files, which are ignored by Git.

## Velocity interpretation

The server always reports numeric raw speed and heading. Stationary speed retains small noise; stationary heading retains the last direction (initially north) with jitter and has no meaningful travel interpretation. The live avatar arrow uses simulation movement direction and disappears when ground truth stops; the raw payload and table continue showing noisy sensor readings unchanged. A future model may derive speed and heading noise from east/north velocity components.

## Client weighted position

The comparison table highlights one current **Weighted** position above the unchanged raw measurements. It uses every distinct measurement in the latest three seconds of `timeAtSample` from the current connection, using whatever is available while warming up. The window is `(newest sample timestamp - 3000 ms, newest sample timestamp]`, so a point exactly three seconds old is excluded. It is anchored to the greatest sample timestamp seen, not arrival order, send time, or the browser clock. Late arrivals within that window contribute; older arrivals are ignored without moving the window backward. Duplicate unique IDs count once. Invalid sample timestamps are ignored. The source sequence IDs and normalized weight percentages are shown with the window end timestamp. Reconnection resets the window along with raw history. A separate time-pruned buffer retains all samples in the window even when the rate exceeds the 50-row raw display limit. The table shows the contributing sample count and up to eight source IDs/percentages. The window remains at the last known sample time if the stream pauses; it does not imply freshness relative to wall-clock time.

Weights are inverse-square reported accuracy: `w = 1 / accuracyMeters²`, normalized to sum to one. Thus 1 cm accuracy has four times the influence of 2 cm accuracy. The client averages local latitude/longitude offsets, handling longitude wrap at the date line. This is a local position smoother; it does not extrapolate old positions forward during motion. The live ground-truth avatar and raw map markers remain separate from this table estimate.

The weighted row's **model accuracy** is `sqrt(1 / sum(1 / accuracyMeters²))`. It assumes independent errors about the same true position and treats reported accuracy as an uncertainty scale. The simulator does not guarantee that statistical model, and movement can introduce lag, so this value is not a guarantee of actual accuracy. Speed and heading are not fused and are shown as dashes in the weighted row. Invalid/nonpositive accuracies or invalid coordinates within the window make the estimate unavailable rather than producing invalid arithmetic.

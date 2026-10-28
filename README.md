# Kinsman App

A local location-sensor simulator with a Node.js/TypeScript server and a React/TypeScript browser client. The initial phase establishes a healthy sensor data stream and a working client/server setup.

## Scope

- Simulate a single, precise location sensor at a fixed location with small measurement jitter. Movement is deferred.
- Generate one measurement per second initially.
- Stream measurements to the browser over WebSocket.
- Show live measurements and recent sample history in a dashboard.
- Run the server in a terminal and the client as a webpage on localhost.
- Keep recent history in memory.

Deployment setup, fault injection, and fault detection are deferred until the healthy stream and client/server setup work.

## Components

### Simulator server

Use Node.js and TypeScript to generate stationary sensor measurements. Each measurement includes position, velocity, accuracy, timestamps, and identifiers. The server accepts browser WebSocket connections and reports connection and simulation status.

### WebSocket stream

Send sensor measurements from the server to the client. Keep sensor messages separate from connection and simulation status messages. Define shared TypeScript message types so both components use the same contract.

### Browser client

Use React and TypeScript to display connection status, current coordinates, velocity, accuracy, timestamps, identifiers, and recent sample history.

## API and settings

- **WebSocket `/ws`:** stream sensor measurements and separate simulation status messages to connected clients.
- **HTTP `GET /api/settings`:** return the effective settings currently used by the running simulator, so the client can display them for debugging.
- **Central configuration:** define `sampleIntervalMs` with a default of `1000` (one sample per second), plus `sensorId`, the fixed base coordinates, nominal `accuracyMeters`, a random seed, and the jitter limits below. Allow startup configuration overrides so changing the interval does not require editing the sampling loop. Validate settings before starting.
- **Client settings display:** fetch settings on connection and reconnection, and provide a refresh action to retrieve the current values. The sampling loop and settings endpoint must use the same configuration source.

Settings are read-only through the API initially; runtime editing can be added later. Expose the effective random seed and all jitter settings through the settings endpoint for debugging.

## Stationary simulation and randomness

Start at one configurable base location with no true movement. Add small, bounded noise to the reported measurements; generate every position relative to the base location so noise never accumulates into drift.

Use a seeded pseudorandom generator for simulation noise. Generate a seed at startup unless one is supplied, and expose it in settings so a run can be reproduced. Keep UUID generation separate. With the same seed, configuration, and controlled clock, tests should reproduce the same measurements and schedule.

Initial defaults (configurable):

| Value | Randomness |
| --- | --- |
| Position | Uniformly sample an offset within a disk of radius `0.01` meters around the base location. Convert local east/north offsets to latitude/longitude with longitude scaled for latitude. |
| `accuracyMeters` | Uniform variation of `±0.005` meters around the nominal `0.02` meters (reported range `0.015–0.025`). This is a simulated uncertainty estimate, separate from the position noise radius. |
| Speed | Uniform apparent speed between `0` and `0.005` meters per second, representing small stationary measurement noise. |
| Heading | Small circular jitter of `±2` degrees around a fixed nominal heading of `0`, normalized to `[0, 360)`. At rest this is only a synthetic reading, not a meaningful direction of travel. |
| Sample timing | Add uniform `±10` milliseconds to the configured sample interval, initially `1000` milliseconds. |
| Send timing | Add a uniform processing delay of `0–5` milliseconds after measurement generation, then transmit. |
| IDs | No injected jitter: fixed `sensorId`, increasing `sequentialId`, and a fresh UUID per measurement. |

Record `timeAtSample` and `timeAtSend` from the actual clock at measurement generation and transmission. Timing jitter comes from scheduling, rather than altering timestamps; send time must not precede sample time. Operating-system scheduling may add extra delay beyond the configured jitter.

Sample noise once per measurement and broadcast that measurement to all clients. Validate configuration so intervals remain positive, accuracy stays positive, and timing settings cannot overlap successive sampling cycles. Larger noise, movement, and faults remain future work.

## Server testing plan

Use [Vitest](https://vitest.dev/guide/) in the Node environment for unit and integration tests. Use [fake timers](https://vitest.dev/guide/mocking/timers) and a controlled clock for deterministic timing tests, plus real local HTTP and WebSocket connections on temporary ports for integration tests.

Initial tests will cover:

- **Configuration:** defaults, startup overrides, and rejection of invalid settings such as a zero or negative sample interval.
- **Measurement contract:** required fields, valid coordinates, centimeter-scale accuracy, velocity units, and valid timestamps with sample time no later than send time.
- **Identifiers:** stable sensor ID, unique measurement UUIDs, and sequential IDs increasing from `1`.
- **Stationary noise and timing:** repeatable results with a fixed seed and clock; positions remain within the configured radius without drift; accuracy, speed, and heading stay within their bounds; sample and send timing follow configured jitter. Verify both default and overridden intervals and reject invalid jitter settings.
- **Settings endpoint:** successful JSON response containing the effective configuration, including overridden values matching the simulator's behavior.
- **WebSocket delivery:** valid serialized samples arriving in order, multiple clients receiving the same measurement IDs, and a disconnected client not interrupting other clients.
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
2. **Healthy simulator:** generate stationary measurements around one base location at approximately one sample per second, with seeded, bounded jitter and measurement metadata.
3. **API setup:** stream measurements over WebSocket, report connection and simulation status, and expose current settings through HTTP.
4. **Client dashboard:** show current measurement details, current settings, and recent sample history.
5. **Local workflow:** document commands to start both components and verify continuous delivery of measurements.

## Getting started

```sh
git clone https://github.com/CarlGocht/kinsman-app-task.git kinsman-app
cd kinsman-app
```

The server is implemented; the React client remains planned. Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

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

WebSocket messages are JSON envelopes: `{ type: "measurement", data: measurement }` or `{ type: "status", data: { simulation: "running", connectedClients: 1 } }`. Status messages are sent on connection and disconnection. The API is read-only and requires no client commands. The settings endpoint permits cross-origin browser reads for the future local React client.

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
| `LATITUDE` | `40.7128` |
| `LONGITUDE` | `-74.006` |
| `SAMPLE_INTERVAL_MS` | `1000` |
| `SAMPLE_JITTER_MS` | `10` |
| `SEND_DELAY_MAX_MS` | `5` |
| `POSITION_RADIUS_METERS` | `0.01` |
| `ACCURACY_METERS` | `0.02` |
| `ACCURACY_JITTER_METERS` | `0.005` |
| `SPEED_MAX_METERS_PER_SECOND` | `0.005` |
| `HEADING_JITTER_DEGREES` | `2` |

Invalid configuration fails at startup with an error. Timing settings must leave at least one millisecond between samples and keep the maximum send delay below the minimum sample interval. Accuracy must remain positive. The local coordinate approximation supports base latitudes strictly between -89 and 89 degrees and position radii up to 1000 meters; longitudes wrap at the date line. Heading jitter is limited to 180 degrees. Reproducing a seed reproduces noise and requested delays, but real clock timestamps and UUIDs differ between runs.

### Checks and compiled execution

```sh
npm test                 # Unit tests and local HTTP/WebSocket integration tests
npm run test:watch       # Watch tests during development
npm run typecheck        # Check application and test types
npm run build            # Compile server and shared types into dist/
npm start                # Run the compiled server
```

SIGINT and SIGTERM stop sampling and close active connections. Slow WebSocket consumers exceeding a 1 MiB send buffer are disconnected to bound memory use.

## Development

Keep secrets in local environment files, which are ignored by Git.

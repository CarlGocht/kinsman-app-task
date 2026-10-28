# Kinsman App

A local location-sensor simulator with a Node.js/TypeScript server and a React/TypeScript browser client. The initial phase establishes a healthy sensor data stream and a working client/server setup.

## Scope

- Simulate a single, precise location sensor following a repeatable route.
- Generate one measurement per second initially.
- Stream measurements to the browser over WebSocket.
- Show live measurements and recent sample history in a dashboard.
- Run the server in a terminal and the client as a webpage on localhost.
- Keep recent history in memory.

Deployment setup, fault injection, and fault detection are deferred until the healthy stream and client/server setup work.

## Components

### Simulator server

Use Node.js and TypeScript to generate the route and sensor measurements. Each measurement includes position, velocity, accuracy, timestamps, and identifiers. The server accepts browser WebSocket connections and reports connection and simulation status.

### WebSocket stream

Send sensor measurements from the server to the client. Keep sensor messages separate from connection and simulation status messages. Define shared TypeScript message types so both components use the same contract.

### Browser client

Use React and TypeScript to display connection status, current coordinates, velocity, accuracy, timestamps, identifiers, and recent sample history.

## Planned API and settings

- **WebSocket `/ws`:** stream sensor measurements and separate simulation status messages to connected clients.
- **HTTP `GET /api/settings`:** return the effective settings currently used by the running simulator, so the client can display them for debugging.
- **Central configuration:** define `sampleIntervalMs` with a default of `1000` (one sample per second), plus `sensorId` and `accuracyMeters`. Allow startup configuration overrides so changing the interval does not require editing the sampling loop. Validate settings before starting.
- **Client settings display:** fetch settings on connection and reconnection, and provide a refresh action to retrieve the current values. The sampling loop and settings endpoint must use the same configuration source.

Settings are read-only through the API initially; runtime editing can be added later. Use elapsed sample time when calculating route movement and velocity so changing the sample interval preserves the simulated speed.

## Server testing plan

Use [Vitest](https://vitest.dev/guide/) in the Node environment for unit and integration tests. Use [fake timers](https://vitest.dev/guide/mocking/timers) and a controlled clock for deterministic timing tests, plus real local HTTP and WebSocket connections on temporary ports for integration tests.

Initial tests will cover:

- **Configuration:** defaults, startup overrides, and rejection of invalid settings such as a zero or negative sample interval.
- **Measurement contract:** required fields, valid coordinates, centimeter-scale accuracy, velocity units, and valid timestamps with sample time no later than send time.
- **Identifiers:** stable sensor ID, unique measurement UUIDs, and sequential IDs increasing from `1`.
- **Route and timing:** repeatable movement, default and overridden sample intervals, and consistent speed when the interval changes.
- **Settings endpoint:** successful JSON response containing the effective configuration, including overridden values matching the simulator's behavior.
- **WebSocket delivery:** valid serialized samples arriving in order, multiple clients receiving the same measurement IDs, and a disconnected client not interrupting other clients.
- **Lifecycle:** clean shutdown closes connections and stops sampling timers.

These tests cover normal server behavior only; sensor fault injection and detection remain deferred.

## Planned measurement format

The following is the planned data contract, not an implemented API:

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
| `accuracyMeters` | Estimated horizontal accuracy expressed in meters, at centimeter scale. Start with a constant `0.02` (two centimeters). |
| `velocityData.speedMetersPerSecond` | Speed in meters per second. |
| `velocityData.headingDegrees` | Direction of travel in degrees clockwise from north. |

The client can also record its local receive time separately from the transmitted measurement.

## Implementation plan

1. **Project setup:** establish the Node.js/TypeScript server, React/TypeScript client, shared message types, and the server test framework.
2. **Healthy simulator:** generate one repeatable route at one sample per second, including position, velocity, and measurement metadata.
3. **API setup:** stream measurements over WebSocket, report connection and simulation status, and expose current settings through HTTP.
4. **Client dashboard:** show current measurement details, current settings, and recent sample history.
5. **Local workflow:** document commands to start both components and verify continuous delivery of measurements.

## Getting started

```sh
git clone https://github.com/CarlGocht/kinsman-app-task.git kinsman-app
cd kinsman-app
```

Application installation, development, and testing commands will be documented as implementation begins. No application code has been added yet.

## Development

Keep secrets in local environment files, which are ignored by Git.

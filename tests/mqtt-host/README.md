# MQTT host checks

These checks compile the bundled production ESP-MQTT source in `src/firmware/components/mqtt`. A POSIX adapter supplies FreeRTOS task/queue/event primitives, real TCP sockets, and verified OpenSSL TLS. Mosquitto and scripted protocol brokers listen only on `127.0.0.1`. Temporary configuration, certificates, and test credentials stay under `.artifacts/mqtt/`.

Prerequisites are installed ESP-IDF 5.4.4 sources, a C compiler, OpenSSL 3, and local Mosquitto 2.x executables. The checks do not download dependencies, modify the installed SDK, open a browser, or flash hardware.

```sh
export CLEX_TEST_IDF_ROOT=/path/to/esp-idf
export CLEX_TEST_MOSQUITTO=/path/to/mosquitto
export CLEX_TEST_MOSQUITTO_PASSWD=/path/to/mosquitto_passwd

node tests/mqtt-host/check.mjs
node tests/mqtt-host/runtime.mjs
node tests/mqtt-host/tls-runtime.mjs
node tests/mqtt-host/session-runtime.mjs
node tests/mqtt-host/session-runtime.mjs --overflow
node tests/mqtt-host/pressure-runtime.mjs
node tests/mqtt-host/pressure-runtime.mjs --311
node tests/mqtt-host/receive-duplicate.mjs
```

Optional `CLEX_TEST_OPENSSL_ROOT` and `CLEX_TEST_OPENSSL` select the OpenSSL library root and executable. Defaults use Homebrew OpenSSL 3. `CLEX_TEST_MQTT_ROOT` overrides the source directory for upstream comparison; normal checks use the bundled component.

- `check.mjs` exercises the real MQTT 3.1.1 and 5.0 engine: QoS 0/1/2, binary messages, wildcards and multiple subscriptions, unsubscribe, retained messages, persistent sessions, LWT, multiple clients, broker loss/reconnect, authentication failures, MQTT 5 properties, verified TLS, and certificate/hostname rejection. A scripted broker checks negative PUBREC, inflight/outbox cleanup, and explicit zero properties on the wire. Its engine reconnect scenario subscribes again explicitly.
- `runtime.mjs` generates C through `mqttFirmware` and tests the CLEX runtime with the same engine and a real broker. It covers automatic connections without a control node, shared filter ownership, automatic subscription restoration, multiple clients, manual disconnect races during startup/handshake, selected-link loss and router WAN changes, binary conversion, fragmented payloads, MQTT 5 properties, and failure events. Graph callbacks must run on the polling thread; initialization callbacks are deferred until all client state is ready.
- `tls-runtime.mjs` tests generated TLS configuration using a temporary private CA: a valid certificate, wrong CA, hostname mismatch, and QoS 2 delivery. A controlled host clock exercises the bounded synchronization wait and recovery after a valid clock becomes available.
- `session-runtime.mjs` holds PUBREC or PUBCOMP while the generated runtime changes WAN interfaces. MQTT 3.1.1 and 5.0 must retain the SDK client, packet identifier, outbox and pending result, resume with the correct PUBLISH/PUBREL exchange, and finish once. `--overflow` injects an event-queue failure and checks the recovery handshake: a temporary clean connection with zero expiry and no LWT, followed by the configured persistent connection. The temporary connection must not emit a connected event to the graph.
- `pressure-runtime.mjs` retains four independent 4096-byte payloads as hex and replaces them repeatedly within the 64 KiB runtime pool. It also injects a real allocation shortage, checks explicit diagnostics and released views, then verifies delivery of the following message. The packet rejected during injected exhaustion is not treated as delivered.
- `receive-duplicate.mjs` checks fragmented incoming QoS 2 DUP packets before PUBREL and across persistent reconnects, idempotent duplicate PUBREL acknowledgements, packet identifier reuse, clearing state for a new broker session, and an explicit protocol error when the bounded receive table is exhausted.

These are host integration checks. Board netif readiness, factory MAC, and SNTP are represented by host platform shims. Embedded mbedTLS, board networking, resource use on hardware, and actual flashing require separate device validation.

# ESP-MQTT component

Source: Espressif ESP-MQTT v1.1.0, https://github.com/espressif/esp-mqtt/tree/v1.1.0

Upstream archive SHA-256: `e91f210a2110586e2b8afe9bd0202fd2bd04639e6e676a2e1cedd28f170a7c63`.
License: Apache-2.0; see LICENSE. Only the component source, build files, public headers, and license are included.

Local changes:

- Incoming QoS 2 packet IDs are retained through PUBREL and persistent reconnects in a bounded 32-entry table. Duplicate PUBLISH packets are fully consumed and acknowledged without repeating DATA callbacks; duplicate PUBREL is acknowledged idempotently. A new broker session clears the table. Exceeding the receive capacity reports MQTT_ERROR_TYPE_PROTOCOL/reason 0x93 and closes the connection. See [MQTT 5 section 4.3.3](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html).
- MQTT 5 negative PUBREC completes the failed publish, reports its reason code through MQTT_EVENT_PUBLISHED, removes the outbox entry, and releases the inflight slot without sending PUBREL. This follows MQTT 5 section 4.3.3.
- `clex_mqtt_client_set_network_interface` changes the interface of a stopped or disconnected client while preserving its outbox and MQTT session state. The closed transport is destroyed before replacing its retained interface pointer; a running handshake or connection is rejected. Allocation failure leaves the original configuration intact.
- Publish properties expose `payload_format_indicator_set` and `message_expiry_interval_set` flags to distinguish an explicit zero from an omitted property. Existing nonzero values retain upstream serialization behavior.

The component is bundled into generated MQTT firmware projects. It does not modify an installed ESP-IDF SDK. Host transport checks compile the same source.

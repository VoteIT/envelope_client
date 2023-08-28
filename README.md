# Envelopener

WebSocket wrapper, providing client support for the Envelope backend (VoteIT project).

## Main features

- Wraps WebSocket connection, providing events for connection status.
- Allows automatic and manual connection modes.
- Provides support for Envelope request-response type messages.
- Handles subscription to channels.
- Allows registering type listeners for namespaced messages.
- Automatically unwraps Envelope `app_state` and `batch` messages into individual messages.
- Adds support for heartbeat callbacks, triggered when no messages has been sent or received for a defined time. (incoming, outgoing or any)

## Upcoming features

- Allow listing available message types with description and schema.

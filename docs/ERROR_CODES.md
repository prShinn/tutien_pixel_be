# Error codes

- `INVALID_CREDENTIALS`: credentials fail validation or login.
- `USERNAME_TAKEN`: username already exists.
- `UNAUTHORIZED`: missing or invalid access token.
- `PLAYER_NOT_FOUND`: account has no player.
- `PLAYER_EXISTS`: account already has a player.
- `ITEM_NOT_FOUND`: item is absent from server catalog.
- `INSUFFICIENT_FUNDS`: wallet cannot pay the server-side price.
- `INVALID_REQUEST_ID`: mutation idempotency key is missing or malformed.
- `INVALID_COMMAND` / `INVALID_PAYLOAD`: socket command contract failure.

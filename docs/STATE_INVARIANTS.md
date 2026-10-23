# State invariants

- Client input is intent only; wallet price, item definition, player owner and coordinates are server-owned.
- A user can own at most one player in the current vertical slice.
- A shop buy must have a valid `requestId`; replaying the same `userId + requestId` returns the original result and does not debit twice.
- Wallet balance cannot become negative.
- Password hashes never appear in HTTP or socket responses.
- MySQL/InnoDB is the source of truth for account, player, wallet, inventory, ledger and idempotency records.

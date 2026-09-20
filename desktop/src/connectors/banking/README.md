# CashPatch Banking Connector

Banking is strictly account-information-only.

The connector interface intentionally exposes only:
- accounts
- balances
- transactions

There are no payment, transfer, beneficiary, direct-debit, card-control, refund or payout methods.

## MVP provider

The preferred first implementation is GoCardless Bank Account Data because it exposes PSD2 account information across the EEA.

Provider application secrets must remain server-side. The desktop must never receive the CashPatch provider secret.

Target flow:

1. Desktop asks user to connect a bank.
2. CashPatch cloud creates the bank authorization/requisition.
3. Browser opens the provider/bank authorization flow.
4. User authenticates directly with the bank/provider.
5. Desktop receives only a CashPatch-scoped connection identifier.
6. Bank data is fetched on behalf of that connection and returned to the local client for analysis.
7. Raw transactions are not persisted in CashPatch cloud by default.

The local banking engine then correlates bank transactions with invoices, Stripe payouts, CRM promises and email findings.

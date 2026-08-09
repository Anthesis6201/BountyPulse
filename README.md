# BountyPulse — Decentralized Micro-Bounty & Escrow

A Web3 DApp built for the assignment brief (`DApp_Su26.pdf`): Foundry/Solidity smart
contract on Anvil + a vanilla HTML/JS frontend using Ethers.js v6, with Pinata IPFS
for off-chain storage.

```
BountyPulse/
├── src/BountyPulse.sol         # the contract (Part A)
├── test/BountyPulse.t.sol      # Foundry test suite
├── script/Deploy.s.sol         # deployment script for local Anvil
├── foundry.toml
└── frontend/                   # the DApp (Part B)
    ├── index.html
    ├── css/style.css
    └── js/
        ├── contractConfig.js   # <-- put your deployed address + ABI + Pinata JWT here
        ├── ipfsHelper.js       # two-step Pinata pinning pipeline
        └── app.js              # wallet, dashboards, contract calls, live sync
```

## ⚠️ Before you rely on this for your Viva

Grading note straight from the brief: *"The implementation code is only worth 4.0
marks. The remaining 8.5 marks belong to the Viva. If you rely on AI to write your
logic without understanding the underlying logic, state changes, and Web3
architecture, you will fail the Viva."*

Read `src/BountyPulse.sol` line by line before your viva. Be ready to explain, from
memory, without looking at the code:
- Why `selectAndFund` is `payable` but `placeBid` is not.
- Why the 98% payout goes into `withdrawableBalance` instead of being sent directly
  (the pull-payment pattern, and why it protects against reentrancy / stuck funds if
  a freelancer's wallet can't receive ETH).
- How the 2% fee is computed with integer math (`(amount * 200) / 10000`) and why
  basis points avoid floating point.
- What `storage` vs `memory` mean for `Bounty storage b = bounties[_bountyId];`.
- Why `getAllBounties()` returning an array and sorting client-side in JS is the
  "gas-optimization principle" the brief asks you to demonstrate — sorting on-chain
  would cost gas on every call; a `view` function is free to call and the frontend
  can sort/filter for free.
- Walk through the full lifecycle of a bounty: Open → Locked → Resolved, and the
  Disputed branch, state variable by state variable.

## 1. Environment Setup (Checkpoint 1)

### Install Foundry
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Install dependencies
```bash
cd BountyPulse
forge install foundry-rs/forge-std --no-commit
```

### Run a local Anvil node (terminal 1)
```bash
anvil
```
This prints 10 pre-funded test accounts + private keys. Import at least two of them
into MetaMask (one will act as Client, one as Freelancer). **The account you use to
deploy the contract automatically becomes the Arbiter** (see the constructor).

Add a custom network in MetaMask:
- Network name: `Anvil Local`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`

## 2. Compile, Test & Deploy (Checkpoint 2)

```bash
forge build
forge test -vv
```

Deploy to Anvil (terminal 2, keep Anvil running in terminal 1):
```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --private-key <ANVIL_ACCOUNT_0_PRIVATE_KEY> \
  --broadcast
```
Copy the printed `BountyPulse deployed at: 0x...` address.

## 3. Configure the Frontend

Open `frontend/js/contractConfig.js` and set:
```js
const CONTRACT_ADDRESS = "0x..."; // from the deploy step above
const PINATA_JWT = "..."; // your own Pinata API JWT (Pinata dashboard -> API Keys)
```
The ABI in that file already mirrors `BountyPulse.sol` exactly — regenerate it from
`out/BountyPulse.sol/BountyPulse.json` after `forge build` if you change the contract.

## 4. Run the Frontend (Checkpoints 3–5)

Any static file server works, e.g.:
```bash
cd frontend
python3 -m http.server 5500
# or: npx live-server --port=5500
```
Open `http://localhost:5500`, connect MetaMask (make sure it's on the Anvil network
and unlocked with one of the imported accounts), and register as Client or
Freelancer. Deploy with a second account to test as a different role, and use the
deployer account to act as Arbiter.

### Demoing each checkpoint
- **Checkpoint 3 (IPFS):** Register a user or post a bounty with a real image/file —
  watch the "Pinning… " toast, then the returned CID rendered from
  `https://gateway.pinata.cloud/ipfs/<CID>`.
- **Checkpoint 4 (Feed & Escrow):** As Freelancer, use the "Sort by" dropdown on the
  Open Bounty Feed. As Client, accept a bid to trigger `selectAndFund` (send more
  ETH than the bid to demonstrate the automatic excess refund). As Freelancer/Arbiter,
  use "Claim Funds" to pull your withdrawable balance.
- **Checkpoint 5 (Live sync):** Open two browser windows/profiles with two different
  MetaMask accounts (Client in one, Freelancer in the other). Approve work in the
  Client window and watch the Freelancer window's "Unclaimed Earnings" update without
  a page reload — driven by `contract.on("WorkApproved", ...)` in `app.js`.

## Design notes for the Viva

- **Registry pattern:** `mapping(address => User) public users` is the sole database;
  no off-chain user table exists. `getUser()` is a convenience view wrapper.
- **Two-step IPFS pipeline:** `ipfsHelper.js` does the HTTP POST to Pinata first and
  only passes the resulting CID string into any contract call — no binary data ever
  goes into a transaction, which is what keeps gas costs down (state bloat
  avoidance, per the brief's "Storage Layer" section).
- **Strict payment / refund logic:** `selectAndFund` uses `require(msg.value >=
  _bidAmount, ...)` to hard-revert underpayment, and a `.call{value: excess}("")`
  refund for overpayment, done in the *same* transaction before any state that could
  be reentered.
- **Pull-payment claiming:** `claimFunds()` zeroes the caller's balance *before*
  sending ETH (checks-effects-interactions) and is further guarded by a
  `noReentrant` modifier.
- **Events drive the UI:** every state-changing function emits an event; `app.js`
  subscribes via `contract.on(...)` for each one instead of polling or reloading.

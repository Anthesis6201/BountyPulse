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


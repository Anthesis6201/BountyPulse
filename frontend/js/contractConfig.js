// ---------------------------------------------------------------------
// contractConfig.js
// Fill CONTRACT_ADDRESS with the address printed by your Deploy.s.sol run
// against the local Anvil node. ABI mirrors src/BountyPulse.sol exactly.
// ---------------------------------------------------------------------

const CONTRACT_ADDRESS = "0xYourDeployedContractAddressHere"; // <-- update after `forge script` deploy
const ANVIL_CHAIN_ID = 31337n; // MetaMask must be on this chain (Anvil default)

// Pinata JWT for pinning files/JSON to IPFS. Put your own JWT here for local dev only.
// (In a real deployment this should never live in client-side code as-is.)
const PINATA_JWT = "PASTE_YOUR_PINATA_JWT_HERE";
const PINATA_PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

const CONTRACT_ABI = [
  // --- Registration & views ---
  "function register(string _name, uint8 _role, string _ipfsAvatarHash) external",
  "function users(address) view returns (string name, uint8 role, string ipfsAvatarHash, uint256 reputation, bool registered)",
  "function getUser(address _addr) view returns (tuple(string name, uint8 role, string ipfsAvatarHash, uint256 reputation, bool registered))",

  // --- Bounty lifecycle ---
  "function postBounty(uint256 _maxBudget, string _ipfsBountyDetailsHash) external returns (uint256)",
  "function placeBid(uint256 _bountyId, uint256 _amount) external",
  "function selectAndFund(uint256 _bountyId, address _freelancer, uint256 _bidAmount) external payable",
  "function submitWork(uint256 _bountyId, string _ipfsWorkFileHash) external",
  "function approveWork(uint256 _bountyId) external",
  "function disputeWork(uint256 _bountyId) external",
  "function resolveDispute(uint256 _bountyId, bool _freelancerFault) external",
  "function claimFunds() external",

  // --- Views ---
  "function bountyCount() view returns (uint256)",
  "function arbiter() view returns (address)",
  "function withdrawableBalance(address) view returns (uint256)",
  "function getBounty(uint256 _bountyId) view returns (tuple(uint256 id, address client, uint256 maxBudget, string ipfsBountyDetailsHash, uint8 status, address selectedFreelancer, uint256 agreedAmount, string ipfsWorkFileHash))",
  "function getAllBounties() view returns (tuple(uint256 id, address client, uint256 maxBudget, string ipfsBountyDetailsHash, uint8 status, address selectedFreelancer, uint256 agreedAmount, string ipfsWorkFileHash)[])",
  "function getBids(uint256 _bountyId) view returns (tuple(address freelancer, uint256 amount, bool active)[])",

  // --- Events (used for real-time UI sync via contract.on(...)) ---
  "event UserRegistered(address indexed user, string name, uint8 role, string ipfsAvatarHash)",
  "event BountyPosted(uint256 indexed bountyId, address indexed client, uint256 maxBudget, string ipfsBountyDetailsHash)",
  "event BidPlaced(uint256 indexed bountyId, address indexed freelancer, uint256 amount)",
  "event EscrowFunded(uint256 indexed bountyId, address indexed client, address indexed freelancer, uint256 amount)",
  "event WorkSubmitted(uint256 indexed bountyId, address indexed freelancer, string ipfsWorkFileHash)",
  "event WorkApproved(uint256 indexed bountyId, address indexed freelancer, uint256 payout, uint256 fee)",
  "event FundsClaimed(address indexed user, uint256 amount)",
  "event DisputeRaised(uint256 indexed bountyId, address indexed client)",
  "event DisputeResolved(uint256 indexed bountyId, bool freelancerFault)",
];

// Mirrors `enum Role` / `enum BountyStatus` in the Solidity contract.
const ROLE = { NONE: 0, CLIENT: 1, FREELANCER: 2, ARBITER: 3 };
const ROLE_NAME = ["None", "Client", "Freelancer", "Arbiter"];
const BOUNTY_STATUS_NAME = ["Open", "Locked", "Resolved", "Disputed"];

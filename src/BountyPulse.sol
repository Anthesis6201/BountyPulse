// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BountyPulse - Decentralized Micro-Bounty & Escrow Platform
/// @notice Registry + escrow + reputation logic. Heavy data (avatars, descriptions,
///         work files) lives on IPFS; only the 46-char CIDs are stored on-chain.
contract BountyPulse {
    // ---------------------------------------------------------------------
    // Enums
    // ---------------------------------------------------------------------

    enum Role {
        None,
        Client,
        Freelancer,
        Arbiter
    }

    enum BountyStatus {
        Open,
        Locked,
        Resolved,
        Disputed
    }

    // ---------------------------------------------------------------------
    // Structs
    // ---------------------------------------------------------------------

    struct User {
        string name;
        Role role;
        string ipfsAvatarHash;
        uint256 reputation;
        bool registered;
    }

    struct Bid {
        address freelancer;
        uint256 amount; // Wei
        bool active;
    }

    struct Bounty {
        uint256 id;
        address client;
        uint256 maxBudget; // Wei
        string ipfsBountyDetailsHash;
        BountyStatus status;
        address selectedFreelancer;
        uint256 agreedAmount; // Wei, locked in escrow
        string ipfsWorkFileHash;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant PLATFORM_FEE_BPS = 200; // 2.00% (basis points / 10_000)
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_REPUTATION_TO_BID = 40;
    uint256 public constant STARTING_REPUTATION = 100;
    uint256 public constant REPUTATION_REWARD = 15;
    uint256 public constant REPUTATION_PENALTY = 30;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice The platform overseer. Set once at deployment to the deployer.
    address public immutable arbiter;

    /// @notice wallet => profile. Acts as the sole on-chain registry/database.
    mapping(address => User) public users;

    uint256 public bountyCount;
    mapping(uint256 => Bounty) public bounties;

    /// @notice bountyId => list of bids submitted by freelancers.
    mapping(uint256 => Bid[]) public bountyBids;

    /// @notice Pull-payment pattern: funds owed to a wallet, claimable on demand.
    mapping(address => uint256) public withdrawableBalance;

    bool private locked; // simple re-entrancy guard for claimFunds

    // ---------------------------------------------------------------------
    // Events (consumed by the frontend via contract.on(...) for live sync)
    // ---------------------------------------------------------------------

    event UserRegistered(address indexed user, string name, Role role, string ipfsAvatarHash);
    event BountyPosted(uint256 indexed bountyId, address indexed client, uint256 maxBudget, string ipfsBountyDetailsHash);
    event BidPlaced(uint256 indexed bountyId, address indexed freelancer, uint256 amount);
    event EscrowFunded(uint256 indexed bountyId, address indexed client, address indexed freelancer, uint256 amount);
    event WorkSubmitted(uint256 indexed bountyId, address indexed freelancer, string ipfsWorkFileHash);
    //
    event FundsClaimed(address indexed user, uint256 amount);
    event DisputeRaised(uint256 indexed bountyId, address indexed client);
    event DisputeResolved(uint256 indexed bountyId, bool freelancerFault);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyRole(Role _role) {
        require(users[msg.sender].role == _role, "BountyPulse: wrong role");
        _;
    }

    modifier onlyRegistered() {
        require(users[msg.sender].registered, "BountyPulse: not registered");
        _;
    }

    modifier bountyExists(uint256 _bountyId) {
        require(_bountyId > 0 && _bountyId <= bountyCount, "BountyPulse: bounty does not exist");
        _;
    }

    modifier noReentrant() {
        require(!locked, "BountyPulse: reentrant call blocked");
        locked = true;
        _;
        locked = false;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor() {
        arbiter = msg.sender;
        users[msg.sender] = User({
            name: "Arbiter",
            role: Role.Arbiter,
            ipfsAvatarHash: "",
            reputation: 0,
            registered: true
        });
        emit UserRegistered(msg.sender, "Arbiter", Role.Arbiter, "");
    }

    // ---------------------------------------------------------------------
    // 2.1 Registration
    // ---------------------------------------------------------------------

    /// @notice Register a wallet as a Client or Freelancer. One-time only per address.
    function register(string calldata _name, Role _role, string calldata _ipfsAvatarHash) external {
        require(!users[msg.sender].registered, "BountyPulse: already registered");
        require(_role == Role.Client || _role == Role.Freelancer, "BountyPulse: invalid role");
        require(bytes(_name).length > 0, "BountyPulse: name required");

        uint256 startingReputation = _role == Role.Freelancer ? STARTING_REPUTATION : 0;

        users[msg.sender] = User({
            name: _name,
            role: _role,
            ipfsAvatarHash: _ipfsAvatarHash,
            reputation: startingReputation,
            registered: true
        });

        emit UserRegistered(msg.sender, _name, _role, _ipfsAvatarHash);
    }

    // ---------------------------------------------------------------------
    // 2.2.1 Post a Bounty (Client)
    // ---------------------------------------------------------------------

    function postBounty(uint256 _maxBudget, string calldata _ipfsBountyDetailsHash)
        external
        onlyRole(Role.Client)
        returns (uint256 bountyId)
    {
        require(_maxBudget > 0, "BountyPulse: budget must be > 0");

        bountyCount += 1;
        bountyId = bountyCount;

        bounties[bountyId] = Bounty({
            id: bountyId,
            client: msg.sender,
            maxBudget: _maxBudget,
            ipfsBountyDetailsHash: _ipfsBountyDetailsHash,
            status: BountyStatus.Open,
            selectedFreelancer: address(0),
            agreedAmount: 0,
            ipfsWorkFileHash: ""
        });

        emit BountyPosted(bountyId, msg.sender, _maxBudget, _ipfsBountyDetailsHash);
    }

    // ---------------------------------------------------------------------
    // 2.2.2 The Bidder Registry (non-payable quote)
    // ---------------------------------------------------------------------

    function placeBid(uint256 _bountyId, uint256 _amount)
        external
        bountyExists(_bountyId)
        onlyRole(Role.Freelancer)
    {
        Bounty storage b = bounties[_bountyId];
        require(b.status == BountyStatus.Open, "BountyPulse: bounty not open");
        require(_amount > 0, "BountyPulse: amount must be > 0");
        require(_amount <= b.maxBudget, "BountyPulse: bid exceeds max budget");
        require(users[msg.sender].reputation >= MIN_REPUTATION_TO_BID, "BountyPulse: reputation too low");

        bountyBids[_bountyId].push(Bid({freelancer: msg.sender, amount: _amount, active: true}));

        emit BidPlaced(_bountyId, msg.sender, _amount);
    }

    // ---------------------------------------------------------------------
    // 2.2.3 Escrow Funding & Revert Logic (payable)
    // ---------------------------------------------------------------------

    /// @notice Client accepts a specific bid and funds escrow. Must send >= bidAmount
    ///         (reverts otherwise) and any excess is refunded in the same transaction.
    function selectAndFund(uint256 _bountyId, address _freelancer, uint256 _bidAmount)
        external
        payable
        bountyExists(_bountyId)
    {
        Bounty storage b = bounties[_bountyId];
        require(msg.sender == b.client, "BountyPulse: only bounty client");
        require(b.status == BountyStatus.Open, "BountyPulse: bounty not open");
        require(msg.value >= _bidAmount, "BountyPulse: insufficient ETH sent"); // strict revert on underpay

        // Validate the (freelancer, amount) pair matches a real bid on this bounty.
        bool validBid = false;
        Bid[] storage bids = bountyBids[_bountyId];
        for (uint256 i = 0; i < bids.length; i++) {
            if (bids[i].freelancer == _freelancer && bids[i].amount == _bidAmount && bids[i].active) {
                validBid = true;
                break;
            }
        }
        require(validBid, "BountyPulse: bid not found for freelancer/amount");

        b.status = BountyStatus.Locked;
        b.selectedFreelancer = _freelancer;
        b.agreedAmount = _bidAmount;

        uint256 excess = msg.value - _bidAmount;
        if (excess > 0) {
            (bool sent, ) = payable(msg.sender).call{value: excess}("");
            require(sent, "BountyPulse: excess refund failed");
        }

        emit EscrowFunded(_bountyId, msg.sender, _freelancer, _bidAmount);
    }

    // ---------------------------------------------------------------------
    // 2.2.4 Work Submission, Approval & Percentage Math
    // ---------------------------------------------------------------------

    function submitWork(uint256 _bountyId, string calldata _ipfsWorkFileHash) external bountyExists(_bountyId) {
        Bounty storage b = bounties[_bountyId];
        require(b.status == BountyStatus.Locked, "BountyPulse: bounty not locked");
        require(msg.sender == b.selectedFreelancer, "BountyPulse: only selected freelancer");
        require(bytes(_ipfsWorkFileHash).length > 0, "BountyPulse: hash required");

        b.ipfsWorkFileHash = _ipfsWorkFileHash;

        emit WorkSubmitted(_bountyId, msg.sender, _ipfsWorkFileHash);
    }

    /// @notice Client approves submitted work. Deducts the 2% platform fee for the
    ///         Arbiter and credits the remaining 98% to the freelancer's withdrawable
    ///         balance (pull-payment pattern - no direct transfer here).
    function approveWork(uint256 _bountyId) external bountyExists(_bountyId) {
        Bounty storage b = bounties[_bountyId];
        require(msg.sender == b.client, "BountyPulse: only bounty client");
        require(b.status == BountyStatus.Locked, "BountyPulse: bounty not locked");
        require(bytes(b.ipfsWorkFileHash).length > 0, "BountyPulse: work not submitted");

        uint256 fee = (b.agreedAmount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 payout = b.agreedAmount - fee;

        withdrawableBalance[arbiter] += fee;
        withdrawableBalance[b.selectedFreelancer] += payout;

        users[b.selectedFreelancer].reputation += REPUTATION_REWARD;
        b.status = BountyStatus.Resolved;

        //
    }

    // ---------------------------------------------------------------------
    // 2.2.5 Claiming Funds (Pull-Payment)
    // ---------------------------------------------------------------------

    function claimFunds() external noReentrant {
        uint256 amount = withdrawableBalance[msg.sender];
        require(amount > 0, "BountyPulse: no funds to claim");

        withdrawableBalance[msg.sender] = 0; // effects before interaction

        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "BountyPulse: transfer failed");

        emit FundsClaimed(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // 2.2.6 Dispute, Refund & Penalty
    // ---------------------------------------------------------------------

    function disputeWork(uint256 _bountyId) external bountyExists(_bountyId) {
        Bounty storage b = bounties[_bountyId];
        require(msg.sender == b.client, "BountyPulse: only bounty client");
        require(b.status == BountyStatus.Locked, "BountyPulse: bounty not locked");

        b.status = BountyStatus.Disputed;

        emit DisputeRaised(_bountyId, msg.sender);
    }

    /// @notice Arbiter-only resolution.
    ///   freelancerFault = true  -> 100% refunded to Client, freelancer reputation -30.
    ///   freelancerFault = false -> Client was at fault; freelancer is paid (minus 2% fee).
    function resolveDispute(uint256 _bountyId, bool _freelancerFault)
        external
        bountyExists(_bountyId)
        onlyRole(Role.Arbiter)
    {
        Bounty storage b = bounties[_bountyId];
        require(b.status == BountyStatus.Disputed, "BountyPulse: bounty not disputed");

        if (_freelancerFault) {
            withdrawableBalance[b.client] += b.agreedAmount;

            uint256 rep = users[b.selectedFreelancer].reputation;
            users[b.selectedFreelancer].reputation = rep > REPUTATION_PENALTY ? rep - REPUTATION_PENALTY : 0;
        } else {
            uint256 fee = (b.agreedAmount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
            uint256 payout = b.agreedAmount - fee;

            withdrawableBalance[arbiter] += fee;
            withdrawableBalance[b.selectedFreelancer] += payout;
        }

        b.status = BountyStatus.Resolved;

        emit DisputeResolved(_bountyId, _freelancerFault);
    }

    // ---------------------------------------------------------------------
    // View helpers (used heavily by the frontend feed/sort UI)
    // ---------------------------------------------------------------------

    function getBids(uint256 _bountyId) external view returns (Bid[] memory) {
        return bountyBids[_bountyId];
    }

    function getBounty(uint256 _bountyId) external view returns (Bounty memory) {
        return bounties[_bountyId];
    }

    function getUser(address _addr) external view returns (User memory) {
        return users[_addr];
    }

    /// @notice Returns every bounty in one call so the frontend can sort/filter
    ///         client-side instead of issuing N separate RPC calls (gas-free view call,
    ///         and it avoids the classic anti-pattern of sorting an array on-chain).
    function getAllBounties() external view returns (Bounty[] memory all) {
        all = new Bounty[](bountyCount);
        for (uint256 i = 1; i <= bountyCount; i++) {
            all[i - 1] = bounties[i];
        }
    }
}

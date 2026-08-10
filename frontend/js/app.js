// ---------------------------------------------------------------------
// app.js — BountyPulse frontend
// ---------------------------------------------------------------------

let provider, signer, contract, contractReadOnly;
let currentAddress = null;
let currentUser = null; // { name, role, ipfsAvatarHash, reputation, registered }
let allBounties = [];   // cached from getAllBounties(), re-synced by events

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------
function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  $("toastRoot").appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ---------------------------------------------------------------------
// Wallet connection & auto-detection (3.1)
// ---------------------------------------------------------------------
async function connectWallet() {
  if (!window.ethereum) {
    toast("MetaMask not detected. Please install it to use BountyPulse.", "error");
    return;
  }

  provider = new ethers.BrowserProvider(window.ethereum);

  // Request access, then read whichever account MetaMask reports as active —
  // we never take a manually-typed address from the user.
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  currentAddress = await signer.getAddress();

  const network = await provider.getNetwork();
  if (network.chainId !== ANVIL_CHAIN_ID) {
    toast(`Wrong network. Please switch MetaMask to Anvil (chainId ${ANVIL_CHAIN_ID}).`, "error");
  }

  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  contractReadOnly = contract; // signer-bound contract can also do .view calls

  $("connectBtn").classList.add("hidden");
  $("walletInfo").classList.remove("hidden");
  $("walletAddress").textContent = shortAddr(currentAddress);

  await refreshIdentityAndUI();
  attachEventListeners();
}

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

// React instantly if the user switches accounts in MetaMask (3.1).
function listenForAccountChanges() {
  if (!window.ethereum) return;
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (accounts.length === 0) {
      // Wallet disconnected/locked.
      location.reload();
      return;
    }
    toast("Account changed — refreshing dashboard…");
    signer = await provider.getSigner();
    currentAddress = await signer.getAddress();
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    $("walletAddress").textContent = shortAddr(currentAddress);
    await refreshIdentityAndUI();
  });

  window.ethereum.on("chainChanged", () => location.reload());
}

// ---------------------------------------------------------------------
// Identity + role-based dashboard routing
// ---------------------------------------------------------------------
async function refreshIdentityAndUI() {
  $("app").classList.remove("hidden");

  const u = await contract.getUser(currentAddress);
  currentUser = {
    name: u.name,
    role: Number(u.role),
    ipfsAvatarHash: u.ipfsAvatarHash,
    reputation: Number(u.reputation),
    registered: u.registered,
  };

  $("walletRole").textContent = ROLE_NAME[currentUser.role];

  if (!currentUser.registered) {
    $("registerPanel").classList.remove("hidden");
    $("dashboards").classList.add("hidden");
    return;
  }

  $("registerPanel").classList.add("hidden");
  $("dashboards").classList.remove("hidden");

  $("statName").textContent = currentUser.name;
  $("statRole").textContent = ROLE_NAME[currentUser.role];

  document.querySelectorAll(".dashboard").forEach((d) => d.classList.add("hidden"));

  if (currentUser.role === ROLE.CLIENT) {
    $("clientDashboard").classList.remove("hidden");
    $("statRepCard").classList.add("hidden");
    $("statEarningsCard").classList.add("hidden");
    await renderClientDashboard();
  } else if (currentUser.role === ROLE.FREELANCER) {
    $("freelancerDashboard").classList.remove("hidden");
    $("statRepCard").classList.remove("hidden");
    $("statReputation").textContent = currentUser.reputation;
    await refreshEarnings();
    await renderFreelancerDashboard();
  } else if (currentUser.role === ROLE.ARBITER) {
    $("arbiterDashboard").classList.remove("hidden");
    $("statRepCard").classList.add("hidden");
    await refreshEarnings();
    await renderArbiterDashboard();
  }
}

async function refreshEarnings() {
  const bal = await contract.withdrawableBalance(currentAddress);
  $("statEarningsCard").classList.remove("hidden");
  $("statEarnings").textContent = `${ethers.formatEther(bal)} ETH`;
}

// ---------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------
$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const name = $("regName").value.trim();
    const role = Number($("regRole").value);
    const file = $("regAvatarFile").files[0];
    if (!file) return toast("Please choose an avatar image.", "error");

    toast("Pinning avatar to IPFS…");
    const cid = await pinFileToIPFS(file, `avatar-${name}`);
    $("regAvatarPreviewWrap").classList.remove("hidden");
    $("regAvatarPreview").src = ipfsUrl(cid);
    $("regAvatarCid").textContent = cid;

    toast("Submitting registration to the contract…");
    const tx = await contract.register(name, role, cid);
    await tx.wait();

    toast("Registered! Welcome to BountyPulse.");
    await refreshIdentityAndUI();
  } catch (err) {
    console.error(err);
    toast(err.reason || err.message || "Registration failed", "error");
  }
});

// ---------------------------------------------------------------------
// CLIENT dashboard
// ---------------------------------------------------------------------
$("postBountyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const budgetEth = $("bountyBudget").value;
    const file = $("bountyDetailsFile").files[0];
    if (!file) return toast("Attach a description file.", "error");

    toast("Pinning bounty details to IPFS…");
    const cid = await pinFileToIPFS(file, `bounty-${Date.now()}`);

    toast("Posting bounty on-chain…");
    const tx = await contract.postBounty(ethers.parseEther(budgetEth), cid);
    await tx.wait();

    toast("Bounty posted!");
    $("postBountyForm").reset();
    await renderClientDashboard();
  } catch (err) {
    console.error(err);
    toast(err.reason || err.message || "Failed to post bounty", "error");
  }
});

async function renderClientDashboard() {
  const all = await fetchAllBounties();
  const mine = all.filter((b) => b.client.toLowerCase() === currentAddress.toLowerCase());

  const container = $("clientBountyList");
  container.innerHTML = "";

  for (const b of mine) {
    const card = document.createElement("div");
    card.className = "bounty-card";

    const bids = b.status === 0 ? await contract.getBids(b.id) : [];
    const bidsHtml = bids.length
      ? bids
          .map(
            (bid) => `
        <div class="bid-row">
          <span>${shortAddr(bid.freelancer)}</span>
          <span>${ethers.formatEther(bid.amount)} ETH</span>
          <button class="btn small select-bid" data-bounty="${b.id}" data-freelancer="${bid.freelancer}" data-amount="${bid.amount}">
            Accept &amp; Fund Escrow
          </button>
        </div>`
          )
          .join("")
      : `<p class="muted">No bids yet.</p>`;

    let actionHtml = "";
    if (b.status === 1 && b.ipfsWorkFileHash) {
      actionHtml = `
        <p class="bounty-body">Work submitted: <a href="${ipfsUrl(b.ipfsWorkFileHash)}" target="_blank" rel="noopener">${b.ipfsWorkFileHash}</a></p>
        <div class="bounty-actions">
          <button class="btn primary approve-work" data-bounty="${b.id}">Approve Work</button>
          <button class="btn danger dispute-work" data-bounty="${b.id}">Dispute</button>
        </div>`;
    } else if (b.status === 1) {
      actionHtml = `<p class="muted">Escrow locked with ${shortAddr(b.selectedFreelancer)}. Waiting for work submission.</p>`;
    } else if (b.status === 3) {
      actionHtml = `<p class="muted">Disputed — awaiting Arbiter resolution.</p>`;
    }

    card.innerHTML = `
      <div class="bounty-card-head">
        <span class="bounty-title">Bounty #${b.id}</span>
        <span class="status-pill status-${BOUNTY_STATUS_NAME[b.status]}">${BOUNTY_STATUS_NAME[b.status]}</span>
      </div>
      <div class="bounty-meta">Max budget: ${ethers.formatEther(b.maxBudget)} ETH</div>
      <p class="bounty-body">Details: <a href="${ipfsUrl(b.ipfsBountyDetailsHash)}" target="_blank" rel="noopener">${b.ipfsBountyDetailsHash}</a></p>
      ${b.status === 0 ? `<div class="bid-list">${bidsHtml}</div>` : ""}
      ${actionHtml}
    `;
    container.appendChild(card);
  }

  container.querySelectorAll(".select-bid").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const { bounty, freelancer, amount } = btn.dataset;
        toast("Funding escrow — confirm the transaction in MetaMask…");
        const tx = await contract.selectAndFund(bounty, freelancer, amount, { value: amount });
        await tx.wait();
        toast("Escrow funded!");
        await renderClientDashboard();
      } catch (err) {
        console.error(err);
        toast(err.reason || err.message || "Escrow funding failed", "error");
      }
    })
  );

  container.querySelectorAll(".approve-work").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const tx = await contract.approveWork(btn.dataset.bounty);
        await tx.wait();
        toast("Work approved — freelancer paid (pull-payment).");
        await renderClientDashboard();
      } catch (err) {
        toast(err.reason || err.message || "Approval failed", "error");
      }
    })
  );

  container.querySelectorAll(".dispute-work").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const tx = await contract.disputeWork(btn.dataset.bounty);
        await tx.wait();
        toast("Dispute raised — awaiting Arbiter.");
        await renderClientDashboard();
      } catch (err) {
        toast(err.reason || err.message || "Dispute failed", "error");
      }
    })
  );
}

// ---------------------------------------------------------------------
// FREELANCER dashboard
// ---------------------------------------------------------------------
$("sortSelect").addEventListener("change", renderFreelancerDashboard);

async function renderFreelancerDashboard() {
  const all = await fetchAllBounties();
  let open = all.filter((b) => b.status === 0);

  // Sorting Constraint (3.2): client-side sort over the cached array —
  // one getAllBounties() view call instead of N per-bounty RPC round trips.
  const sortMode = $("sortSelect").value;
  if (sortMode === "budget-desc") open.sort((a, b) => (b.maxBudget > a.maxBudget ? 1 : -1));
  else if (sortMode === "budget-asc") open.sort((a, b) => (a.maxBudget > b.maxBudget ? 1 : -1));
  else if (sortMode === "newest") open.sort((a, b) => Number(b.id) - Number(a.id));

  const feed = $("feedBountyList");
  feed.innerHTML = "";

  for (const b of open) {
    const card = document.createElement("div");
    card.className = "bounty-card";
    card.innerHTML = `
      <div class="bounty-card-head">
        <span class="bounty-title">Bounty #${b.id}</span>
        <span class="status-pill status-Open">Open</span>
      </div>
      <div class="bounty-meta">Client: ${shortAddr(b.client)} · Max budget: ${ethers.formatEther(b.maxBudget)} ETH</div>
      <p class="bounty-body">Details: <a href="${ipfsUrl(b.ipfsBountyDetailsHash)}" target="_blank" rel="noopener">${b.ipfsBountyDetailsHash}</a></p>
      <div class="bounty-actions">
        <input type="number" step="0.0001" min="0" placeholder="Your bid (ETH)" class="bid-amount" data-bounty="${b.id}" />
        <button class="btn primary place-bid" data-bounty="${b.id}">Place Bid</button>
      </div>
    `;
    feed.appendChild(card);
  }

  feed.querySelectorAll(".place-bid").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const bountyId = btn.dataset.bounty;
        const input = feed.querySelector(`.bid-amount[data-bounty="${bountyId}"]`);
        if (!input.value) return toast("Enter a bid amount.", "error");
        const tx = await contract.placeBid(bountyId, ethers.parseEther(input.value));
        await tx.wait();
        toast("Bid submitted!");
        await renderFreelancerDashboard();
      } catch (err) {
        toast(err.reason || err.message || "Bid failed", "error");
      }
    })
  );

  // My active / in-flight work
  const mine = all.filter((b) => b.selectedFreelancer && b.selectedFreelancer.toLowerCase() === currentAddress.toLowerCase());
  const myWork = $("myWorkList");
  myWork.innerHTML = "";

  for (const b of mine) {
    const card = document.createElement("div");
    card.className = "bounty-card";
    let actionHtml = "";
    if (b.status === 1 && !b.ipfsWorkFileHash) {
      actionHtml = `
        <div class="bounty-actions">
          <input type="file" class="work-file" data-bounty="${b.id}" />
          <button class="btn primary submit-work" data-bounty="${b.id}">Submit Work</button>
        </div>`;
    } else if (b.status === 1 && b.ipfsWorkFileHash) {
      actionHtml = `<p class="muted">Work submitted — waiting for client review.</p>`;
    } else if (b.status === 3) {
      actionHtml = `<p class="muted">Under dispute — Arbiter will resolve.</p>`;
    } else if (b.status === 2) {
      actionHtml = `<p class="muted">Resolved.</p>`;
    }

    card.innerHTML = `
      <div class="bounty-card-head">
        <span class="bounty-title">Bounty #${b.id}</span>
        <span class="status-pill status-${BOUNTY_STATUS_NAME[b.status]}">${BOUNTY_STATUS_NAME[b.status]}</span>
      </div>
      <div class="bounty-meta">Agreed amount: ${ethers.formatEther(b.agreedAmount)} ETH</div>
      ${actionHtml}
    `;
    myWork.appendChild(card);
  }

  myWork.querySelectorAll(".submit-work").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const bountyId = btn.dataset.bounty;
        const fileInput = myWork.querySelector(`.work-file[data-bounty="${bountyId}"]`);
        const file = fileInput.files[0];
        if (!file) return toast("Attach the deliverable file.", "error");

        toast("Pinning work file to IPFS…");
        const cid = await pinFileToIPFS(file, `work-${bountyId}`);

        toast("Submitting work on-chain…");
        const tx = await contract.submitWork(bountyId, cid);
        await tx.wait();

        toast("Work submitted!");
        await renderFreelancerDashboard();
      } catch (err) {
        toast(err.reason || err.message || "Submission failed", "error");
      }
    })
  );
}

// ---------------------------------------------------------------------
// ARBITER dashboard
// ---------------------------------------------------------------------
async function renderArbiterDashboard() {
  const all = await fetchAllBounties();
  const disputed = all.filter((b) => b.status === 3);
  const disputeList = $("disputeList");
  disputeList.innerHTML = disputed.length ? "" : `<p class="muted">No active disputes.</p>`;

  for (const b of disputed) {
    const card = document.createElement("div");
    card.className = "bounty-card";
    card.innerHTML = `
      <div class="bounty-card-head">
        <span class="bounty-title">Bounty #${b.id}</span>
        <span class="status-pill status-Disputed">Disputed</span>
      </div>
      <div class="bounty-meta">Client: ${shortAddr(b.client)} · Freelancer: ${shortAddr(b.selectedFreelancer)} · Amount: ${ethers.formatEther(b.agreedAmount)} ETH</div>
      <p class="bounty-body">Work: <a href="${ipfsUrl(b.ipfsWorkFileHash)}" target="_blank" rel="noopener">${b.ipfsWorkFileHash || "—"}</a></p>
      <div class="bounty-actions">
        <button class="btn danger resolve-fault" data-bounty="${b.id}" data-fault="true">Rule: Freelancer Fault (refund client)</button>
        <button class="btn primary resolve-fault" data-bounty="${b.id}" data-fault="false">Rule: Client Fault (pay freelancer)</button>
      </div>
    `;
    disputeList.appendChild(card);
  }

  disputeList.querySelectorAll(".resolve-fault").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const tx = await contract.resolveDispute(btn.dataset.bounty, btn.dataset.fault === "true");
        await tx.wait();
        toast("Dispute resolved.");
        await renderArbiterDashboard();
      } catch (err) {
        toast(err.reason || err.message || "Resolution failed", "error");
      }
    })
  );

  const allList = $("allBountiesList");
  allList.innerHTML = "";
  for (const b of all) {
    const card = document.createElement("div");
    card.className = "bounty-card";
    card.innerHTML = `
      <div class="bounty-card-head">
        <span class="bounty-title">Bounty #${b.id}</span>
        <span class="status-pill status-${BOUNTY_STATUS_NAME[b.status]}">${BOUNTY_STATUS_NAME[b.status]}</span>
      </div>
      <div class="bounty-meta">Client: ${shortAddr(b.client)} · Max budget: ${ethers.formatEther(b.maxBudget)} ETH</div>
    `;
    allList.appendChild(card);
  }
}

// ---------------------------------------------------------------------
// Claim Funds (pull-payment, shared by Freelancer & Arbiter)
// ---------------------------------------------------------------------
$("claimFundsBtn").addEventListener("click", async () => {
  try {
    const tx = await contract.claimFunds();
    await tx.wait();
    toast("Funds claimed to your wallet!");
    await refreshEarnings();
  } catch (err) {
    toast(err.reason || err.message || "Claim failed", "error");
  }
});

// ---------------------------------------------------------------------
// Data fetching (3.2 View Operations)
// ---------------------------------------------------------------------
async function fetchAllBounties() {
  const raw = await contract.getAllBounties();
  allBounties = raw.map((b) => ({
    id: b.id,
    client: b.client,
    maxBudget: b.maxBudget,
    ipfsBountyDetailsHash: b.ipfsBountyDetailsHash,
    status: Number(b.status),
    selectedFreelancer: b.selectedFreelancer,
    agreedAmount: b.agreedAmount,
    ipfsWorkFileHash: b.ipfsWorkFileHash,
  }));
  return allBounties;
}

//3.5 - recheck

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
$("connectBtn").addEventListener("click", connectWallet);
listenForAccountChanges();

// Auto-detect an already-connected MetaMask account on page load (3.1) —
// no manual address text input anywhere in this app.
window.addEventListener("load", async () => {
  if (window.ethereum && window.ethereum.selectedAddress) {
    await connectWallet();
  }
});

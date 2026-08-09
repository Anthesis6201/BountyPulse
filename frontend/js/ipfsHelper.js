// ---------------------------------------------------------------------
// ipfsHelper.js
// Implements the "Two-Step IPFS Pipeline":
//   Step 1: upload the raw File to Pinata -> receive a CID.
//   Step 2: the caller passes that CID string into the smart contract call.
// Heavy bytes never touch the blockchain; only the 46-char CID does.
// ---------------------------------------------------------------------

/**
 * Pins a File (image, text, or any binary) to IPFS via Pinata's HTTP API.
 * @param {File} file
 * @param {string} [name] - optional pin name shown in your Pinata dashboard
 * @returns {Promise<string>} the resulting IPFS CID (IpfsHash)
 */
async function pinFileToIPFS(file, name) {
  if (!PINATA_JWT || PINATA_JWT === "PASTE_YOUR_PINATA_JWT_HERE") {
    throw new Error("Pinata JWT is not configured. Set PINATA_JWT in contractConfig.js");
  }

  const formData = new FormData();
  formData.append("file", file);

  if (name) {
    formData.append(
      "pinataMetadata",
      JSON.stringify({ name })
    );
  }

  const response = await fetch(PINATA_PIN_FILE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Pinata upload failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  // Pinata returns { IpfsHash, PinSize, Timestamp, ... }
  return data.IpfsHash;
}

/** Builds a viewable gateway URL for a given CID. */
function ipfsUrl(cid) {
  if (!cid) return "";
  return `${IPFS_GATEWAY}${cid}`;
}

/** Heuristic: does this CID look like it points at an image we can render inline? */
function looksLikeImageName(filename) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(filename || "");
}

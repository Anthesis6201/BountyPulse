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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {BountyPulse} from "../src/BountyPulse.sol";

/// @notice Deploys BountyPulse to whatever RPC is targeted (local Anvil by default).
///         The deployer becomes the Arbiter (see contract constructor).
contract Deploy is Script {
    function run() external returns (BountyPulse) {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast(); // falls back to --private-key / --sender CLI flags
        }

        BountyPulse bountyPulse = new BountyPulse();

        vm.stopBroadcast();

        console.log("BountyPulse deployed at:", address(bountyPulse));
        console.log("Arbiter (deployer):", bountyPulse.arbiter());

        return bountyPulse;
    }
}

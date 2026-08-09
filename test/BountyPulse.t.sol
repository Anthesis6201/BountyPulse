// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {BountyPulse} from "../src/BountyPulse.sol";

contract BountyPulseTest is Test {
    BountyPulse bp;

    address arbiter = address(this); // test contract deploys -> becomes arbiter
    address client = address(0xC11E17);
    address freelancer = address(0xF12EE1A);
    address freelancer2 = address(0xF12EE1B);

    function setUp() public {
        bp = new BountyPulse();

        vm.deal(client, 100 ether);
        vm.deal(freelancer, 1 ether);
        vm.deal(freelancer2, 1 ether);

        vm.prank(client);
        bp.register("Alice Client", BountyPulse.Role.Client, "Qm-avatar-client");

        vm.prank(freelancer);
        bp.register("Bob Freelancer", BountyPulse.Role.Freelancer, "Qm-avatar-bob");
    }

    function test_ArbiterSetOnDeploy() public {
        assertEq(bp.arbiter(), arbiter);
    }

    function test_FreelancerStartsWithReputation100() public {
        BountyPulse.User memory u = bp.getUser(freelancer);
        assertEq(u.reputation, 100);
    }

    function test_CannotRegisterTwice() public {
        vm.prank(client);
        vm.expectRevert(bytes("BountyPulse: already registered"));
        bp.register("Alice Again", BountyPulse.Role.Client, "hash");
    }

    function test_PostBounty() public {
        vm.prank(client);
        uint256 id = bp.postBounty(1 ether, "Qm-bounty-details");
        BountyPulse.Bounty memory b = bp.getBounty(id);
        assertEq(uint256(b.status), uint256(BountyPulse.BountyStatus.Open));
        assertEq(b.maxBudget, 1 ether);
    }

    function test_BidCannotExceedMaxBudget() public {
        vm.prank(client);
        uint256 id = bp.postBounty(1 ether, "Qm-bounty-details");

        vm.prank(freelancer);
        vm.expectRevert(bytes("BountyPulse: bid exceeds max budget"));
        bp.placeBid(id, 2 ether);
    }

    function test_LowReputationCannotBid() public {
        vm.prank(client);
        uint256 id = bp.postBounty(1 ether, "Qm-bounty-details");

        // Force freelancer reputation below the 40 gate via a lost dispute.
        vm.prank(freelancer);
        bp.placeBid(id, 0.5 ether);
        vm.prank(client);
        bp.selectAndFund{value: 0.5 ether}(id, freelancer, 0.5 ether);
        vm.prank(client);
        bp.disputeWork(id);
        bp.resolveDispute(id, true); // freelancer fault: 100 - 30 = 70

        vm.prank(client);
        uint256 id2 = bp.postBounty(1 ether, "Qm-bounty-2");
        vm.prank(freelancer);
        bp.placeBid(id2, 0.4 ether);

        // Push reputation below 40 with two more losses.
        vm.prank(client);
        bp.selectAndFund{value: 0.4 ether}(id2, freelancer, 0.4 ether);
        vm.prank(client);
        bp.disputeWork(id2);
        bp.resolveDispute(id2, true); // 70 - 30 = 40 (still allowed, gate is >=40)

        vm.prank(client);
        uint256 id3 = bp.postBounty(1 ether, "Qm-bounty-3");
        vm.prank(freelancer);
        bp.placeBid(id3, 0.3 ether); // reputation == 40, should still succeed

        vm.prank(client);
        bp.selectAndFund{value: 0.3 ether}(id3, freelancer, 0.3 ether);
        vm.prank(client);
        bp.disputeWork(id3);
        bp.resolveDispute(id3, true); // 40 - 30 = 10, now below gate

        vm.prank(client);
        uint256 id4 = bp.postBounty(1 ether, "Qm-bounty-4");
        vm.prank(freelancer);
        vm.expectRevert(bytes("BountyPulse: reputation too low"));
        bp.placeBid(id4, 0.2 ether);
    }

    function test_EscrowRevertsOnUnderpayment() public {
        vm.prank(client);
        uint256 id = bp.postBounty(1 ether, "Qm-bounty-details");
        vm.prank(freelancer);
        bp.placeBid(id, 0.5 ether);

        vm.prank(client);
        vm.expectRevert(bytes("BountyPulse: insufficient ETH sent"));
        bp.selectAndFund{value: 0.4 ether}(id, freelancer, 0.5 ether);
    }

    function test_EscrowRefundsExcess() public {
        vm.prank(client);
        uint256 id = bp.postBounty(1 ether, "Qm-bounty-details");
        vm.prank(freelancer);
        bp.placeBid(id, 0.5 ether);

        uint256 balBefore = client.balance;
        vm.prank(client);
        bp.selectAndFund{value: 0.7 ether}(id, freelancer, 0.5 ether);
        uint256 balAfter = client.balance;

        // Client should only be out 0.5 ether (0.2 ether excess refunded), modulo gas.
        assertApproxEqAbs(balBefore - balAfter, 0.5 ether, 0.001 ether);

        BountyPulse.Bounty memory b = bp.getBounty(id);
        assertEq(uint256(b.status), uint256(BountyPulse.BountyStatus.Locked));
        assertEq(b.agreedAmount, 0.5 ether);
    }

    function test_ApproveWorkPaysOutViaPullPattern() public {
        vm.prank(client);
        uint256 id = bp.postBounty(1 ether, "Qm-bounty-details");
        vm.prank(freelancer);
        bp.placeBid(id, 1 ether);
        vm.prank(client);
        bp.selectAndFund{value: 1 ether}(id, freelancer, 1 ether);

        vm.prank(freelancer);
        bp.submitWork(id, "Qm-work-file");

        vm.prank(client);
        bp.approveWork(id);

        // 2% fee = 0.02 ether to arbiter, 0.98 ether to freelancer, both as withdrawable.
        assertEq(bp.withdrawableBalance(arbiter), 0.02 ether);
        assertEq(bp.withdrawableBalance(freelancer), 0.98 ether);

        // Funds must NOT have moved automatically - freelancer balance unchanged pre-claim.
        assertEq(freelancer.balance, 1 ether);

        vm.prank(freelancer);
        bp.claimFunds();
        assertEq(freelancer.balance, 1 ether + 0.98 ether);

        BountyPulse.User memory u = bp.getUser(freelancer);
        assertEq(u.reputation, 115); // 100 + 15
    }

    function test_DisputeFreelancerFaultRefundsClientAndPenalizes() public {
        vm.prank(client);
        uint256 id = bp.postBounty(1 ether, "Qm-bounty-details");
        vm.prank(freelancer);
        bp.placeBid(id, 1 ether);
        vm.prank(client);
        bp.selectAndFund{value: 1 ether}(id, freelancer, 1 ether);

        vm.prank(client);
        bp.disputeWork(id);

        bp.resolveDispute(id, true); // arbiter (test contract) resolves

        assertEq(bp.withdrawableBalance(client), 1 ether); // 100% refund, no fee taken
        BountyPulse.User memory u = bp.getUser(freelancer);
        assertEq(u.reputation, 70); // 100 - 30
    }

    function test_DisputeClientFaultPaysFreelancerMinusFee() public {
        vm.prank(client);
        uint256 id = bp.postBounty(1 ether, "Qm-bounty-details");
        vm.prank(freelancer);
        bp.placeBid(id, 1 ether);
        vm.prank(client);
        bp.selectAndFund{value: 1 ether}(id, freelancer, 1 ether);

        vm.prank(client);
        bp.disputeWork(id);

        bp.resolveDispute(id, false);

        assertEq(bp.withdrawableBalance(freelancer), 0.98 ether);
        assertEq(bp.withdrawableBalance(arbiter), 0.02 ether);
    }

    function test_OnlyArbiterCanResolveDispute() public {
        vm.prank(client);
        uint256 id = bp.postBounty(1 ether, "Qm-bounty-details");
        vm.prank(freelancer);
        bp.placeBid(id, 1 ether);
        vm.prank(client);
        bp.selectAndFund{value: 1 ether}(id, freelancer, 1 ether);
        vm.prank(client);
        bp.disputeWork(id);

        vm.prank(client);
        vm.expectRevert(bytes("BountyPulse: wrong role"));
        bp.resolveDispute(id, true);
    }
}

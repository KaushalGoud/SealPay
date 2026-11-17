// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SealPay} from "../src/SealPay.sol";
import {PaymentPolicy} from "../src/PaymentPolicy.sol";

/// @notice Deploy a PaymentPolicy against an existing SealPay deployment.
/// @dev Usage:
///   SEALPAY_ADDRESS=0x... PAYER_ADDRESS=0x... AGENT_ADDRESS=0x... \
///   forge script script/DeployPolicy.s.sol:DeployPolicy \
///     --rpc-url https://rpc-test.qday.info --broadcast
contract DeployPolicy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        SealPay sealPay = SealPay(vm.envAddress("SEALPAY_ADDRESS"));
        address payer = vm.envAddress("PAYER_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");

        uint128 perTxCap = uint128(vm.envOr("PER_TX_CAP", uint256(5_000e6)));
        uint128 dailyCap = uint128(vm.envOr("DAILY_CAP", uint256(10_000e6)));
        uint256 expiryInput = vm.envOr("POLICY_EXPIRY", uint256(0));
        uint64 expiry = expiryInput == 0 ? uint64(block.timestamp + 30 days) : uint64(expiryInput);

        vm.startBroadcast(pk);
        PaymentPolicy policy = new PaymentPolicy(payer, sealPay, agent, perTxCap, dailyCap, expiry);
        vm.stopBroadcast();

        console.log("PaymentPolicy", address(policy));
        console.log("Next: payer calls SealPay.setOperator(policy, true)");
    }
}

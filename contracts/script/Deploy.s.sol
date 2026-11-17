// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MLDSA44Verifier} from "../src/verifier/MLDSA44Verifier.sol";
import {VendorRegistry} from "../src/VendorRegistry.sol";
import {SealPay} from "../src/SealPay.sol";
import {PaymentPolicy} from "../src/PaymentPolicy.sol";

/// @notice Deploys the SealPay stack to QDay Aevum testnet (chain 44005).
/// @dev Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://rpc-test.qday.info \
///     --private-key $PRIVATE_KEY --broadcast --verify \
///     --verifier blockscout --verifier-url https://explorer-test.qday.info/api
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);
        MLDSA44Verifier verifier = new MLDSA44Verifier();
        VendorRegistry registry = new VendorRegistry(verifier);
        SealPay sealPay = new SealPay(registry, verifier);
        vm.stopBroadcast();

        console.log("MLDSA44Verifier", address(verifier));
        console.log("VendorRegistry ", address(registry));
        console.log("SealPay        ", address(sealPay));

        // Optional: deploy an agent policy when PAYER_ADDRESS and AGENT_ADDRESS are set.
        address payer = vm.envOr("PAYER_ADDRESS", address(0));
        address agent = vm.envOr("AGENT_ADDRESS", address(0));
        if (payer != address(0) && agent != address(0)) {
            uint128 perTxCap = uint128(vm.envOr("PER_TX_CAP", uint256(5_000e6)));
            uint128 dailyCap = uint128(vm.envOr("DAILY_CAP", uint256(10_000e6)));
            uint256 expiryInput = vm.envOr("POLICY_EXPIRY", uint256(0));
            uint64 expiry = expiryInput == 0 ? uint64(block.timestamp + 30 days) : uint64(expiryInput);

            vm.startBroadcast(pk);
            PaymentPolicy policy = new PaymentPolicy(payer, sealPay, agent, perTxCap, dailyCap, expiry);
            vm.stopBroadcast();
            console.log("PaymentPolicy  ", address(policy));
        }
    }
}

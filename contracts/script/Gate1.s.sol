// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MLDSA44Verifier} from "../src/verifier/MLDSA44Verifier.sol";
import {MLDSA44Vector} from "../test/generated/MLDSA44Vector.sol";

/// @notice Gate 1 probe: prove that a real ML-DSA-44 verification fits in an
///         Aevum transaction. Deploy, then call `probe()` and inspect `gasUsed`.
contract Gate1Probe {
    MLDSA44Verifier public immutable verifier;
    bool public lastResult;
    uint256 public lastGasUsed;

    constructor(MLDSA44Verifier verifier_) {
        verifier = verifier_;
    }

    function probe() external returns (bool ok, uint256 gasUsed) {
        uint256 before = gasleft();
        ok = verifier.verify(MLDSA44Vector.PUBLIC_KEY, MLDSA44Vector.DIGEST, MLDSA44Vector.SIGNATURE);
        gasUsed = before - gasleft();
        lastResult = ok;
        lastGasUsed = gasUsed;
    }
}

/// @dev Usage:
///   forge script script/Gate1.s.sol:Gate1 --rpc-url https://rpc-test.qday.info \
///     --private-key $PRIVATE_KEY --broadcast
///   cast send <PROBE> "probe()" --rpc-url https://rpc-test.qday.info --private-key $PRIVATE_KEY
///   cast call <PROBE> "lastGasUsed()(uint256)" --rpc-url https://rpc-test.qday.info
contract Gate1 is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);
        MLDSA44Verifier verifier = new MLDSA44Verifier();
        Gate1Probe probe = new Gate1Probe(verifier);
        vm.stopBroadcast();

        console.log("MLDSA44Verifier", address(verifier));
        console.log("Gate1Probe     ", address(probe));
        console.log("Next: cast send <probe> 'probe()' --rpc-url https://rpc-test.qday.info --private-key $PRIVATE_KEY");
        console.log("Then: cast call <probe> 'lastGasUsed()(uint256)' --rpc-url https://rpc-test.qday.info");
    }
}

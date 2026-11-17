// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MLDSA44Verifier} from "../src/verifier/MLDSA44Verifier.sol";
import {MLDSA44Vector} from "./generated/MLDSA44Vector.sol";

contract MLDSA44VerifierTest is Test {
    MLDSA44Verifier internal verifier;

    function setUp() public {
        verifier = new MLDSA44Verifier();
    }

    function test_AcceptsValidSignature() public view {
        assertTrue(verifier.verify(MLDSA44Vector.PUBLIC_KEY, MLDSA44Vector.DIGEST, MLDSA44Vector.SIGNATURE));
    }

    function test_RejectsTamperedDigest() public view {
        bytes32 tampered = bytes32(uint256(MLDSA44Vector.DIGEST) ^ uint256(1));
        assertFalse(verifier.verify(MLDSA44Vector.PUBLIC_KEY, tampered, MLDSA44Vector.SIGNATURE));
    }

    function test_RejectsTamperedSignature() public view {
        bytes memory bad = MLDSA44Vector.SIGNATURE;
        bad[0] = bytes1(uint8(bad[0]) ^ 1);
        assertFalse(verifier.verify(MLDSA44Vector.PUBLIC_KEY, MLDSA44Vector.DIGEST, bad));
    }

    function test_RejectsWrongKey() public view {
        bytes memory bad = new bytes(1312);
        bad[0] = 0x01;
        assertFalse(verifier.verify(bad, MLDSA44Vector.DIGEST, MLDSA44Vector.SIGNATURE));
    }

    function test_RejectsWrongLengths() public view {
        assertFalse(verifier.verify(hex"01", MLDSA44Vector.DIGEST, MLDSA44Vector.SIGNATURE));
        assertFalse(verifier.verify(MLDSA44Vector.PUBLIC_KEY, MLDSA44Vector.DIGEST, hex"01"));
    }

    function test_ReportsGas() public {
        uint256 before = gasleft();
        verifier.verify(MLDSA44Vector.PUBLIC_KEY, MLDSA44Vector.DIGEST, MLDSA44Vector.SIGNATURE);
        uint256 used = before - gasleft();
        emit log_named_uint("ML-DSA-44 full-path verify gas", used);
        assertLt(used, 8_000_000);
    }
}

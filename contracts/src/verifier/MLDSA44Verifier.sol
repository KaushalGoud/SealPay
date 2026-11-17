// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISealPayVerifier} from "../interfaces/ISealPayVerifier.sol";
import {IMLDSAVerifier, ML_DSA_44} from "./mldsa/IMLDSAVerifier.sol";
import {MLDSA} from "./mldsa/MLDSA.sol";

/// @title MLDSA44Verifier
/// @notice FIPS 204 ML-DSA-44 verification over a 32-byte digest.
/// @dev Vendored pure-Solidity ML-DSA implementation from skalenetwork/mldsa-solidity
///      (MIT, NIST ACVP-tested, unaudited). ML-DSA-44 is used because it is the
///      cheapest parameter set that still meets NIST category 2 security.
///
///      Full-path verification (no per-key precomputation) costs roughly 5.7M gas.
///      The companion key factory can be wired in later to bring this down to ~2.7M.
contract MLDSA44Verifier is ISealPayVerifier {
    /// @inheritdoc ISealPayVerifier
    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature) external view returns (bool) {
        if (publicKey.length != 1312 || signature.length != 2420) return false;
        return MLDSA.verify(ML_DSA_44, publicKey, abi.encodePacked(digest), signature);
    }
}

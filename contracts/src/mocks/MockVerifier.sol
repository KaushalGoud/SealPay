// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISealPayVerifier} from "../interfaces/ISealPayVerifier.sol";

/// @notice Test double for ISealPayVerifier.
/// @dev Tests whitelist (publicKeyHash, digest) pairs. A tampered invoice produces a
///      different digest, so verification fails exactly like the real verifier.
contract MockVerifier is ISealPayVerifier {
    mapping(bytes32 => bool) public accepted;

    function allow(bytes calldata publicKey, bytes32 digest) external {
        accepted[_key(publicKey, digest)] = true;
    }

    function disallow(bytes calldata publicKey, bytes32 digest) external {
        accepted[_key(publicKey, digest)] = false;
    }

    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata) external view returns (bool) {
        return accepted[_key(publicKey, digest)];
    }

    function _key(bytes calldata publicKey, bytes32 digest) private pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(publicKey), digest));
    }
}

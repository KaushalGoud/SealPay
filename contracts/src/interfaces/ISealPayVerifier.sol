// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal post-quantum signature verifier used by SealPay.
/// @dev Implementations verify a FIPS 204 ML-DSA signature over a 32-byte digest.
///      Keeping the interface small lets the demo swap in a mock, a pure-Solidity
///      verifier, or a future ML-DSA precompile adapter without touching payment logic.
interface ISealPayVerifier {
    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature) external view returns (bool);
}

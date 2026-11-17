// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISealPayVerifier} from "./interfaces/ISealPayVerifier.sol";
import {MLDSAPublicKeys} from "./verifier/mldsa/MLDSAPublicKeys.sol";

/// @title VendorRegistry
/// @notice Maps a vendor payout address to its ML-DSA-44 public key.
/// @dev Keys are stored as contract code (SSTORE2 style) instead of storage, which
///      keeps reads cheap and makes the key immutable once published. Rotation is
///      authorised by the *current* key, so an attacker cannot swap a vendor's key.
contract VendorRegistry {
    error AlreadyRegistered();
    error NotRegistered();
    error InvalidKeyLength();
    error InvalidRotationSignature();
    error ZeroAddress();

    uint256 public constant ML_DSA_44_PUBLIC_KEY_BYTES = 1312;

    ISealPayVerifier public immutable verifier;

    mapping(address vendor => address pointer) private _keyPointers;
    mapping(address vendor => bytes32) public keyHash;
    mapping(address vendor => uint256) public rotationNonce;

    event VendorKeyRegistered(address indexed vendor, bytes32 indexed keyHash, uint256 nonce);
    event VendorKeyRotated(
        address indexed vendor, bytes32 indexed oldKeyHash, bytes32 indexed newKeyHash, uint256 nonce
    );

    constructor(ISealPayVerifier verifier_) {
        if (address(verifier_) == address(0)) revert ZeroAddress();
        verifier = verifier_;
    }

    /// @notice Publish the caller's ML-DSA-44 public key.
    function register(bytes calldata publicKey) external {
        if (publicKey.length != ML_DSA_44_PUBLIC_KEY_BYTES) revert InvalidKeyLength();
        if (_keyPointers[msg.sender] != address(0)) revert AlreadyRegistered();

        address pointer = MLDSAPublicKeys.store(publicKey);
        bytes32 hash = keccak256(publicKey);
        _keyPointers[msg.sender] = pointer;
        keyHash[msg.sender] = hash;

        emit VendorKeyRegistered(msg.sender, hash, 0);
    }

    /// @notice Rotate to a new key, authorised by a signature from the current key.
    /// @param newPublicKey The replacement ML-DSA-44 public key.
    /// @param signature ML-DSA-44 signature over `rotationDigest(...)` by the current key.
    function rotate(bytes calldata newPublicKey, bytes calldata signature) external {
        if (newPublicKey.length != ML_DSA_44_PUBLIC_KEY_BYTES) revert InvalidKeyLength();

        address currentPointer = _keyPointers[msg.sender];
        if (currentPointer == address(0)) revert NotRegistered();

        bytes32 oldHash = keyHash[msg.sender];
        bytes32 newHash = keccak256(newPublicKey);
        uint256 nonce = rotationNonce[msg.sender];
        bytes32 digest = rotationDigest(msg.sender, oldHash, newHash, nonce);

        bytes memory currentKey = MLDSAPublicKeys.load(currentPointer);
        if (!verifier.verify(currentKey, digest, signature)) revert InvalidRotationSignature();

        _keyPointers[msg.sender] = MLDSAPublicKeys.store(newPublicKey);
        keyHash[msg.sender] = newHash;
        rotationNonce[msg.sender] = nonce + 1;

        emit VendorKeyRotated(msg.sender, oldHash, newHash, nonce);
    }

    function getPublicKey(address vendor) external view returns (bytes memory) {
        return MLDSAPublicKeys.load(_keyPointers[vendor]);
    }

    function isRegistered(address vendor) external view returns (bool) {
        return _keyPointers[vendor] != address(0);
    }

    function rotationDigest(address vendor, bytes32 oldKeyHash, bytes32 newKeyHash, uint256 nonce)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode("SealPay.KeyRotation", block.chainid, address(this), vendor, oldKeyHash, newKeyHash, nonce)
        );
    }
}

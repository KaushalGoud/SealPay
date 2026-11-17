// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SealPay} from "./SealPay.sol";

/// @title PaymentPolicy
/// @notice Scoped spending policy for an AI payment agent.
/// @dev The payer keeps custody: this contract never holds tUSD8. The payer approves
///      SealPay directly and registers this policy as an operator. The agent can then
///      call `pay` only for allowlisted vendors/payees, within per-transaction and
///      daily caps, before expiry, and only until the payer revokes it. The vendor's
///      ML-DSA signature is still verified by SealPay, so a prompt-injected agent
///      cannot invent or alter an invoice.
contract PaymentPolicy is ReentrancyGuard {
    SealPay public immutable sealPay;
    address public immutable payer;

    address public agent;
    uint128 public perTxCap;
    uint128 public dailyCap;
    uint64 public expiresAt;
    uint64 public dayStart;
    uint256 public spentToday;
    bool public active;

    mapping(address payee => bool) public allowedPayee;
    mapping(address vendor => bool) public allowedVendor;

    event PolicyConfigured(
        address indexed payer, address indexed agent, uint128 perTxCap, uint128 dailyCap, uint64 expiresAt
    );
    event AgentUpdated(address indexed agent);
    event PayeeAllowed(address indexed payee, bool allowed);
    event VendorAllowed(address indexed vendor, bool allowed);
    event PolicyRevoked();
    event PolicyPayment(bytes32 indexed invoiceId, address indexed vendor, address indexed payee, uint256 amount);

    error Expired();
    error InvalidPolicy();
    error NotAgent();
    error NotPayer();
    error OverCap();
    error PayeeNotAllowed();
    error PolicyRevokedError();
    error VendorNotAllowed();
    error WrongPayer();

    modifier onlyPayer() {
        if (msg.sender != payer) revert NotPayer();
        _;
    }

    modifier onlyAgent() {
        if (!active) revert PolicyRevokedError();
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(
        address payer_,
        SealPay sealPay_,
        address agent_,
        uint128 perTxCap_,
        uint128 dailyCap_,
        uint64 expiresAt_
    ) {
        if (payer_ == address(0) || address(sealPay_) == address(0) || agent_ == address(0)) {
            revert InvalidPolicy();
        }
        if (perTxCap_ == 0 || dailyCap_ == 0 || perTxCap_ > dailyCap_ || expiresAt_ <= block.timestamp) {
            revert InvalidPolicy();
        }
        payer = payer_;
        sealPay = sealPay_;
        agent = agent_;
        perTxCap = perTxCap_;
        dailyCap = dailyCap_;
        expiresAt = expiresAt_;
        dayStart = uint64(block.timestamp);
        active = true;

        emit PolicyConfigured(payer_, agent_, perTxCap_, dailyCap_, expiresAt_);
    }

    /// @notice Execute a vendor-signed invoice under this policy.
    function pay(SealPay.Invoice calldata invoice, bytes calldata vendorSignature) external onlyAgent nonReentrant {
        if (block.timestamp > expiresAt) revert Expired();
        if (invoice.payer != payer) revert WrongPayer();
        if (!allowedVendor[invoice.vendor]) revert VendorNotAllowed();
        if (!allowedPayee[invoice.payee]) revert PayeeNotAllowed();
        if (invoice.amount > perTxCap) revert OverCap();

        if (block.timestamp >= uint256(dayStart) + 1 days) {
            dayStart = uint64(block.timestamp);
            spentToday = 0;
        }
        if (spentToday + invoice.amount > dailyCap) revert OverCap();
        spentToday += invoice.amount;

        sealPay.payInvoiceFrom(payer, invoice, vendorSignature);

        emit PolicyPayment(invoice.invoiceId, invoice.vendor, invoice.payee, invoice.amount);
    }

    function remainingToday() external view returns (uint256) {
        if (block.timestamp >= uint256(dayStart) + 1 days) return dailyCap;
        if (spentToday >= dailyCap) return 0;
        return dailyCap - spentToday;
    }

    function setAgent(address newAgent) external onlyPayer {
        if (newAgent == address(0)) revert InvalidPolicy();
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    function setCaps(uint128 newPerTxCap, uint128 newDailyCap) external onlyPayer {
        if (newPerTxCap == 0 || newDailyCap == 0 || newPerTxCap > newDailyCap) revert InvalidPolicy();
        perTxCap = newPerTxCap;
        dailyCap = newDailyCap;
    }

    function setExpiry(uint64 newExpiry) external onlyPayer {
        if (newExpiry <= block.timestamp) revert InvalidPolicy();
        expiresAt = newExpiry;
    }

    function setPayeeAllowed(address payee, bool allowed) external onlyPayer {
        allowedPayee[payee] = allowed;
        emit PayeeAllowed(payee, allowed);
    }

    function setVendorAllowed(address vendor, bool allowed) external onlyPayer {
        allowedVendor[vendor] = allowed;
        emit VendorAllowed(vendor, allowed);
    }

    function revoke() external onlyPayer {
        active = false;
        agent = address(0);
        emit PolicyRevoked();
    }
}

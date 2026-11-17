// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ISealPayVerifier} from "./interfaces/ISealPayVerifier.sol";
import {VendorRegistry} from "./VendorRegistry.sol";

/// @title SealPay
/// @notice Settles invoices only against a vendor's ML-DSA signature over an
///         EIP-712 invoice object. Every payment field is bound into the digest, so
///         changing the amount, payee, due date, token, payer or invoice id makes
///         verification fail and the payment revert.
/// @dev The digest is EIP-712 typed data: domain separator binds chain id and this
///      contract address, which blocks cross-chain and cross-contract replay. The
///      invoice id is consumed exactly once, which blocks same-chain replay.
contract SealPay is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Registered,
        Paid
    }

    struct Invoice {
        bytes32 invoiceId;
        address vendor;
        address payer;
        address token;
        uint256 amount;
        address payee;
        uint64 dueDate;
        uint64 expiry;
        uint256 nonce;
    }

    struct Record {
        bytes32 invoiceHash;
        address vendor;
        address payer;
        address token;
        uint256 amount;
        address payee;
        uint64 dueDate;
        uint64 expiry;
        Status status;
    }

    bytes32 public constant INVOICE_TYPEHASH = keccak256(
        "Invoice(bytes32 invoiceId,address vendor,address payer,address token,uint256 amount,address payee,uint64 dueDate,uint64 expiry,uint256 nonce)"
    );

    VendorRegistry public immutable registry;
    ISealPayVerifier public immutable verifier;

    mapping(bytes32 invoiceId => Record) public invoices;
    mapping(address payer => mapping(address operator => bool)) public isOperator;

    event InvoiceRegistered(
        bytes32 indexed invoiceId,
        address indexed vendor,
        address indexed payer,
        address token,
        uint256 amount,
        address payee,
        uint64 dueDate,
        uint64 expiry,
        bytes32 invoiceHash
    );

    event InvoicePaid(
        bytes32 indexed invoiceId,
        address indexed vendor,
        address indexed payer,
        address token,
        uint256 amount,
        address payee,
        bytes32 invoiceHash,
        bytes32 signatureHash
    );

    event OperatorSet(address indexed payer, address indexed operator, bool allowed);

    error InvoiceExists();
    error AlreadyPaid();
    error Expired();
    error InvalidInvoice();
    error InvalidSignature();
    error NotAuthorized();
    error PayerMismatch();
    error VendorNotRegistered();
    error ZeroAddress();

    constructor(VendorRegistry registry_, ISealPayVerifier verifier_) EIP712("SealPay", "1") {
        if (address(registry_) == address(0) || address(verifier_) == address(0)) revert ZeroAddress();
        registry = registry_;
        verifier = verifier_;
    }

    /// @notice Record a vendor-signed invoice without paying it yet.
    function registerInvoice(Invoice calldata invoice, bytes calldata vendorSignature) external {
        _register(invoice, vendorSignature);
    }

    /// @notice Pay a vendor-signed invoice from the caller's balance.
    function payInvoice(Invoice calldata invoice, bytes calldata vendorSignature) external nonReentrant {
        _settle(msg.sender, invoice, vendorSignature);
    }

    /// @notice Pay on behalf of `payer`, e.g. from a policy contract with an agent session.
    /// @dev The payer must have approved this contract for `invoice.token` and authorised
    ///      `msg.sender` via `setOperator`.
    function payInvoiceFrom(address payer, Invoice calldata invoice, bytes calldata vendorSignature)
        external
        nonReentrant
    {
        if (msg.sender != payer && !isOperator[payer][msg.sender]) revert NotAuthorized();
        _settle(payer, invoice, vendorSignature);
    }

    /// @notice Authorise or revoke an operator that may pay invoices on the caller's behalf.
    function setOperator(address operator, bool allowed) external {
        if (operator == address(0)) revert ZeroAddress();
        isOperator[msg.sender][operator] = allowed;
        emit OperatorSet(msg.sender, operator, allowed);
    }

    /// @notice EIP-712 digest a vendor signs for this invoice.
    function hashInvoice(Invoice calldata invoice) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INVOICE_TYPEHASH,
                    invoice.invoiceId,
                    invoice.vendor,
                    invoice.payer,
                    invoice.token,
                    invoice.amount,
                    invoice.payee,
                    invoice.dueDate,
                    invoice.expiry,
                    invoice.nonce
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getInvoice(bytes32 invoiceId) external view returns (Record memory) {
        return invoices[invoiceId];
    }

    function _register(Invoice calldata invoice, bytes calldata vendorSignature) private {
        _validate(invoice);
        if (invoices[invoice.invoiceId].status != Status.None) revert InvoiceExists();
        _requireVendorSignature(invoice, vendorSignature);

        bytes32 digest = hashInvoice(invoice);
        invoices[invoice.invoiceId] = Record({
            invoiceHash: digest,
            vendor: invoice.vendor,
            payer: invoice.payer,
            token: invoice.token,
            amount: invoice.amount,
            payee: invoice.payee,
            dueDate: invoice.dueDate,
            expiry: invoice.expiry,
            status: Status.Registered
        });

        emit InvoiceRegistered(
            invoice.invoiceId,
            invoice.vendor,
            invoice.payer,
            invoice.token,
            invoice.amount,
            invoice.payee,
            invoice.dueDate,
            invoice.expiry,
            digest
        );
    }

    function _settle(address payer, Invoice calldata invoice, bytes calldata vendorSignature) private {
        Record storage record = invoices[invoice.invoiceId];

        if (record.status == Status.Paid) revert AlreadyPaid();
        if (invoice.payer != address(0) && invoice.payer != payer) revert PayerMismatch();

        if (record.status == Status.None) {
            _register(invoice, vendorSignature);
            record = invoices[invoice.invoiceId];
        } else {
            if (record.invoiceHash != hashInvoice(invoice)) revert InvalidInvoice();
        }

        if (block.timestamp > invoice.expiry) revert Expired();

        record.status = Status.Paid;
        IERC20(invoice.token).safeTransferFrom(payer, invoice.payee, invoice.amount);

        emit InvoicePaid(
            invoice.invoiceId,
            invoice.vendor,
            payer,
            invoice.token,
            invoice.amount,
            invoice.payee,
            record.invoiceHash,
            keccak256(vendorSignature)
        );
    }

    function _validate(Invoice calldata invoice) private view {
        if (
            invoice.invoiceId == bytes32(0) || invoice.vendor == address(0) || invoice.token == address(0)
                || invoice.payee == address(0)
        ) revert InvalidInvoice();
        if (invoice.amount == 0) revert InvalidInvoice();
        if (invoice.expiry <= block.timestamp) revert Expired();
        if (!registry.isRegistered(invoice.vendor)) revert VendorNotRegistered();
    }

    function _requireVendorSignature(Invoice calldata invoice, bytes calldata vendorSignature) private view {
        bytes memory publicKey = registry.getPublicKey(invoice.vendor);
        if (publicKey.length == 0) revert VendorNotRegistered();
        if (!verifier.verify(publicKey, hashInvoice(invoice), vendorSignature)) revert InvalidSignature();
    }
}

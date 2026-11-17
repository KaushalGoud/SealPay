import { parseAbi } from "viem";

export const invoiceTuple =
  "(bytes32 invoiceId,address vendor,address payer,address token,uint256 amount,address payee,uint64 dueDate,uint64 expiry,uint256 nonce)";

export const sealPayAbi = parseAbi([
  `function payInvoice(${invoiceTuple} invoice, bytes vendorSignature)`,
  `function payInvoiceFrom(address payer, ${invoiceTuple} invoice, bytes vendorSignature)`,
  `function registerInvoice(${invoiceTuple} invoice, bytes vendorSignature)`,
  `function setOperator(address operator, bool allowed)`,
  `function hashInvoice(${invoiceTuple} invoice) view returns (bytes32)`,
  `function domainSeparator() view returns (bytes32)`,
  `function isOperator(address payer, address operator) view returns (bool)`,
  "function getInvoice(bytes32 invoiceId) view returns (bytes32 invoiceHash,address vendor,address payer,address token,uint256 amount,address payee,uint64 dueDate,uint64 expiry,uint8 status)",
  "event InvoiceRegistered(bytes32 indexed invoiceId,address indexed vendor,address indexed payer,address token,uint256 amount,address payee,uint64 dueDate,uint64 expiry,bytes32 invoiceHash)",
  "event InvoicePaid(bytes32 indexed invoiceId,address indexed vendor,address indexed payer,address token,uint256 amount,address payee,bytes32 invoiceHash,bytes32 signatureHash)",
]);

export const registryAbi = parseAbi([
  "function register(bytes publicKey)",
  "function rotate(bytes newPublicKey, bytes signature)",
  "function getPublicKey(address vendor) view returns (bytes)",
  "function isRegistered(address vendor) view returns (bool)",
  "function keyHash(address vendor) view returns (bytes32)",
  "function rotationNonce(address vendor) view returns (uint256)",
  "event VendorKeyRegistered(address indexed vendor, bytes32 indexed keyHash, uint256 nonce)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const policyAbi = parseAbi([
  `function pay(${invoiceTuple} invoice, bytes vendorSignature)`,
  "function payer() view returns (address)",
  "function agent() view returns (address)",
  "function perTxCap() view returns (uint128)",
  "function dailyCap() view returns (uint128)",
  "function expiresAt() view returns (uint64)",
  "function spentToday() view returns (uint256)",
  "function remainingToday() view returns (uint256)",
  "function active() view returns (bool)",
  "function allowedVendor(address vendor) view returns (bool)",
  "function allowedPayee(address payee) view returns (bool)",
  "function setAgent(address newAgent)",
  "function setCaps(uint128 newPerTxCap, uint128 newDailyCap)",
  "function setPayeeAllowed(address payee, bool allowed)",
  "function setVendorAllowed(address vendor, bool allowed)",
  "function revoke()",
  "event PolicyPayment(bytes32 indexed invoiceId,address indexed vendor,address indexed payee,uint256 amount)",
]);

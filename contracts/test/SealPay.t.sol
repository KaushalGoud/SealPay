// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {SealPay} from "../src/SealPay.sol";
import {VendorRegistry} from "../src/VendorRegistry.sol";
import {PaymentPolicy} from "../src/PaymentPolicy.sol";
import {MockVerifier} from "../src/mocks/MockVerifier.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract SealPayTest is Test {
    VendorRegistry internal registry;
    MockVerifier internal verifier;
    SealPay internal sealPay;
    MockERC20 internal token;

    address internal vendor = makeAddr("vendor");
    address internal payer = makeAddr("payer");
    address internal payee = makeAddr("payee");
    address internal operator = makeAddr("operator");
    address internal agent = makeAddr("agent");
    address internal attacker = makeAddr("attacker");

    bytes internal vendorKey;
    bytes internal signature = hex"deadbeef";

    function setUp() public {
        verifier = new MockVerifier();
        registry = new VendorRegistry(verifier);
        sealPay = new SealPay(registry, verifier);
        token = new MockERC20();

        vendorKey = new bytes(1312);
        vendorKey[0] = 0x01;
        vendorKey[1311] = 0x02;

        vm.prank(vendor);
        registry.register(vendorKey);

        token.mint(payer, 1_000_000e6);
        vm.prank(payer);
        token.approve(address(sealPay), type(uint256).max);
    }

    function _invoice() internal view returns (SealPay.Invoice memory) {
        return SealPay.Invoice({
            invoiceId: keccak256("INV-1001"),
            vendor: vendor,
            payer: payer,
            token: address(token),
            amount: 4_200e6,
            payee: payee,
            dueDate: uint64(block.timestamp + 10 days),
            expiry: uint64(block.timestamp + 30 days),
            nonce: 1
        });
    }

    function _sign(SealPay.Invoice memory invoice) internal {
        verifier.allow(vendorKey, sealPay.hashInvoice(invoice));
    }

    function test_PayValidInvoice() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(payer);
        sealPay.payInvoice(invoice, signature);

        assertEq(token.balanceOf(payee), 4_200e6);
        assertEq(token.balanceOf(payer), 1_000_000e6 - 4_200e6);
        assertEq(uint256(sealPay.getInvoice(invoice.invoiceId).status), uint256(SealPay.Status.Paid));
    }

    function test_TamperedAmountReverts() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        invoice.amount = 42_000e6;

        vm.prank(payer);
        vm.expectRevert(SealPay.InvalidSignature.selector);
        sealPay.payInvoice(invoice, signature);
    }

    function test_TamperedPayeeReverts() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        invoice.payee = attacker;

        vm.prank(payer);
        vm.expectRevert(SealPay.InvalidSignature.selector);
        sealPay.payInvoice(invoice, signature);
    }

    function test_TamperedDueDateReverts() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        invoice.dueDate += 1;

        vm.prank(payer);
        vm.expectRevert(SealPay.InvalidSignature.selector);
        sealPay.payInvoice(invoice, signature);
    }

    function test_RegisteredInvoiceTamperReverts() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        sealPay.registerInvoice(invoice, signature);

        invoice.amount = 1;
        vm.prank(payer);
        vm.expectRevert(SealPay.InvalidInvoice.selector);
        sealPay.payInvoice(invoice, signature);
    }

    function test_ReplayReverts() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(payer);
        sealPay.payInvoice(invoice, signature);

        vm.prank(payer);
        vm.expectRevert(SealPay.AlreadyPaid.selector);
        sealPay.payInvoice(invoice, signature);
    }

    function test_ExpiredReverts() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.warp(invoice.expiry + 1);

        vm.prank(payer);
        vm.expectRevert(SealPay.Expired.selector);
        sealPay.payInvoice(invoice, signature);
    }

    function test_WrongPayerReverts() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(attacker);
        vm.expectRevert(SealPay.PayerMismatch.selector);
        sealPay.payInvoice(invoice, signature);
    }

    function test_OperatorCanPayForPayer() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(payer);
        sealPay.setOperator(operator, true);

        vm.prank(operator);
        sealPay.payInvoiceFrom(payer, invoice, signature);

        assertEq(token.balanceOf(payee), 4_200e6);
    }

    function test_UnauthorisedOperatorReverts() public {
        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(attacker);
        vm.expectRevert(SealPay.NotAuthorized.selector);
        sealPay.payInvoiceFrom(payer, invoice, signature);
    }

    function test_VendorKeyRotation() public {
        bytes memory newKey = new bytes(1312);
        newKey[0] = 0x09;

        bytes32 oldHash = registry.keyHash(vendor);
        bytes32 newHash = keccak256(newKey);
        bytes32 digest = registry.rotationDigest(vendor, oldHash, newHash, 0);
        verifier.allow(vendorKey, digest);

        vm.prank(vendor);
        registry.rotate(newKey, signature);

        assertEq(registry.keyHash(vendor), newHash);
        assertEq(registry.getPublicKey(vendor), newKey);
        assertEq(registry.rotationNonce(vendor), 1);
    }

    function test_UnauthorisedRotationReverts() public {
        bytes memory newKey = new bytes(1312);
        newKey[0] = 0x09;

        vm.prank(attacker);
        vm.expectRevert(VendorRegistry.NotRegistered.selector);
        registry.rotate(newKey, signature);
    }

    function test_PolicyPaysWithinCaps() public {
        PaymentPolicy policy =
            new PaymentPolicy(payer, sealPay, agent, 5_000e6, 10_000e6, uint64(block.timestamp + 30 days));

        vm.startPrank(payer);
        sealPay.setOperator(address(policy), true);
        policy.setVendorAllowed(vendor, true);
        policy.setPayeeAllowed(payee, true);
        vm.stopPrank();

        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(agent);
        policy.pay(invoice, signature);

        assertEq(token.balanceOf(payee), 4_200e6);
        assertEq(policy.spentToday(), 4_200e6);
        assertEq(policy.remainingToday(), 10_000e6 - 4_200e6);
    }

    function test_PolicyRejectsOverCap() public {
        PaymentPolicy policy =
            new PaymentPolicy(payer, sealPay, agent, 1_000e6, 10_000e6, uint64(block.timestamp + 30 days));

        vm.startPrank(payer);
        sealPay.setOperator(address(policy), true);
        policy.setVendorAllowed(vendor, true);
        policy.setPayeeAllowed(payee, true);
        vm.stopPrank();

        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(agent);
        vm.expectRevert(PaymentPolicy.OverCap.selector);
        policy.pay(invoice, signature);
    }

    function test_PolicyRejectsUnknownPayee() public {
        PaymentPolicy policy =
            new PaymentPolicy(payer, sealPay, agent, 5_000e6, 10_000e6, uint64(block.timestamp + 30 days));

        vm.startPrank(payer);
        sealPay.setOperator(address(policy), true);
        policy.setVendorAllowed(vendor, true);
        vm.stopPrank();

        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(agent);
        vm.expectRevert(PaymentPolicy.PayeeNotAllowed.selector);
        policy.pay(invoice, signature);
    }

    function test_PolicyRevokedReverts() public {
        PaymentPolicy policy =
            new PaymentPolicy(payer, sealPay, agent, 5_000e6, 10_000e6, uint64(block.timestamp + 30 days));

        vm.prank(payer);
        policy.revoke();

        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(agent);
        vm.expectRevert(PaymentPolicy.PolicyRevokedError.selector);
        policy.pay(invoice, signature);
    }

    function test_OnlyAgentCanUsePolicy() public {
        PaymentPolicy policy =
            new PaymentPolicy(payer, sealPay, agent, 5_000e6, 10_000e6, uint64(block.timestamp + 30 days));

        SealPay.Invoice memory invoice = _invoice();
        _sign(invoice);

        vm.prank(attacker);
        vm.expectRevert(PaymentPolicy.NotAgent.selector);
        policy.pay(invoice, signature);
    }
}

import { defineChain } from "viem";

export const aevum = defineChain({
  id: 44005,
  name: "QDay Aevum",
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-test.qday.info"], webSocket: ["wss://rpc-test.qday.info"] },
  },
  blockExplorers: {
    default: { name: "Aevum Explorer", url: "https://explorer-test.qday.info" },
  },
  testnet: true,
});

const env = (value: string | undefined): `0x${string}` | undefined =>
  value && value !== "0x" ? (value as `0x${string}`) : undefined;

export const SEALPAY_ADDRESS = env(process.env.NEXT_PUBLIC_SEALPAY_ADDRESS);
export const REGISTRY_ADDRESS = env(process.env.NEXT_PUBLIC_REGISTRY_ADDRESS);
export const POLICY_ADDRESS = env(process.env.NEXT_PUBLIC_POLICY_ADDRESS) as `0x${string}` | undefined;
export const TUSD8_ADDRESS =
  env(process.env.NEXT_PUBLIC_TUSD8_ADDRESS) ?? "0x456569838f1d43009A91ebA4263147Afd7233483";

export const explorerTx = (hash: string) => `https://explorer-test.qday.info/tx/${hash}`;
export const explorerAddress = (address: string) => `https://explorer-test.qday.info/address/${address}`;

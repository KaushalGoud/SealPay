import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { aevum } from "./chain";

export const wagmiConfig = createConfig({
  chains: [aevum],
  connectors: [injected()],
  transports: {
    [aevum.id]: http("https://rpc-test.qday.info"),
  },
  ssr: true,
});

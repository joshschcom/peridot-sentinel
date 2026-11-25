export * from './abis.js';

export const abiVersion = 'v1' as const;
export const xLayerTestnet = {
  id: 1952, name: 'X Layer Testnet', testnet: true,
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: ['https://testrpc.xlayer.tech'] } },
  blockExplorers: { default: { name: 'OKX Explorer', url: 'https://www.okx.com/web3/explorer/xlayer-test' } }
} as const;
export const xLayer = {
  id: 196, name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } },
  blockExplorers: { default: { name: 'OKX Explorer', url: 'https://www.okx.com/web3/explorer/xlayer' } }
} as const;

type Address = `0x${string}`;
export type DeploymentManifest = {
  schemaVersion: 1;
  abiVersion: 'v1';
  profile: 'local' | 'testnet' | 'read-only';
  chainId: 31337 | 1952 | 196;
  status: 'deployed' | 'not-deployed';
  commit: string | null;
  contracts: Record<string, Address>;
  markets: { controller: Address, collateralMarket: Address, debtMarket: Address }[];
  tapeout: {
    mode: 'unavailable' | 'development-reference' | 'official' | 'self-deployed-reference',
    processor: Address | null,
    circuits: { kind: 'MARKET' | 'ACCOUNT', circuitId: string, policyId: Address, netlistHash: Address, configHash: Address }[]
  };
  mocks: string[];
};

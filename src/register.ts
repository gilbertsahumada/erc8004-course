/**
 * ERC-8004 Agent Registration Script
 * 
 * This script registers your agent on the ERC-8004 Identity Registry.
 * It performs the following steps:
 * 
 * 1. Reads your registration.json metadata
 * 2. Encodes metadata as a base64 data URI
 * 3. Calls the Identity Registry contract to mint your agent NFT
 * 4. Returns your agentId for future reference
 * 
 * Requirements:
 * - PRIVATE_KEY in .env (wallet with testnet ETH for gas)
 * 
 * Run with: npm run register
 */

import 'dotenv/config';
import fs from 'fs/promises';
import { createWalletClient, createPublicClient, http, parseAbi, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================================================
// Contract Configuration
// ============================================================================

/**
 * ERC-8004 Identity Registry ABI (minimal)
 * The register() function mints an agent NFT with your tokenURI
 */
const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string tokenURI) external returns (uint256 agentId)',
  'event Registered(uint256 indexed agentId, string tokenURI, address indexed owner)',
]);

/**
 * Chain configuration for Ethereum Sepolia
 * Change this if you want to deploy to a different network
 */
const CHAIN_CONFIG = {
  id: 11155111,
  name: 'Ethereum Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.sepolia.org'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://sepolia.etherscan.io' } },
};

// Identity Registry contract address on Ethereum Sepolia
const IDENTITY_REGISTRY = '0x8004a6090Cd10A7288092483047B097295Fb8847';

// ============================================================================
// Main Registration Flow
// ============================================================================

async function main() {
  // Step 1: Load environment variables
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not set in .env');
  }

  

  // Step 2: Read registration.json (your agent's metadata)
  const registrationData = await fs.readFile('registration.json', 'utf-8');
  const registration = JSON.parse(registrationData);

  // Step 3: Prepare tokenURI (either IPFS or base64)
  let tokenURI: string;

  // Encode as base64 data URI
  // The tokenURI will be: data:application/json;base64,...
  // This stores metadata directly on-chain (no external dependencies)
  console.log('📦 Encoding as base64...');
  const base64Data = Buffer.from(registrationData).toString('base64');
  tokenURI = `data:application/json;base64,${base64Data}`;
  console.log('✅ Encoded as base64 data URI');

  // Step 4: Setup wallet client (for sending transactions)
  const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  console.log('🔑 Registering from:', account.address);

  const walletClient = createWalletClient({
    account,
    chain: CHAIN_CONFIG,
    transport: http(),
  });

  // Public client for reading blockchain state
  const publicClient = createPublicClient({
    chain: CHAIN_CONFIG,
    transport: http(),
  });

  // Step 5: Call the register() function on the Identity Registry
  console.log('📝 Registering agent on Ethereum Sepolia...');
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [tokenURI],
  });

  // Step 6: Wait for transaction confirmation
  console.log('⏳ Waiting for confirmation...');
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Parse the Registered event to get agentId
  // The Registered event signature hash
  const REGISTERED_EVENT_SIG = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a';
  
  const registeredLog = receipt.logs.find(
    (log) => 
      log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() &&
      log.topics[0] === REGISTERED_EVENT_SIG
  );

  let agentId: string | null = null;
  if (registeredLog) {
    try {
      const decoded = decodeEventLog({
        abi: IDENTITY_REGISTRY_ABI,
        data: registeredLog.data,
        topics: registeredLog.topics,
      });
      if (decoded.eventName === 'Registered' && decoded.args) {
        agentId = (decoded.args as { agentId: bigint }).agentId.toString();
      }
    } catch (e) {
      console.warn('⚠️  Could not decode event log, agentId not extracted');
    }
  }

  // Step 7: Output results
  console.log('\n✅ Agent registered successfully!');
  console.log('📋 Transaction:', `https://sepolia.etherscan.io/tx/${hash}`);
  console.log('🔗 Registry:', IDENTITY_REGISTRY);
  console.log('📄 Token URI:', tokenURI);
  if (agentId) {
    console.log('🆔 Agent ID:', agentId);
    console.log('');
    console.log('🌐 View your agent on 8004scan:');
    console.log(`   https://www.8004scan.io/sepolia/agent/${agentId}`);
  }

  // Update registration.json with the registry reference
  registration.registrations = [{
    agentId: agentId ? parseInt(agentId, 10) : 'UNKNOWN',
    agentRegistry: `eip155:11155111:${IDENTITY_REGISTRY}`,
  }];
  await fs.writeFile('registration.json', JSON.stringify(registration, null, 2));
  
  if (agentId) {
    console.log('\n✅ registration.json updated with agentId:', agentId);
  } else {
    console.log('\n⚠️  Could not extract agentId - check transaction logs manually');
  }
}

main().catch(console.error);

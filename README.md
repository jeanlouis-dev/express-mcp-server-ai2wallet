# x402 Express MCP Server Example

Express.js MCP server demonstrating how to protect API endpoints with a paywall using the `ai2wallet-sdk` middleware.

## Prerequisites

- Node.js v20+ (install via [nvm](https://github.com/nvm-sh/nvm))
- Valid EVM, SVM and STELLAR addresses for receiving payments 
- URL of a facilitator supporting the desired payment network, see [facilitator list](https://www.x402.org/ecosystem?category=facilitators) 

## Setup

1. Copy `.env-local` to `.env`:

```bash
cp .env-local .env
```

and fill required environment variables:

- `FACILITATOR_URL` - Facilitator endpoint URL
- `EVM_ADDRESS` - Ethereum address to receive payments
- `SVM_ADDRESS` - Solana address to receive payments
- `STELLAR_ADDRESS` - Stellar address to receive payments
- `RESOURCE_SERVER_URL` - Your endpoint Base URL
- `ENDPOINT_PATH` - Your route path

2. Install all packages
```bash
cd express-mcp-server
npm install
```

3. Run the server
```bash
npm run dev
```

## Create MCP server and register tools

```typescript
import { ai2walletFetcher, McpServer, z } from 'ai2wallet-sdk/server';

const baseURL = process.env.RESOURCE_SERVER_URL;
const endpointPath = process.env.ENDPOINT_PATH;

const server = new McpServer({
  name: "Ai2wallet x402 MCP Server Demo",
  version: "1.0.0",
});

server.registerTool("get-weather", {
  title: "Get Weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
   location: z.string().describe('City name'),
  })
},
async ({ location }) => {
  const response:any = await ai2walletFetcher(server,baseURL,endpointPath,{ location });
    return {
      content: [{ type: "text", text: response.data.message }, response.uiResource]
    };
  }
);
```

## Handle Endpoints

```typescript
// Realtime Bidirectional Communication
app.use('/api/trpc', ai2walletRPC());

// Handle POST requests for client-to-mcpserver communication
app.post('/mcp', async (req, res) => {
  //your code logic here
});

// configure the payment middleware with your routes
app.use(
  paymentMiddleware(
    {
      "GET /your-endpoint": {
        accepts: [
          {
             scheme: "exact",
             price: "$0.001",
             network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
             payTo: svmAddress,
           },
          {
            scheme: "exact",
            price: "$0.3",
            network: "stellar:testnet",
            payTo: stellarAddress,
          },
          {
            scheme: "exact",
            price: "$0.5",
            network: "eip155:84532",
            payTo: evmAddress,
          }
        ],
        description: "Your endpoint description",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

// Then define your routes as normal
app.get("/your-endpoint", (req, res) => {
 res.send({
    message: // your message reponse
    structuredOutput // optional structured output
  })
});
```

**Network identifiers** use [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) format, for example:
- `eip155:84532` — Base Sepolia
- `eip155:8453` — Base Mainnet
- `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` — Solana Devnet
- `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` — Solana Mainnet
- `eip155:1328` — Sei Testnet
- `eip155:1329` — Sei Mainnet
- `eip155:80002` — Polygon Amoy
- `eip155:137` — Polygon Mainnet
- `stellar:testnet` — Stellar Testnet
- `stellar:pubnet` — Stellar Mainnet

## x402ResourceServer Config

The `x402ResourceServer` uses a builder pattern to register payment schemes that declare how payments for each network should be processed: 

```typescript
import { 
  x402ResourceServer, 
  ExactEvmScheme,
  ExactSvmScheme 
  ExactStellarScheme, 
} from 'ai2wallet-sdk/server';

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:*", new ExactEvmScheme())   // All EVM chains
  .register("solana:*", new ExactSvmScheme())   // All SVM chains
  .register("stellar:*", new ExactStellarScheme()) // All STELLAR chains
```

## Facilitator Config

The `HTTPFacilitatorClient` connects to a facilitator service that verifies and settles payments on-chain:

```typescript
import { HTTPFacilitatorClient } from 'ai2wallet-sdk/server';

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
// Or use multiple facilitators for redundancy
const facilitatorClient = [
  new HTTPFacilitatorClient({ url: primaryFacilitatorUrl }),
  new HTTPFacilitatorClient({ url: backupFacilitatorUrl }),
];
```

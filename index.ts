import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import {
  ai2walletFetcher,
  ai2walletRPC,
  ExactEvmScheme,
  ExactStellarScheme,
  ExactSvmScheme,
  HTTPFacilitatorClient,
  isInitializeRequest,
  McpServer,
  paymentMiddleware,
  StreamableHTTPServerTransport,
  x402ResourceServer,
  z
} from 'ai2wallet-sdk/server';

config();

interface GeocodingResponse {
  results: {
    latitude: number;
    longitude: number;
    name: string;
  }[];
}
interface WeatherResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
    weather_code: number;
  };
}

const PORT = process.env.PORT || "4021";

const baseURL = process.env.RESOURCE_SERVER_URL as string; // e.g. https://example.com
const endpointPath = process.env.ENDPOINT_PATH as string; // e.g. /weather*/

//const svmAddress = process.env.SVM_ADDRESS as `0x${string}`;
const evmAddress = process.env.EVM_ADDRESS as `0x${string}`;
const stellarAddress = process.env.STELLAR_ADDRESS as `0x${string}`;

// if (!svmAddress) {
//   console.error("Missing required environment variables");
//   process.exit(1);
// }

if (!evmAddress) {
  console.error("Missing required environment variables");
  process.exit(1);
}

const facilitatorUrl = process.env.FACILITATOR_URL;
if (!facilitatorUrl) {
  console.error("❌ FACILITATOR_URL environment variable is required");
  process.exit(1);
}
const facilitatorClient = new HTTPFacilitatorClient({ 
  url: facilitatorUrl,
  // createAuthHeaders: async () => {
  //   const headers = { Authorization: `Bearer ${process.env.FACILITATOR_API_KEY}` };
  //   return { verify: headers, settle: headers, supported: headers };
  // },
 });

function createServer() {
  const server = new McpServer({
    name: "Ai2wallet x402 MCP Server Demo",
    version: "1.0.0",
  });


  server.registerTool('hello-world', {
    title: 'Hello World',
    description: 'Say hello to someone',
    inputSchema: {
      name: z.string().describe('Name of the person to greet'),
      language: z.enum(['english', 'spanish', 'french']).optional().describe('Language for greeting')
    },
  },
    async ({ name, language = 'english' }) => {
      const greetings = {
        english: `Hello, ${name}! 👋`,
        spanish: `¡Hola, ${name}! 👋`,
        french: `Bonjour, ${name}! 👋`
      };

      const greeting = greetings[language] || greetings.english;

      return {
        content: [
          {
            type: "text",
            text: greeting
          }
        ]
      };
    }
  );

  server.registerTool("get-weather", {
    title: "Get Weather",
    description: "Get current weather for a location",
    inputSchema: z.object({
      location: z.string().describe('City name'),
    })
  },
    async ({ location }) => {
      const response: any = await ai2walletFetcher(server, baseURL, endpointPath, { location });
      return {
        content: [{ type: "text", text: response.data.message }, response.uiResource]
      };
    },
  );

  return server;
}

const app = express();
app.enable('trust proxy');
app.use(function (request, response, next) {
  // Check if not in development mode and the request is not secure (http)
  if (process.env.NODE_ENV !== 'development' && !request.secure) {
    // Check if the 'x-forwarded-proto' header is not 'https'
    if (request.headers['x-forwarded-proto'] !== 'https') {
      return response.redirect('https://' + request.headers.host + request.url);
    }
  }
  next();
});

app.use(express.json());
app.use(
  cors({
    origin: '*',
    allowedHeaders: ["*"],
    exposedHeaders: ['*']
  })
);

app.use('/api/trpc', ai2walletRPC());

// Map to store transports by session ID
// Store transports for each session type
const transports = {
  streamable: {} as Record<string, StreamableHTTPServerTransport>
};

// Handle POST requests for client-to-server communication
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  console.log("new created session with id", sessionId);
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.streamable[sessionId]) {
    // Reuse existing transport
    transport = transports.streamable[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    const server = createServer();
    // New initialization request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport by session ID
        transports.streamable[sessionId] = transport;
      }
    });

    // Clean up transport when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports.streamable[transport.sessionId];
      }
    };
    // Connect to the MCP server
    await server.connect(transport);
  } else {
    // Invalid request
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: No valid session ID provided',
      },
      id: null,
    });
    return;
  }
  // Handle the request
  await transport.handleRequest(req, res, req.body);
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.streamable[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  const transport = transports.streamable[sessionId];
  await transport.handleRequest(req, res);
};

// Handle GET requests for server-to-client notifications via SSE
app.get('/mcp', handleSessionRequest);

// Handle DELETE requests for session termination
app.delete('/mcp', handleSessionRequest);

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: [
          // {
          //   scheme: "exact",
          //   price: "$0.001",
          //   network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          //   payTo: svmAddress,
          // },
          {
            scheme: "exact",
            price: "$0.3", // 0.1 tokens
            network: "stellar:testnet",
            payTo: stellarAddress,
          },
          {
            scheme: "exact",
            price: "$0.1", // 0.1 tokens
            network: "eip155:84532",
            payTo: evmAddress,
          },
          {
            scheme: "exact",
            price: "$0.5", // 0.5 tokens
            network: "eip155:1328",
            payTo: evmAddress,
          },
          {
            scheme: "exact",
            price: "$0.1", // 0.1 tokens
            network: "eip155:80002",
            payTo: evmAddress,
          },
        ],
        description: "Weather data",
        mimeType: "application/json",
      },
    },
    new x402ResourceServer(facilitatorClient)
      .register("stellar:testnet", new ExactStellarScheme()) 
      .register("eip155:84532", new ExactEvmScheme()) // Base sepolia
      .register("eip155:1328", new ExactEvmScheme())  // Sei testnet
      .register("eip155:80002", new ExactEvmScheme()) // Polygon amoy
      //.register("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", new ExactSvmScheme())
  ),
);

app.get("/weather", async (req, res) => {
  const location = req.query.location as string
  const structuredOutput = await getWeather(location);
  res.send({
    message: `${structuredOutput.conditions} in ${location} with a temperature of ${structuredOutput.temperature} degrees celsius`,
    structuredOutput
  })
});

const getWeather = async (location: string) => {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const geocodingResponse = await fetch(geocodingUrl);
  const geocodingData = (await geocodingResponse.json()) as GeocodingResponse;

  if (!geocodingData.results?.[0]) {
    throw new Error(`Location '${location}' not found`);
  }

  const { latitude, longitude, name } = geocodingData.results[0];

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`;

  const response = await fetch(weatherUrl);
  const data = (await response.json()) as WeatherResponse;

  return {
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windGust: data.current.wind_gusts_10m,
    conditions: getWeatherCondition(data.current.weather_code),
    location: name,
  };
};

function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return conditions[code] || 'Unknown';
}

app.listen(PORT, () => {
  console.log(` 🚀 Server listening at http://localhost:${PORT}`);
});

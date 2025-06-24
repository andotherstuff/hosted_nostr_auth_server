// ABOUTME: Main Cloudflare Worker with HTTP API routing and JWT authentication
// ABOUTME: Handles auth endpoints and forwards ceremony requests to Durable Objects

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';

import { JWTService, AuthError, AuthErrors, type AuthContext } from './auth/jwt';
import { 
  hashPassword, 
  verifyPassword, 
  generateSalt, 
  validatePasswordStrength,
  type PasswordStrength 
} from './auth/password';
import { getDb, schema } from './db';
import { eq } from 'drizzle-orm';
import { bytesToHex } from '@noble/hashes/utils';
import { 
  AuthLoginSchema, 
  AuthRegisterSchema, 
  CreateKeygenCeremonySchema,
  CreateSigningCeremonySchema,
  SECURITY_HEADERS,
  CORS_HEADERS,
  REQUEST_SIZE_LIMITS 
} from './utils/validation';
import { createHSMFrost, type HSMFrostAdapter } from './hsm/HSMAdapter';

// Environment interface
interface Env {
  DB: D1Database;
  FROST_CEREMONY: DurableObjectNamespace;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  // HSM Configuration
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  AWS_SUBNET_IDS?: string;
  HSM_PROVIDER?: 'aws' | 'google' | 'azure' | 'simulated';
}

// Legacy token validation (keeping for refresh endpoint)
const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

// Create Hono app
const app = new Hono<{ Bindings: Env; Variables: { auth?: AuthContext } }>();

// Middleware
app.use('*', logger());
app.use('*', secureHeaders(SECURITY_HEADERS));
app.use('*', cors({
  origin: ['http://localhost:8787', 'http://localhost:8788', 'https://*.workers.dev'],
  allowMethods: CORS_HEADERS['Access-Control-Allow-Methods'].split(', '),
  allowHeaders: CORS_HEADERS['Access-Control-Allow-Headers'].split(', '),
  credentials: true,
}));

// JWT middleware
const jwtMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  const token = JWTService.extractBearerToken(authHeader);
  
  if (!token) {
    return c.json({ success: false, error: AuthErrors.NO_TOKEN.message }, AuthErrors.NO_TOKEN.status);
  }

  try {
    const jwtService = new JWTService(c.env.JWT_ACCESS_SECRET, c.env.JWT_REFRESH_SECRET);
    const claims = await jwtService.verifyAccessToken(token);
    
    c.set('auth', {
      userId: claims.sub,
      username: claims.username,
      claims,
    } as AuthContext);
    
    await next();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Token verification failed';
    return c.json({ success: false, error: errorMsg }, 401);
  }
};

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// === AUTH ENDPOINTS ===

/**
 * User registration
 */
app.post('/auth/register', async (c) => {
  try {
    let body;
    try {
      body = await c.req.json();
    } catch (jsonError) {
      return c.json({ 
        success: false, 
        error: 'Invalid JSON format' 
      }, 400);
    }
    const validation = AuthRegisterSchema.safeParse(body);
    
    if (!validation.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid input', 
        details: validation.error.issues 
      }, 400);
    }

    const { username, password } = validation.data;

    // Validate password strength
    const passwordStrength = validatePasswordStrength(password);
    if (!passwordStrength.isValid) {
      return c.json({ 
        success: false, 
        error: 'Password too weak', 
        feedback: passwordStrength.feedback 
      }, 400);
    }

    // Generate salt and hash password
    const salt = generateSalt();
    const passwordHash = await hashPassword(password, salt);
    const saltHex = bytesToHex(salt);

    // Store user in database
    const db = getDb(c.env.DB);
    
    try {
      const result = await db.insert(schema.users).values({
        username,
        passwordHash,
        salt: saltHex,
        createdAt: Math.floor(Date.now() / 1000),
      }).returning({ id: schema.users.id });

      console.log(`User ${username} registered with ID: ${result[0]?.id}`);
      
      return c.json({ 
        success: true, 
        data: { message: 'User registered successfully' } 
      });
    } catch (dbError: any) {
      if (dbError.message?.includes('UNIQUE constraint failed')) {
        return c.json({ 
          success: false, 
          error: `Username '${username}' already exists` 
        }, 409);
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ 
      success: false, 
      error: 'Registration failed' 
    }, 500);
  }
});

/**
 * User login
 */
app.post('/auth/login', async (c) => {
  try {
    let body;
    try {
      body = await c.req.json();
    } catch (jsonError) {
      return c.json({ 
        success: false, 
        error: 'Invalid JSON format' 
      }, 400);
    }
    const validation = AuthLoginSchema.safeParse(body);
    
    if (!validation.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid credentials' 
      }, 400);
    }

    const { username, password } = validation.data;

    // Find user
    const db = getDb(c.env.DB);
    const users = await db.select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);
    
    if (users.length === 0) {
      return c.json({ 
        success: false, 
        error: 'Invalid credentials' 
      }, 401);
    }

    const user = users[0];

    // Verify password
    const isValid = await verifyPassword(user.passwordHash, user.salt, password);
    if (!isValid) {
      return c.json({ 
        success: false, 
        error: 'Invalid credentials' 
      }, 401);
    }

    // Generate tokens
    const jwtService = new JWTService(c.env.JWT_ACCESS_SECRET, c.env.JWT_REFRESH_SECRET);
    const { accessToken, refreshToken } = await jwtService.generateTokenPair(
      user.id.toString(), 
      username
    );

    // Set refresh token as secure cookie
    const cookieOptions = JWTService.getRefreshTokenCookieOptions();
    
    return new Response(JSON.stringify({ 
      success: true, 
      data: { 
        accessToken,
        user: { id: user.id, username: user.username }
      } 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `refreshToken=${refreshToken}; ${cookieOptions}`,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ 
      success: false, 
      error: 'Login failed' 
    }, 500);
  }
});

/**
 * Token refresh
 */
app.post('/auth/refresh', async (c) => {
  try {
    // Get refresh token from cookie or body
    const cookieRefreshToken = c.req.header('Cookie')
      ?.split(';')
      .find(cookie => cookie.trim().startsWith('refreshToken='))
      ?.split('=')[1];
    
    const body = await c.req.json().catch(() => ({}));
    const refreshToken = cookieRefreshToken || body.refreshToken;
    
    if (!refreshToken) {
      return c.json({ 
        success: false, 
        error: 'No refresh token provided' 
      }, 401);
    }

    const jwtService = new JWTService(c.env.JWT_ACCESS_SECRET, c.env.JWT_REFRESH_SECRET);
    
    // Verify refresh token
    const claims = await jwtService.verifyRefreshToken(refreshToken);
    
    // Get user info
    const db = getDb(c.env.DB);
    const users = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, parseInt(claims.sub)))
      .limit(1);
    
    if (users.length === 0) {
      return c.json({ 
        success: false, 
        error: 'User not found' 
      }, 404);
    }

    const user = users[0];

    // Generate new token pair
    const { accessToken, refreshToken: newRefreshToken } = await jwtService.generateTokenPair(
      user.id.toString(), 
      user.username
    );

    // Set new refresh token as secure cookie
    const cookieOptions = JWTService.getRefreshTokenCookieOptions();
    
    return new Response(JSON.stringify({ 
      success: true, 
      data: { 
        accessToken,
        user: { id: user.id, username: user.username }
      } 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `refreshToken=${newRefreshToken}; ${cookieOptions}`,
      },
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Token refresh failed';
    return c.json({ 
      success: false, 
      error: errorMsg 
    }, 401);
  }
});

/**
 * Logout
 */
app.post('/auth/logout', jwtMiddleware, async (c) => {
  // Clear refresh token cookie
  return new Response(JSON.stringify({ 
    success: true, 
    data: { message: 'Logged out successfully' } 
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'refreshToken=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/auth',
    },
  });
});

// === CEREMONY ENDPOINTS ===

/**
 * Create a new FROST keygen ceremony
 */
app.post('/ceremony/keygen', jwtMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const validation = CreateKeygenCeremonySchema.safeParse(body);
    
    if (!validation.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid keygen ceremony parameters', 
        details: validation.error.issues 
      }, 400);
    }

    const { threshold, participants } = validation.data;

    // Generate unique operation ID
    const operationId = crypto.randomUUID();

    // Get Durable Object instance
    const doId = c.env.FROST_CEREMONY.idFromName(operationId);
    const doStub = c.env.FROST_CEREMONY.get(doId);

    // Initialize keygen ceremony
    const initRequest = new Request(`https://ceremony/init/keygen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threshold,
        participants,
        maxParticipants: participants.length,
      }),
    });

    const response = await doStub.fetch(initRequest);
    const result = await response.json() as { success?: boolean; [key: string]: any };

    if (result.success) {
      return c.json({ 
        success: true, 
        data: { 
          operationId,
          type: 'keygen',
          status: 'INIT',
          threshold,
          requiredParticipants: participants
        } 
      });
    } else {
      return c.json(result as any, response.status as any);
    }
  } catch (error) {
    console.error('Create ceremony error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to create ceremony' 
    }, 500);
  }
});

/**
 * Create a new FROST signing ceremony
 */
app.post('/ceremony/signing', jwtMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const validation = CreateSigningCeremonySchema.safeParse(body);
    
    if (!validation.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid signing ceremony parameters', 
        details: validation.error.issues 
      }, 400);
    }

    const { message, participants, threshold } = validation.data;

    // Generate unique operation ID
    const operationId = crypto.randomUUID();

    // Get Durable Object instance
    const doId = c.env.FROST_CEREMONY.idFromName(operationId);
    const doStub = c.env.FROST_CEREMONY.get(doId);

    // Initialize signing ceremony
    const initRequest = new Request(`https://ceremony/init/signing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        participants,
        threshold,
      }),
    });

    const response = await doStub.fetch(initRequest);
    const result = await response.json() as { success?: boolean; [key: string]: any };

    if (result.success) {
      return c.json({ 
        success: true, 
        data: { 
          operationId,
          type: 'signing',
          status: 'INIT',
          threshold,
          requiredParticipants: participants,
          message: message.substring(0, 100) + (message.length > 100 ? '...' : '')
        } 
      });
    } else {
      return c.json(result as any, response.status as any);
    }
  } catch (error) {
    console.error('Create signing ceremony error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to create signing ceremony' 
    }, 500);
  }
});

/**
 * Create HSM-backed keygen ceremony (experimental)
 */
app.post('/ceremony/hsm/keygen', jwtMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const validation = CreateKeygenCeremonySchema.safeParse(body);
    
    if (!validation.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid HSM keygen ceremony parameters', 
        details: validation.error.issues 
      }, 400);
    }

    const { threshold, participants } = validation.data;

    // Initialize HSM adapter
    const hsmAdapter = await createHSMFrost({
      hsmProvider: c.env.HSM_PROVIDER || 'simulated',
      fallbackToSoftware: true,
      config: {
        region: c.env.AWS_REGION || 'us-east-1',
        subnetIds: c.env.AWS_SUBNET_IDS?.split(',') || []
      }
    });

    // Create HSM-backed ceremony
    const result = await hsmAdapter.createKeygenCeremony(threshold, participants);
    
    if (result.success) {
      return c.json({ 
        success: true, 
        data: { 
          operationId: result.data.operationId,
          type: 'hsm-keygen',
          threshold,
          participants,
          hsmAttested: result.data.attestation ? true : false,
          attestation: result.data.attestation?.hsmSerial
        } 
      });
    } else {
      return c.json({ 
        success: false, 
        error: result.error 
      }, 400);
    }
  } catch (error) {
    console.error('HSM keygen ceremony error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to create HSM keygen ceremony' 
    }, 500);
  }
});

/**
 * Forward requests to ceremony Durable Object
 */
app.all('/ceremony/:operationId/*', jwtMiddleware, async (c) => {
  try {
    const operationId = c.req.param('operationId');
    const path = c.req.url.split(`/ceremony/${operationId}`)[1];
    const auth = c.get('auth')!;

    // Get Durable Object instance
    const doId = c.env.FROST_CEREMONY.idFromName(operationId);
    const doStub = c.env.FROST_CEREMONY.get(doId);

    // Forward request with auth context
    const forwardedRequest = new Request(`https://ceremony${path}`, {
      method: c.req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': auth.userId,
        'X-Username': auth.username || '',
      },
      body: c.req.method !== 'GET' ? await c.req.text() : undefined,
    });

    const response = await doStub.fetch(forwardedRequest);
    const result = await response.text();

    return new Response(result, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Ceremony request error:', error);
    return c.json({ 
      success: false, 
      error: 'Ceremony request failed' 
    }, 500);
  }
});

// Export the Durable Object
export { FrostCeremonyDO } from './durable-objects/FrostCeremonyDO';

// Static file serving for root path
app.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html>
<head>
    <title>ChusMe Auth Server</title>
    <meta charset="utf-8">
</head>
<body>
    <h1>ChusMe Auth Server</h1>
    <p>NostrPassportServer API is running</p>
    <p>API endpoints:</p>
    <ul>
        <li>POST /auth/register - Register new user</li>
        <li>POST /auth/login - User login</li>
        <li>POST /ceremony/create - Create FROST ceremony</li>
        <li>GET /health - Health check</li>
    </ul>
</body>
</html>`;
  
  return c.html(html);
});

// Handle 404s
app.notFound((c) => {
  return c.json({ success: false, error: 'Not found. This endpoint only handles specific API routes.' }, 404);
});

// WebSocket support for NIP-46 compatibility
const handleWebSocketUpgrade = (request: Request, env: Env): Response => {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();

  // Store user authentication state for this connection
  let authenticatedUserId: number | null = null;

  // NIP-46 message handler
  server.addEventListener('message', (event) => {
    // Handle async processing without async event handler
    (async () => {
      let request: any;
      try {
        request = JSON.parse(event.data as string);
      } catch (error) {
        server.send(JSON.stringify({ id: 'error', error: 'Invalid JSON' }));
        return;
      }

      // Validate request structure
      if (!request.id || !request.method || !Array.isArray(request.params)) {
        server.send(JSON.stringify({ id: request.id, error: 'Invalid request structure' }));
        return;
      }

      const response: { id: string; result?: any; error?: string } = { id: request.id };

      try {
        const db = getDb(env.DB);

        switch (request.method) {
        case 'register':
          const [username, password] = request.params;
          if (!username || !password) {
            response.error = 'Username and password required';
            break;
          }

          // Validate password strength
          const passwordStrength = validatePasswordStrength(password);
          if (!passwordStrength.isValid) {
            response.error = 'Password too weak';
            break;
          }

          // Generate salt and hash password
          const salt = generateSalt();
          const passwordHash = await hashPassword(password, salt);
          const saltHex = bytesToHex(salt);

          try {
            await db.insert(schema.users).values({
              username,
              passwordHash,
              salt: saltHex,
            });
            response.result = 'ok';
          } catch (dbError: any) {
            if (dbError.message?.includes('UNIQUE constraint failed')) {
              response.error = 'Username already exists';
            } else {
              response.error = 'Registration failed';
            }
          }
          break;

        case 'connect':
          const [connUsername, connPassword] = request.params;
          if (!connUsername || !connPassword) {
            response.error = 'Username and password required';
            break;
          }

          // Find user
          const users = await db.select()
            .from(schema.users)
            .where(eq(schema.users.username, connUsername))
            .limit(1);
          
          if (users.length === 0) {
            response.error = 'Invalid credentials';
            break;
          }

          const user = users[0];

          // Verify password
          const isValid = await verifyPassword(user.passwordHash, user.salt, connPassword);
          if (!isValid) {
            response.error = 'Invalid credentials';
            break;
          }

          authenticatedUserId = user.id;
          response.result = 'ack';
          break;

        case 'describe':
          response.result = [
            'connect',
            'get_public_key',
            'sign_event',
            'describe',
            'register',
            'import_key'
          ];
          break;

        case 'get_public_key':
          if (!authenticatedUserId) {
            response.error = 'Not authenticated';
            break;
          }

          const pubKeyRecord = await db.select({ publicKey: schema.users.publicKey })
            .from(schema.users)
            .where(eq(schema.users.id, authenticatedUserId))
            .limit(1);
          
          if (pubKeyRecord.length === 0 || !pubKeyRecord[0].publicKey) {
            response.error = 'Public key not found';
            break;
          }

          response.result = pubKeyRecord[0].publicKey;
          break;

        case 'import_key':
          if (!authenticatedUserId) {
            response.error = 'Not authenticated';
            break;
          }

          const [nsecOrHexKey, importPassword] = request.params;
          if (!nsecOrHexKey || !importPassword) {
            response.error = 'Private key and password required';
            break;
          }

          // For now, just simulate success
          response.result = 'ok';
          break;

        case 'sign_event':
          if (!authenticatedUserId) {
            response.error = 'Not authenticated';
            break;
          }

          // For now, just simulate success
          response.result = 'mock_signature';
          break;

        default:
          response.error = 'Unsupported method';
      }
    } catch (error) {
      console.error(`WebSocket error handling method ${request.method}:`, error);
      response.error = error instanceof Error ? error.message : 'Internal server error';
    }

      server.send(JSON.stringify(response));
    })(); // Close the async wrapper
  });

  server.addEventListener('close', () => {
    console.log(`WebSocket closed for User ID: ${authenticatedUserId}`);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
};

// Main export - temporarily disable WebSocket for debugging
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // TODO: Re-enable WebSocket support after fixing JSON parsing issue
    // if (request.headers.get('Upgrade') === 'websocket') {
    //   return handleWebSocketUpgrade(request, env);
    // }
    
    // Handle HTTP requests with Hono
    return app.fetch(request, env, ctx);
  },
};
// ABOUTME: Durable Object for managing FROST ceremony state and coordination
// ABOUTME: Handles multi-round threshold signature ceremonies with atomic state updates

import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { 
  initializeFrost, 
  createKeygenCeremony, 
  processKeygenRound1, 
  processKeygenRound2,
  createSigningCeremony,
  processSigningRound1,
  processSigningRound2,
  getCeremonyStatus,
  type FrostResult,
  type KeygenState,
  type SigningState
} from '../frost';

// Ceremony state interfaces
interface CeremonyMeta {
  status: 'INIT' | 'KEYGEN_ROUND_1' | 'KEYGEN_ROUND_2' | 'READY' | 'SIGNING_ROUND_1' | 'SIGNING_ROUND_2' | 'COMPLETE' | 'FAILED';
  ceremonyType: 'keygen' | 'signing';
  threshold: number;
  participants: string[];
  requiredParticipants: string[];
  createdAt: number;
  lastActivity: number;
  operationId: string;
}

interface ParticipantData {
  userId: string;
  round1Data?: string;
  round2Data?: string;
  publicKey?: string;
  joinedAt: number;
  lastActivity: number;
}

interface CeremonyConfig {
  threshold: number;
  maxParticipants: number;
  timeoutMs: number;
  message?: string; // For signing ceremonies
}

// Request validation schemas
const JoinCeremonySchema = z.object({
  userId: z.string().min(1),
  username: z.string().optional(),
});

const SubmitRoundDataSchema = z.object({
  userId: z.string().min(1),
  roundNumber: z.number().int().min(1).max(2),
  data: z.string().min(1),
});

const CreateSigningCeremonySchema = z.object({
  message: z.string().min(1),
  participants: z.array(z.string()).min(2),
  threshold: z.number().int().min(2),
});

// Response types
interface CeremonyResponse {
  success: boolean;
  data?: any;
  error?: string;
  status?: string;
}

export class FrostCeremonyDO extends DurableObject {
  private operationId: string;
  private frostInitialized: boolean = false;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.operationId = this.ctx.id.toString();
  }

  private async ensureFrostInitialized(): Promise<void> {
    if (!this.frostInitialized) {
      await initializeFrost();
      this.frostInitialized = true;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    console.log(`FrostCeremonyDO: ${method} ${path} for operation ${this.operationId}`);

    try {
      // Route requests
      if (method === 'GET' && path === '/status') {
        return this.handleGetStatus();
      }
      
      if (method === 'POST' && path === '/init/keygen') {
        return this.handleInitKeygen(request);
      }
      
      if (method === 'POST' && path === '/init/signing') {
        return this.handleInitSigning(request);
      }
      
      if (method === 'POST' && path === '/join') {
        return this.handleJoinCeremony(request);
      }
      
      if (method === 'POST' && path.startsWith('/round/')) {
        const roundNumber = parseInt(path.split('/')[2]);
        return this.handleSubmitRound(request, roundNumber);
      }

      return this.jsonResponse({ success: false, error: 'Not found' }, 404);
    } catch (error) {
      console.error('FrostCeremonyDO error:', error);
      return this.jsonResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal error' 
      }, 500);
    }
  }

  /**
   * Initialize a new key generation ceremony
   */
  private async handleInitKeygen(request: Request): Promise<Response> {
    const body = await request.json() as { threshold?: number; maxParticipants?: number; participants?: string[] };
    const { threshold, maxParticipants, participants } = body;

    if (!threshold || !maxParticipants || threshold > maxParticipants) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Invalid threshold or participant count' 
      }, 400);
    }

    // Check if ceremony already exists
    const existingMeta = await this.ctx.storage.get<CeremonyMeta>('meta');
    if (existingMeta) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Ceremony already initialized' 
      }, 409);
    }

    await this.ensureFrostInitialized();

    // Create FROST keygen state
    const frostResult = createKeygenCeremony(threshold, maxParticipants);
    if (!frostResult.success) {
      return this.jsonResponse({
        success: false,
        error: frostResult.error || 'Failed to create FROST keygen ceremony'
      }, 400);
    }

    // Initialize ceremony state
    const meta: CeremonyMeta = {
      status: 'INIT',
      ceremonyType: 'keygen',
      threshold,
      participants: [],
      requiredParticipants: participants || [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      operationId: this.operationId,
    };

    const config: CeremonyConfig = {
      threshold,
      maxParticipants,
      timeoutMs: 30 * 60 * 1000, // 30 minutes
    };

    // Atomic write
    await this.ctx.storage.put({
      'meta': meta,
      'config': config,
      'keygen_state': JSON.stringify(frostResult.data),
    });

    return this.jsonResponse({ 
      success: true, 
      data: { operationId: this.operationId, status: 'INIT' } 
    });
  }

  /**
   * Initialize a new signing ceremony
   */
  private async handleInitSigning(request: Request): Promise<Response> {
    const body = await request.json();
    const validation = CreateSigningCeremonySchema.safeParse(body);
    
    if (!validation.success) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Invalid request parameters',
        details: validation.error.issues 
      }, 400);
    }

    const { message, participants, threshold } = validation.data;

    // Check if ceremony already exists
    const existingMeta = await this.ctx.storage.get<CeremonyMeta>('meta');
    if (existingMeta) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Ceremony already initialized' 
      }, 409);
    }

    await this.ensureFrostInitialized();

    // Create FROST signing state
    const frostResult = createSigningCeremony(message, participants);
    if (!frostResult.success) {
      return this.jsonResponse({
        success: false,
        error: frostResult.error || 'Failed to create FROST signing ceremony'
      }, 400);
    }

    // Initialize signing ceremony state
    const meta: CeremonyMeta = {
      status: 'INIT',
      ceremonyType: 'signing',
      threshold,
      participants: [],
      requiredParticipants: participants,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      operationId: this.operationId,
    };

    const config: CeremonyConfig = {
      threshold,
      maxParticipants: participants.length,
      timeoutMs: 10 * 60 * 1000, // 10 minutes for signing
      message,
    };

    // Atomic write
    await this.ctx.storage.put({
      'meta': meta,
      'config': config,
      'signing_state': JSON.stringify(frostResult.data),
    });

    return this.jsonResponse({ 
      success: true, 
      data: { operationId: this.operationId, status: 'INIT', requiredParticipants: participants } 
    });
  }

  /**
   * Handle participant joining the ceremony
   */
  private async handleJoinCeremony(request: Request): Promise<Response> {
    const body = await request.json();
    const validation = JoinCeremonySchema.safeParse(body);
    
    if (!validation.success) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Invalid join request' 
      }, 400);
    }

    const { userId, username } = validation.data;

    // Get current state
    const meta = await this.ctx.storage.get<CeremonyMeta>('meta');
    const config = await this.ctx.storage.get<CeremonyConfig>('config');
    
    if (!meta || !config) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Ceremony not initialized' 
      }, 404);
    }

    // Check if already joined
    if (meta.participants.includes(userId)) {
      return this.jsonResponse({ 
        success: true, 
        data: { status: meta.status, message: 'Already joined' } 
      });
    }

    // Check if user is required participant (for signing ceremonies)
    if (meta.ceremonyType === 'signing' && !meta.requiredParticipants.includes(userId)) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Not authorized for this signing ceremony' 
      }, 403);
    }

    // Check capacity
    if (meta.participants.length >= config.maxParticipants) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Ceremony is full' 
      }, 409);
    }

    // Add participant
    const updatedMeta = {
      ...meta,
      participants: [...meta.participants, userId],
      lastActivity: Date.now(),
    };

    const participantData: ParticipantData = {
      userId,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
    };

    // Check if we can start the ceremony
    const canStart = updatedMeta.participants.length >= config.threshold;
    if (canStart && meta.status === 'INIT') {
      updatedMeta.status = meta.ceremonyType === 'keygen' ? 'KEYGEN_ROUND_1' : 'SIGNING_ROUND_1';
    }

    // Atomic write
    await this.ctx.storage.put({
      'meta': updatedMeta,
      [`participant:${userId}`]: participantData,
    });

    return this.jsonResponse({ 
      success: true, 
      data: { 
        status: updatedMeta.status, 
        participantCount: updatedMeta.participants.length,
        canStart 
      } 
    });
  }

  /**
   * Handle round data submission
   */
  private async handleSubmitRound(request: Request, roundNumber: number): Promise<Response> {
    const body = await request.json();
    const validation = SubmitRoundDataSchema.safeParse({
      ...(body as object),
      roundNumber,
    });
    
    if (!validation.success) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Invalid round submission' 
      }, 400);
    }

    const { userId, data } = validation.data;

    // Get current state
    const meta = await this.ctx.storage.get<CeremonyMeta>('meta');
    const participantData = await this.ctx.storage.get<ParticipantData>(`participant:${userId}`);
    
    if (!meta || !participantData) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Participant not found in ceremony' 
      }, 404);
    }

    // Validate state transition
    const expectedStatus = this.getExpectedStatus(meta.ceremonyType, roundNumber);
    if (meta.status !== expectedStatus) {
      return this.jsonResponse({ 
        success: false, 
        error: `Wrong ceremony state. Expected ${expectedStatus}, got ${meta.status}` 
      }, 409);
    }

    // Check for duplicate submission (idempotency)
    const roundDataKey = `round${roundNumber}Data` as keyof ParticipantData;
    if (participantData[roundDataKey]) {
      return this.jsonResponse({ 
        success: true, 
        data: { 
          status: meta.status, 
          message: 'Data already submitted for this round',
          result: participantData[roundDataKey] 
        } 
      });
    }

    // Process the round data with WASM (mock for now)
    const result = await this.processRoundData(meta, roundNumber, userId, data);
    
    if (!result.success) {
      return this.jsonResponse(result, 400);
    }

    // Update participant data
    const updatedParticipantData = {
      ...participantData,
      [roundDataKey]: result.data.participantResult,
      lastActivity: Date.now(),
    };

    // Collect round 1 packages for use in round 2
    const updateData: Record<string, any> = {
      'meta': { ...meta, lastActivity: Date.now() },
      [`participant:${userId}`]: updatedParticipantData,
    };

    if (roundNumber === 1) {
      // Store the round 1 package for later use
      const currentPackages = await this.ctx.storage.get<Record<string, string>>('round1_packages') || {};
      currentPackages[userId] = result.data.participantResult;
      updateData['round1_packages'] = currentPackages;
    }

    // Check if round is complete
    const roundComplete = await this.checkRoundComplete(meta, roundNumber);
    if (roundComplete) {
      const nextStatus = this.getNextStatus(meta.status);
      updateData['meta'] = { ...updateData['meta'], status: nextStatus as typeof meta.status };
    }

    // Atomic write
    await this.ctx.storage.put(updateData);

    return this.jsonResponse({ 
      success: true, 
      data: { 
        status: updateData['meta'].status,
        result: result.data.participantResult,
        roundComplete,
        finalResult: result.data.finalResult 
      } 
    });
  }

  /**
   * Get ceremony status
   */
  private async handleGetStatus(): Promise<Response> {
    const meta = await this.ctx.storage.get<CeremonyMeta>('meta');
    const config = await this.ctx.storage.get<CeremonyConfig>('config');
    
    if (!meta) {
      return this.jsonResponse({ 
        success: false, 
        error: 'Ceremony not found' 
      }, 404);
    }

    return this.jsonResponse({ 
      success: true, 
      data: {
        operationId: this.operationId,
        status: meta.status,
        ceremonyType: meta.ceremonyType,
        participantCount: meta.participants.length,
        threshold: config?.threshold,
        createdAt: meta.createdAt,
        lastActivity: meta.lastActivity,
      } 
    });
  }

  /**
   * Process round data using FROST WASM module
   */
  private async processRoundData(
    meta: CeremonyMeta, 
    roundNumber: number, 
    userId: string, 
    data: string
  ): Promise<CeremonyResponse> {
    await this.ensureFrostInitialized();
    
    try {
      // Get current FROST state from storage
      const frostStateKey = meta.ceremonyType === 'keygen' ? 'keygen_state' : 'signing_state';
      const frostState = await this.ctx.storage.get<string>(frostStateKey);
      
      if (!frostState) {
        return {
          success: false,
          error: 'FROST ceremony state not found'
        };
      }

      let result: FrostResult<any>;
      let participantResult: string;
      let finalResult: any = null;

      if (meta.ceremonyType === 'keygen') {
        if (roundNumber === 1) {
          result = processKeygenRound1(frostState, userId);
          if (result.success && result.data) {
            const [newState, package_] = result.data;
            await this.ctx.storage.put('keygen_state', JSON.stringify(newState));
            participantResult = package_;
          } else {
            return { success: false, error: result.error || 'Keygen round 1 failed' };
          }
        } else if (roundNumber === 2) {
          // For round 2, we need the collected round 1 packages
          const round1Packages = await this.ctx.storage.get<Record<string, string>>('round1_packages') || {};
          result = processKeygenRound2(frostState, userId, JSON.stringify(round1Packages));
          if (result.success && result.data) {
            const [newState, keyPackage] = result.data;
            await this.ctx.storage.put('keygen_state', JSON.stringify(newState));
            participantResult = keyPackage;
            
            // Check if ceremony is complete
            if (newState.group_public_key) {
              finalResult = newState.group_public_key;
            }
          } else {
            return { success: false, error: result.error || 'Keygen round 2 failed' };
          }
        } else {
          return { success: false, error: `Invalid round number for keygen: ${roundNumber}` };
        }
      } else {
        // Signing ceremony
        if (roundNumber === 1) {
          result = processSigningRound1(frostState, userId, data); // data should be key package
          if (result.success && result.data) {
            const [newState, nonces] = result.data;
            await this.ctx.storage.put('signing_state', JSON.stringify(newState));
            participantResult = nonces;
          } else {
            return { success: false, error: result.error || 'Signing round 1 failed' };
          }
        } else if (roundNumber === 2) {
          // For round 2, we need the collected round 1 packages (nonces)
          const round1Packages = await this.ctx.storage.get<Record<string, string>>('round1_packages') || {};
          result = processSigningRound2(frostState, userId, data, JSON.stringify(round1Packages));
          if (result.success && result.data) {
            const [newState, signature] = result.data;
            await this.ctx.storage.put('signing_state', JSON.stringify(newState));
            participantResult = 'signature_share_submitted';
            
            // Check if ceremony is complete
            if (signature) {
              finalResult = signature;
            }
          } else {
            return { success: false, error: result.error || 'Signing round 2 failed' };
          }
        } else {
          return { success: false, error: `Invalid round number for signing: ${roundNumber}` };
        }
      }

      return {
        success: true,
        data: {
          participantResult,
          finalResult,
        },
      };
    } catch (error) {
      console.error('FROST processing error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'FROST processing failed'
      };
    }
  }

  /**
   * Check if the current round is complete
   */
  private async checkRoundComplete(meta: CeremonyMeta, roundNumber: number): Promise<boolean> {
    const roundDataKey = `round${roundNumber}Data`;
    let completedCount = 0;

    // Check each participant
    for (const participantId of meta.participants) {
      const participantData = await this.ctx.storage.get<ParticipantData>(`participant:${participantId}`);
      if (participantData && participantData[roundDataKey as keyof ParticipantData]) {
        completedCount++;
      }
    }

    return completedCount >= meta.threshold;
  }

  /**
   * Helper methods for state management
   */
  private getExpectedStatus(ceremonyType: 'keygen' | 'signing', roundNumber: number): string {
    if (ceremonyType === 'keygen') {
      return roundNumber === 1 ? 'KEYGEN_ROUND_1' : 'KEYGEN_ROUND_2';
    } else {
      return roundNumber === 1 ? 'SIGNING_ROUND_1' : 'SIGNING_ROUND_2';
    }
  }

  private getNextStatus(currentStatus: string): string {
    const statusMap: Record<string, string> = {
      'KEYGEN_ROUND_1': 'KEYGEN_ROUND_2',
      'KEYGEN_ROUND_2': 'READY',
      'SIGNING_ROUND_1': 'SIGNING_ROUND_2',
      'SIGNING_ROUND_2': 'COMPLETE',
    };
    return statusMap[currentStatus] || currentStatus;
  }

  private jsonResponse(data: any, status: number = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
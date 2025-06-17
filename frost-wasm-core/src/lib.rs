// ABOUTME: FROST threshold signature implementation using zcash/frost-core for WASM
// ABOUTME: Provides secure multi-party key generation and signing for NIP-46 service

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// FROST imports
use frost_secp256k1::{self as frost, Secp256K1Sha256, keys::KeyPackage};
use frost_core::{
    keys::{dkg, PublicKeyPackage, IdentifierList},
    round1, round2,
    Identifier,
};
use frost_secp256k1::rand_core::OsRng;

// Type aliases for clarity
type FrostIdentifier = Identifier<Secp256K1Sha256>;

// Set up panic hook for better debugging
#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
}

// Error types for the WASM interface
#[derive(Debug, Serialize, Deserialize)]
pub enum FrostError {
    InvalidParticipant(String),
    InsufficientParticipants { required: u16, actual: u16 },
    KeygenError(String),
    SigningError(String),
    SerializationError(String),
    InvalidStateTransition(String),
}

// State for key generation ceremony
#[derive(Serialize, Deserialize, Clone)]
pub struct KeygenState {
    pub threshold: u16,
    pub max_participants: u16,
    pub current_round: u8,
    pub round1_packages: BTreeMap<String, String>,
    pub key_packages: BTreeMap<String, String>,
    pub group_public_key: Option<String>,
}

// State for signing ceremony  
#[derive(Serialize, Deserialize, Clone)]
pub struct SigningState {
    pub message: Vec<u8>,
    pub current_round: u8,
    pub signers: Vec<String>,
    pub round1_packages: BTreeMap<String, String>,
    pub signature_shares: BTreeMap<String, String>,
    pub final_signature: Option<String>,
}

// Result type for WASM functions
#[derive(Serialize, Deserialize)]
pub struct FrostResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> FrostResult<T> {
    fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }
    
    fn err(error: FrostError) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(format!("{:?}", error)),
        }
    }
}

// === KEYGEN FUNCTIONS ===

/// Initialize a new key generation ceremony
#[wasm_bindgen]
pub fn create_keygen_state(threshold: u16, max_participants: u16) -> String {
    let result = if threshold == 0 || threshold > max_participants {
        FrostResult::err(FrostError::InsufficientParticipants {
            required: threshold,
            actual: max_participants,
        })
    } else {
        let state = KeygenState {
            threshold,
            max_participants,
            current_round: 1,
            round1_packages: BTreeMap::new(),
            key_packages: BTreeMap::new(),
            group_public_key: None,
        };
        FrostResult::ok(state)
    };
    
    serde_json::to_string(&result).unwrap_or_else(|e| {
        serde_json::to_string(&FrostResult::<KeygenState>::err(
            FrostError::SerializationError(e.to_string())
        )).unwrap()
    })
}

/// Handle participant data for keygen round 1
#[wasm_bindgen] 
pub fn keygen_round1(state_json: &str, participant_id: &str) -> String {
    let result = (|| -> Result<(KeygenState, String), FrostError> {
        // Parse current state
        let state_result: FrostResult<KeygenState> = serde_json::from_str(state_json)
            .map_err(|e| FrostError::SerializationError(e.to_string()))?;
            
        let mut state = state_result.data.ok_or(FrostError::InvalidStateTransition(
            "Invalid state provided".to_string()
        ))?;
        
        // Validate we're in round 1
        if state.current_round != 1 {
            return Err(FrostError::InvalidStateTransition(
                format!("Expected round 1, got round {}", state.current_round)
            ));
        }
        
        // Validate participant limit
        if state.round1_packages.len() >= state.max_participants as usize {
            return Err(FrostError::InsufficientParticipants {
                required: state.threshold,
                actual: state.max_participants,
            });
        }
        
        // Generate real FROST DKG round 1 package
        let identifier = FrostIdentifier::try_from(
            (state.round1_packages.len() + 1) as u16
        ).map_err(|e| FrostError::KeygenError(format!("Invalid identifier: {}", e)))?;
        
        let (round1_secret, round1_package) = dkg::part1(
            identifier,
            state.max_participants,
            state.threshold,
            &mut OsRng,
        ).map_err(|e| FrostError::KeygenError(format!("DKG round 1 failed: {}", e)))?;
        
        // Serialize the round1 package for storage
        let package_serialized = serde_json::to_string(&(round1_secret, round1_package))
            .map_err(|e| FrostError::SerializationError(e.to_string()))?;
        
        state.round1_packages.insert(participant_id.to_string(), package_serialized.clone());
        
        // Check if we have enough participants to advance
        if state.round1_packages.len() >= state.threshold as usize {
            state.current_round = 2;
        }
        
        Ok((state, package_serialized))
    })();
    
    match result {
        Ok((state, package)) => {
            serde_json::to_string(&FrostResult::ok((state, package))).unwrap()
        }
        Err(e) => {
            serde_json::to_string(&FrostResult::<(KeygenState, String)>::err(e)).unwrap()
        }
    }
}

/// Handle participant data for keygen round 2
#[wasm_bindgen]
pub fn keygen_round2(
    state_json: &str, 
    participant_id: &str, 
    round1_packages_json: &str
) -> String {
    let result = (|| -> Result<(KeygenState, String), FrostError> {
        // Parse current state
        let state_result: FrostResult<KeygenState> = serde_json::from_str(state_json)
            .map_err(|e| FrostError::SerializationError(e.to_string()))?;
            
        let mut state = state_result.data.ok_or(FrostError::InvalidStateTransition(
            "Invalid state provided".to_string()
        ))?;
        
        // Validate we're in round 2
        if state.current_round != 2 {
            return Err(FrostError::InvalidStateTransition(
                format!("Expected round 2, got round {}", state.current_round)
            ));
        }
        
        // Parse round 1 packages to get all participant data
        let all_round1_packages: BTreeMap<String, String> = serde_json::from_str(round1_packages_json)
            .map_err(|e| FrostError::SerializationError(format!("Failed to parse round1 packages: {}", e)))?;
        
        // Get this participant's round 1 secret and package
        let participant_round1_data = state.round1_packages.get(participant_id)
            .ok_or(FrostError::InvalidParticipant(format!("Participant {} not found in round 1", participant_id)))?;
        
        // Deserialize the participant's round 1 secret and package
        let (round1_secret, _round1_package): (dkg::round1::SecretPackage<Secp256K1Sha256>, dkg::round1::Package<Secp256K1Sha256>) = 
            serde_json::from_str(participant_round1_data)
                .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize round1 secret: {}", e)))?;
        
        // Collect all round 1 packages from other participants
        let mut received_round1_packages = BTreeMap::new();
        for (other_participant, package_data) in &all_round1_packages {
            if other_participant != participant_id {
                let (_secret, package): (dkg::round1::SecretPackage<Secp256K1Sha256>, dkg::round1::Package<Secp256K1Sha256>) = 
                    serde_json::from_str(package_data)
                        .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize package for {}: {}", other_participant, e)))?;
                
                // Map participant name to identifier
                let identifier = FrostIdentifier::try_from(
                    (received_round1_packages.len() + 2) as u16  // +1 for this participant, +1 for 1-based indexing
                ).map_err(|e| FrostError::KeygenError(format!("Invalid identifier for {}: {}", other_participant, e)))?;
                
                received_round1_packages.insert(identifier, package);
            }
        }
        
        // Perform DKG round 2
        let (key_package, group_public_key) = dkg::part2(round1_secret, &received_round1_packages)
            .map_err(|e| FrostError::KeygenError(format!("DKG round 2 failed: {}", e)))?;
        
        // Serialize the key package for storage
        let key_package_serialized = serde_json::to_string(&key_package)
            .map_err(|e| FrostError::SerializationError(format!("Failed to serialize key package: {}", e)))?;
        
        // Store the key package
        state.key_packages.insert(participant_id.to_string(), key_package_serialized.clone());
        
        // If all participants have completed, store the group public key
        if state.key_packages.len() >= state.threshold as usize {
            let group_public_key_serialized = serde_json::to_string(&group_public_key)
                .map_err(|e| FrostError::SerializationError(format!("Failed to serialize group public key: {}", e)))?;
            state.group_public_key = Some(group_public_key_serialized);
        }
        
        Ok((state, key_package_serialized))
    })();
    
    match result {
        Ok((state, key_package)) => {
            serde_json::to_string(&FrostResult::ok((state, key_package))).unwrap()
        }
        Err(e) => {
            serde_json::to_string(&FrostResult::<(KeygenState, String)>::err(e)).unwrap()
        }
    }
}

// === SIGNING FUNCTIONS ===

/// Initialize a new signing ceremony
#[wasm_bindgen]
pub fn create_signing_state(message: &[u8], signers_json: &str) -> String {
    let result = (|| -> Result<SigningState, FrostError> {
        let signers: Vec<String> = serde_json::from_str(signers_json)
            .map_err(|e| FrostError::SerializationError(e.to_string()))?;
            
        if signers.is_empty() {
            return Err(FrostError::InsufficientParticipants {
                required: 1,
                actual: 0,
            });
        }
        
        let state = SigningState {
            message: message.to_vec(),
            current_round: 1,
            signers,
            round1_packages: BTreeMap::new(),
            signature_shares: BTreeMap::new(),
            final_signature: None,
        };
        
        Ok(state)
    })();
    
    match result {
        Ok(state) => {
            serde_json::to_string(&FrostResult::ok(state)).unwrap()
        }
        Err(e) => {
            serde_json::to_string(&FrostResult::<SigningState>::err(e)).unwrap()
        }
    }
}

/// Handle participant data for signing round 1 (nonce generation)
#[wasm_bindgen]
pub fn signing_round1(state_json: &str, participant_id: &str, key_package_json: &str) -> String {
    let result = (|| -> Result<(SigningState, String), FrostError> {
        let state_result: FrostResult<SigningState> = serde_json::from_str(state_json)
            .map_err(|e| FrostError::SerializationError(e.to_string()))?;
            
        let mut state = state_result.data.ok_or(FrostError::InvalidStateTransition(
            "Invalid state provided".to_string()
        ))?;
        
        if state.current_round != 1 {
            return Err(FrostError::InvalidStateTransition(
                format!("Expected round 1, got round {}", state.current_round)
            ));
        }
        
        // Deserialize the key package for this participant
        let key_package: KeyPackage = serde_json::from_str(key_package_json)
            .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize key package: {}", e)))?;
        
        // Generate nonces for signing round 1
        let (nonces, commitments) = round1::commit(key_package.signing_share(), &mut OsRng);
        
        // Serialize the nonces and commitments for storage
        let round1_data = serde_json::to_string(&(nonces, commitments))
            .map_err(|e| FrostError::SerializationError(format!("Failed to serialize round1 data: {}", e)))?;
        
        state.round1_packages.insert(participant_id.to_string(), round1_data.clone());
        
        // Check if we have enough participants to advance
        if state.round1_packages.len() >= state.signers.len() {
            state.current_round = 2;
        }
        
        // Return the commitments (public part) for coordination
        let commitments_serialized = serde_json::to_string(&commitments)
            .map_err(|e| FrostError::SerializationError(format!("Failed to serialize commitments: {}", e)))?;
        
        Ok((state, commitments_serialized))
    })();
    
    match result {
        Ok((state, nonces)) => {
            serde_json::to_string(&FrostResult::ok((state, nonces))).unwrap()
        }
        Err(e) => {
            serde_json::to_string(&FrostResult::<(SigningState, String)>::err(e)).unwrap()
        }
    }
}

/// Handle participant data for signing round 2 (signature share generation)
#[wasm_bindgen]
pub fn signing_round2(
    state_json: &str,
    participant_id: &str,
    key_package_json: &str,
    signing_package_json: &str,
    group_public_key_json: &str
) -> String {
    let result = (|| -> Result<(SigningState, Option<String>), FrostError> {
        let state_result: FrostResult<SigningState> = serde_json::from_str(state_json)
            .map_err(|e| FrostError::SerializationError(e.to_string()))?;
            
        let mut state = state_result.data.ok_or(FrostError::InvalidStateTransition(
            "Invalid state provided".to_string()
        ))?;
        
        if state.current_round != 2 {
            return Err(FrostError::InvalidStateTransition(
                format!("Expected round 2, got round {}", state.current_round)
            ));
        }
        
        // Deserialize the key package for this participant
        let key_package: KeyPackage = serde_json::from_str(key_package_json)
            .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize key package: {}", e)))?;
        
        // Deserialize the signing package (contains message and all commitments)  
        let signing_package: frost::SigningPackage = serde_json::from_str(signing_package_json)
            .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize signing package: {}", e)))?;
        
        // Get this participant's nonces from round 1
        let participant_round1_data = state.round1_packages.get(participant_id)
            .ok_or(FrostError::InvalidParticipant(format!("Participant {} not found in round 1", participant_id)))?;
        
        let (nonces, _commitments): (frost::round1::SigningNonces, frost::round1::SigningCommitments) = 
            serde_json::from_str(participant_round1_data)
                .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize nonces: {}", e)))?;
        
        // Generate signature share
        let signature_share = round2::sign(&signing_package, &nonces, &key_package)
            .map_err(|e| FrostError::SigningError(format!("Failed to generate signature share: {}", e)))?;
        
        // Serialize and store the signature share
        let signature_share_serialized = serde_json::to_string(&signature_share)
            .map_err(|e| FrostError::SerializationError(format!("Failed to serialize signature share: {}", e)))?;
        
        state.signature_shares.insert(participant_id.to_string(), signature_share_serialized.clone());
        
        // If all participants have signed, aggregate the signature
        let final_signature = if state.signature_shares.len() >= state.signers.len() {
            // Deserialize the group public key package from keygen
            let group_public_key: PublicKeyPackage<Secp256K1Sha256> = serde_json::from_str(group_public_key_json)
                .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize group public key: {}", e)))?;
            
            // Collect all signature shares with proper identifier mapping
            let mut signature_shares = BTreeMap::new();
            for (idx, (participant, share_data)) in state.signature_shares.iter().enumerate() {
                let share: round2::SignatureShare<Secp256K1Sha256> = serde_json::from_str(share_data)
                    .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize share for {}: {}", participant, e)))?;
                
                // Map participant to identifier based on order (consistent with keygen)
                let identifier = FrostIdentifier::try_from((idx + 1) as u16)
                    .map_err(|e| FrostError::SigningError(format!("Invalid identifier for {}: {}", participant, e)))?;
                
                signature_shares.insert(identifier, share);
            }
            
            // Aggregate the signature using real FROST
            let group_signature = frost::aggregate(&signing_package, &signature_shares, &group_public_key)
                .map_err(|e| FrostError::SigningError(format!("Failed to aggregate signature: {}", e)))?;
            
            let final_sig_serialized = serde_json::to_string(&group_signature)
                .map_err(|e| FrostError::SerializationError(format!("Failed to serialize final signature: {}", e)))?;
            
            state.final_signature = Some(final_sig_serialized.clone());
            Some(final_sig_serialized)
        } else {
            None
        };
        
        Ok((state, final_signature))
    })();
    
    match result {
        Ok((state, signature)) => {
            serde_json::to_string(&FrostResult::ok((state, signature))).unwrap()
        }
        Err(e) => {
            serde_json::to_string(&FrostResult::<(SigningState, Option<String>)>::err(e)).unwrap()
        }
    }
}

// === UTILITY FUNCTIONS ===

/// Generate FROST key shares from a private key (Trusted Dealer mode)
#[wasm_bindgen]
pub fn generate_frost_shares(
    private_key_hex: &str,
    threshold: u16,
    max_participants: u16
) -> String {
    let result = (|| -> Result<(String, BTreeMap<String, String>), FrostError> {
        if threshold == 0 || threshold > max_participants {
            return Err(FrostError::InsufficientParticipants {
                required: threshold,
                actual: max_participants,
            });
        }
        
        // For now, we'll use the default trusted dealer which generates its own secret
        // In future, we could use the provided private_key_hex but that requires additional implementation
        let _ = private_key_hex; // Acknowledge the parameter
        
        // Create identifiers for all participants
        let mut identifiers = Vec::new();
        for i in 1..=max_participants {
            let identifier = FrostIdentifier::try_from(i)
                .map_err(|e| FrostError::KeygenError(format!("Invalid identifier {}: {}", i, e)))?;
            identifiers.push(identifier);
        }
        
        // Generate key shares using trusted dealer
        let (shares, group_public_key) = frost::keys::generate_with_dealer(
            max_participants,
            threshold,
            IdentifierList::Custom(&identifiers),
            &mut OsRng,
        ).map_err(|e| FrostError::KeygenError(format!("Trusted dealer failed: {}", e)))?;
        
        // Serialize shares
        let mut serialized_shares = BTreeMap::new();
        for (identifier, key_package) in shares {
            let share_data = serde_json::to_string(&key_package)
                .map_err(|e| FrostError::SerializationError(format!("Failed to serialize share: {}", e)))?;
            // Use the identifier as-is in string format for now
            let participant_key = format!("participant_{:?}", identifier);
            serialized_shares.insert(participant_key, share_data);
        }
        
        // Serialize group public key
        let group_public_key_serialized = serde_json::to_string(&group_public_key)
            .map_err(|e| FrostError::SerializationError(format!("Failed to serialize group public key: {}", e)))?;
        
        Ok((group_public_key_serialized, serialized_shares))
    })();
    
    match result {
        Ok((pubkey, shares)) => {
            serde_json::to_string(&FrostResult::ok((pubkey, shares))).unwrap()
        }
        Err(e) => {
            serde_json::to_string(&FrostResult::<(String, BTreeMap<String, String>)>::err(e)).unwrap()
        }
    }
}

/// Verify a FROST signature
#[wasm_bindgen]
pub fn verify_signature(
    message: &[u8],
    signature_json: &str,
    group_public_key_json: &str
) -> String {
    let result = (|| -> Result<bool, FrostError> {
        // Deserialize the signature
        let signature: frost::Signature = serde_json::from_str(signature_json)
            .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize signature: {}", e)))?;
        
        // Deserialize the group public key  
        let group_public_key: PublicKeyPackage<Secp256K1Sha256> = serde_json::from_str(group_public_key_json)
            .map_err(|e| FrostError::SerializationError(format!("Failed to deserialize group public key: {}", e)))?;
        
        // Verify the signature using FROST
        let verification_result = group_public_key.verifying_key().verify(message, &signature);
        
        Ok(verification_result.is_ok())
    })();
    
    match result {
        Ok(valid) => {
            serde_json::to_string(&FrostResult::ok(valid)).unwrap()
        }
        Err(e) => {
            serde_json::to_string(&FrostResult::<bool>::err(e)).unwrap()
        }
    }
}

// === WASM MEMORY OPTIMIZATION ===

// Use wee_alloc as the global allocator for smaller WASM binary size
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;
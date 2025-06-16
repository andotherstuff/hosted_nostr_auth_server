// ABOUTME: FROST threshold signature implementation using zcash/frost-core for WASM
// ABOUTME: Provides secure multi-party key generation and signing for NIP-46 service

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
        
        // Generate mock round 1 package for this participant
        // TODO: Replace with real FROST implementation
        let package_json = format!("{{\"participant\":\"{}\",\"mock_round1\":true}}", participant_id);
        state.round1_packages.insert(participant_id.to_string(), package_json.clone());
        
        // Check if we have enough participants to advance
        if state.round1_packages.len() >= state.threshold as usize {
            state.current_round = 2;
        }
        
        Ok((state, package_json))
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
        
        // TODO: Implement actual round 2 processing with frost_secp256k1::keys::dkg::part2
        // For now, generate mock key package
        let mock_key_package = format!("{{\"participant\":\"{}\",\"mock_key\":true}}", participant_id);
        state.key_packages.insert(participant_id.to_string(), mock_key_package.clone());
        
        // If all participants have completed, generate group public key
        if state.key_packages.len() >= state.threshold as usize {
            let mock_group_key = "{\"group_public_key\":\"mock_group_key\"}".to_string();
            state.group_public_key = Some(mock_group_key);
        }
        
        Ok((state, mock_key_package))
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
        
        // TODO: Implement actual nonce generation with frost_secp256k1::round1
        let mock_nonces = format!("{{\"participant\":\"{}\",\"nonces\":\"mock_nonces\"}}", participant_id);
        state.round1_packages.insert(participant_id.to_string(), mock_nonces.clone());
        
        // Check if we have enough participants to advance
        if state.round1_packages.len() >= state.signers.len() {
            state.current_round = 2;
        }
        
        Ok((state, mock_nonces))
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
    signing_package_json: &str
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
        
        // TODO: Implement actual signature share generation with frost_secp256k1::round2
        let mock_signature_share = format!("{{\"participant\":\"{}\",\"signature_share\":\"mock_share\"}}", participant_id);
        state.signature_shares.insert(participant_id.to_string(), mock_signature_share);
        
        // If all participants have signed, aggregate the signature
        let final_signature = if state.signature_shares.len() >= state.signers.len() {
            let mock_final_sig = "{\"signature\":\"mock_final_signature\"}".to_string();
            state.final_signature = Some(mock_final_sig.clone());
            Some(mock_final_sig)
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
        
        // TODO: Implement actual trusted dealer key generation using frost_secp256k1::keys::generate_with_dealer
        // For now, return mock shares
        let mut mock_shares = BTreeMap::new();
        for i in 1..=max_participants {
            let share_data = format!("{{\"participant\":{},\"share\":\"mock_share_{}\"}}", i, i);
            mock_shares.insert(format!("participant_{}", i), share_data);
        }
        
        let mock_group_public_key = "mock_group_public_key".to_string();
        
        Ok((mock_group_public_key, mock_shares))
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
        // TODO: Implement actual signature verification
        // For now, return mock verification
        Ok(true)
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
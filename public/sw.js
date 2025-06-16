// public/sw.js - Service Worker

console.log('Service Worker loading...');

// Install event - happens once when the SW is first registered
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  // Optional: Pre-cache assets here if needed
  // event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
  self.skipWaiting(); // Force the waiting SW to become the active SW
});

// Activate event - happens after install, or when a new SW takes over
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  // Optional: Clean up old caches here
  // event.waitUntil(clients.claim()); // Take control of uncontrolled clients immediately
});

// Fetch event - intercepts network requests from the page
self.addEventListener('fetch', (event) => {
  // console.log('Service Worker fetching:', event.request.url);
  // For now, just pass through requests. Later, could implement caching strategies.
  // event.respondWith(fetch(event.request));
});

// Message event - Listens for messages from the main page or potentially the CF Worker (via Client postMessage)
self.addEventListener('message', (event) => {
  console.log('Service Worker received message:', event.data);

  // TODO: Implement logic to handle requests from the CF Worker
  // This is where NIP-46 commands like 'get_public_key' or 'sign_event' 
  // would be processed, likely involving communication back to the main page 
  // to get the passphrase and perform crypto operations.

  // Example response structure (needs actual implementation)
  if (event.data && event.data.action === 'sign_request') {
    const clientId = event.source.id; // Get the client (Window or Worker) ID
    console.log(`Processing sign request for client: ${clientId}`);
    // Simulate processing and responding
    // const result = performSigning(event.data.payload);
    // event.source.postMessage({ result: result, originalAction: event.data.action });
  }
});

console.log('Service Worker loaded.');

self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  // TODO: Handle push notifications to wake up for signing requests
  const title = 'Nostr Sign Request';
  const options = {
    body: 'You have a new signing request.',
    // icon: 'images/icon.png',
    // badge: 'images/badge.png'
  };
  // Example: Show a notification
  // event.waitUntil(self.registration.showNotification(title, options));
});

// TODO: Add NIP-46 message handling logic here
// This would involve: 
// - Receiving messages (potentially via Push or other means)
// - Accessing IndexedDB for the encrypted key
// - Prompting user for passphrase (if needed, potentially via Client API)
// - Decrypting the key
// - Performing the signing operation (using imported crypto libraries)
// - Sending the response back 
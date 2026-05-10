// Set the backend API host when the frontend is served separately from the API.
// For local dev with `node server.js`, leave this as an empty string.
window.EVIL_API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "" : "https://evil-startups.onrender.com";

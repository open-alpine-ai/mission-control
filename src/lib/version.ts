// Single source of truth for the application version.
// Reads from package.json at build time so every consumer
// (header, websocket handshake, API routes) stays in sync.
import pkg from '../../package.json'

export const APP_VERSION: string = pkg.version

// UI-facing display version (e.g. 1.41 instead of 1.41.0)
export const APP_VERSION_DISPLAY: string = APP_VERSION.replace(/\.0$/, '')

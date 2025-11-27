/**
 * Shared configuration for Media Archiver extension
 * Single source of truth for server URL and settings
 */

const CONFIG = {
  // Server connection
  SERVER_URL: 'http://localhost:8888',

  // Endpoints
  ENDPOINTS: {
    health: '/health',
    archive: '/archive',
    archiveImage: '/archive-image',
    jobs: '/jobs',
    stats: '/stats'
  },

  // Timeouts (ms)
  TIMEOUTS: {
    healthCheck: 5000,
    archive: 30000,
    imageArchive: 60000
  },

  // Health check interval (ms)
  HEALTH_CHECK_INTERVAL: 5000,

  // Image size thresholds
  IMAGE: {
    MIN_WIDTH: 200,
    MIN_HEIGHT: 200,
    LARGE_MIN_WIDTH: 400,
    LARGE_MIN_HEIGHT: 400
  },

  // Save modes
  SAVE_MODES: {
    FULL: 'full',      // Media + screenshot + metadata
    QUICK: 'quick',    // Media only
    TEXT: 'text'       // Screenshot + metadata only
  },

  // Platform identifiers
  PLATFORMS: {
    TWITTER: 'twitter',
    YOUTUBE: 'youtube',
    REDDIT: 'reddit',
    FLICKR: 'flickr',
    DEVIANTART: 'deviantart',
    ARTSTATION: 'artstation',
    PINTEREST: 'pinterest',
    GOOGLE_ARTS: 'googlearts',
    GENERIC: 'web'
  }
};

// Make available to content scripts (not modules)
if (typeof window !== 'undefined') {
  window.ARCHIVER_CONFIG = CONFIG;
}

// Export for module usage
if (typeof module !== 'undefined') {
  module.exports = CONFIG;
}

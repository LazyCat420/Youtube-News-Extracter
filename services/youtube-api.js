/**
 * YouTube API Service
 * Handles OAuth 2.0 authentication and YouTube Data API v3 operations
 */

const { google } = require('googleapis');

class YouTubeAPIService {
    constructor(clientId, clientSecret, redirectUri) {
        this.oauth2Client = new google.auth.OAuth2(
            clientId,
            clientSecret,
            redirectUri
        );

        this.youtube = google.youtube({
            version: 'v3',
            auth: this.oauth2Client
        });
    }

    /**
     * Generate the OAuth 2.0 authorization URL
     */
    getAuthUrl() {
        const scopes = [
            'https://www.googleapis.com/auth/youtube',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ];

        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent'
        });
    }

    /**
     * Exchange authorization code for tokens
     */
    async getTokens(code) {
        const { tokens } = await this.oauth2Client.getToken(code);
        return tokens;
    }

    /**
     * Set credentials from stored tokens
     */
    setCredentials(tokens) {
        this.oauth2Client.setCredentials(tokens);
    }

    /**
     * Get user info
     */
    async getUserInfo() {
        const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
        const { data } = await oauth2.userinfo.get();
        return data;
    }

    /**
     * Create a new playlist on YouTube
     */
    async createPlaylist(title, description = '', privacy = 'private') {
        const response = await this.youtube.playlists.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: {
                    title,
                    description
                },
                status: {
                    privacyStatus: privacy // 'private', 'public', or 'unlisted'
                }
            }
        });
        return response.data;
    }

    /**
     * Add videos to a playlist (batch)
     * Note: YouTube API only allows adding one video at a time, so we batch them
     */
    async addVideosToPlaylist(playlistId, videoIds) {
        const results = [];

        for (const videoId of videoIds) {
            try {
                const response = await this.youtube.playlistItems.insert({
                    part: 'snippet',
                    requestBody: {
                        snippet: {
                            playlistId,
                            resourceId: {
                                kind: 'youtube#video',
                                videoId
                            }
                        }
                    }
                });
                results.push({ videoId, success: true, data: response.data });
            } catch (error) {
                console.error(`Failed to add video ${videoId}:`, error.message);
                results.push({ videoId, success: false, error: error.message });
            }
        }

        return results;
    }

    /**
     * Create playlist and add videos in one operation
     */
    async createPlaylistWithVideos(title, videoIds, description = '', privacy = 'private') {
        // Create the playlist
        const playlist = await this.createPlaylist(title, description, privacy);

        // Add videos to it
        const addResults = await this.addVideosToPlaylist(playlist.id, videoIds);

        const successCount = addResults.filter(r => r.success).length;

        return {
            playlist,
            videosAdded: successCount,
            totalVideos: videoIds.length,
            results: addResults
        };
    }
}

module.exports = YouTubeAPIService;

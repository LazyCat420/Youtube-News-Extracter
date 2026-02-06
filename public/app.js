document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentPreviewData = null;
    let allVideos = [];
    let deleteTargetId = null;

    // Tab Elements
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Extract Tab Elements
    const urlInput = document.getElementById('youtubeUrl');
    const extractBtn = document.getElementById('extractBtn');
    const loadingDiv = document.getElementById('loading');
    const previewDiv = document.getElementById('preview');
    const successDiv = document.getElementById('success');
    const errorDiv = document.getElementById('error');
    const errorMsg = document.getElementById('errorMsg');
    const successMsg = document.getElementById('successMsg');

    const previewTitle = document.getElementById('previewTitle');
    const previewDesc = document.getElementById('previewDesc');
    const previewTranscript = document.getElementById('previewTranscript');
    const copyBtn = document.getElementById('copyBtn');
    const saveBtn = document.getElementById('saveBtn');

    // Database Tab Elements
    const searchInput = document.getElementById('searchInput');
    const videoCount = document.getElementById('videoCount');
    const videoList = document.getElementById('videoList');
    const dbLoading = document.getElementById('dbLoading');
    const emptyState = document.getElementById('emptyState');

    // Modal Elements
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalDate = document.getElementById('modalDate');
    const modalLength = document.getElementById('modalLength');
    const modalTranscript = document.getElementById('modalTranscript');
    const closeModal = document.getElementById('closeModal');
    const modalCopyBtn = document.getElementById('modalCopyBtn');

    // Delete Modal Elements
    const deleteModal = document.getElementById('deleteModal');
    const deleteVideoTitle = document.getElementById('deleteVideoTitle');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const closeDeleteModalBtns = document.querySelectorAll('.close-delete-modal');

    // ============ Tab Switching ============
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;

            // Update buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(`${tabName}-tab`).classList.add('active');

            // Load database videos when switching to database tab
            if (tabName === 'database') {
                loadVideos();
            } else if (tabName === 'playlist') {
                loadPlaylists();
                loadChannels();
            }
        });
    });

    // ============ Extract Tab ============
    extractBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showError('Please enter a YouTube URL');
            return;
        }

        hideAllExtract();
        loadingDiv.classList.remove('hidden');
        extractBtn.disabled = true;

        try {
            const response = await fetch('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                currentPreviewData = data;
                showPreview(data);
            } else {
                showError(data.error || 'Failed to extract transcript');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('An error occurred while connecting to the server.');
        } finally {
            loadingDiv.classList.add('hidden');
            extractBtn.disabled = false;
        }
    });

    // Allow Enter key to trigger extract
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            extractBtn.click();
        }
    });

    copyBtn.addEventListener('click', () => {
        copyToClipboard(previewTranscript.textContent, copyBtn);
    });

    saveBtn.addEventListener('click', async () => {
        if (!currentPreviewData) return;

        saveBtn.disabled = true;
        saveBtn.textContent = '💾 Saving...';

        try {
            const response = await fetch('/api/videos/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentPreviewData)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                previewDiv.classList.add('hidden');
                showSuccess('Video saved to database successfully!');
                currentPreviewData = null;
                urlInput.value = '';
            } else {
                showError(data.error || 'Failed to save video');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Failed to save video to database.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save to Database';
        }
    });

    function showPreview(data) {
        previewTitle.textContent = data.title;
        previewDesc.textContent = data.description || 'No description available';
        previewTranscript.textContent = data.transcript;
        previewDiv.classList.remove('hidden');
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorDiv.classList.remove('hidden');
    }

    function showSuccess(msg) {
        successMsg.textContent = msg;
        successDiv.classList.remove('hidden');

        // Auto-hide after 3 seconds
        setTimeout(() => {
            successDiv.classList.add('hidden');
        }, 3000);
    }

    function hideAllExtract() {
        previewDiv.classList.add('hidden');
        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');
    }

    // ============ Database Tab ============
    async function loadVideos() {
        dbLoading.classList.remove('hidden');
        videoList.innerHTML = '';
        emptyState.classList.add('hidden');

        try {
            const response = await fetch('/api/videos');
            const data = await response.json();

            if (response.ok && data.success) {
                allVideos = data.videos;
                renderVideos(allVideos);
            } else {
                videoList.innerHTML = '<p class="error">Failed to load videos.</p>';
            }
        } catch (error) {
            console.error('Error:', error);
            videoList.innerHTML = '<p class="error">Failed to connect to server.</p>';
        } finally {
            dbLoading.classList.add('hidden');
        }
    }

    function renderVideos(videos) {
        videoCount.textContent = `${videos.length} video${videos.length !== 1 ? 's' : ''}`;

        if (videos.length === 0) {
            emptyState.classList.remove('hidden');
            videoList.innerHTML = '';
            return;
        }

        emptyState.classList.add('hidden');
        videoList.innerHTML = videos.map(video => `
            <div class="video-card" data-id="${video.id}">
                <div class="video-card-header">
                    <h3>${escapeHtml(video.title || 'Untitled Video')}</h3>
                </div>
                <div class="video-card-meta">
                    <span>📅 ${formatDate(video.scraped_at)}</span>
                    <span>📝 ${formatNumber(video.transcript_length)} chars</span>
                </div>
                <div class="video-card-preview">
                    ${escapeHtml(video.transcript_preview || '')}...
                </div>
                <div class="video-card-actions">
                    <button class="secondary-btn view-btn" data-id="${video.id}">👁️ View</button>
                    <button class="icon-btn delete-btn" data-id="${video.id}" data-title="${escapeHtml(video.title || 'Untitled')}">🗑️</button>
                </div>
            </div>
        `).join('');

        // Attach event listeners
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => viewVideo(btn.dataset.id));
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                deleteTargetId = btn.dataset.id;
                deleteVideoTitle.textContent = btn.dataset.title;
                deleteModal.classList.remove('hidden');
            });
        });
    }

    // Search functionality
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
            renderVideos(allVideos);
        } else {
            const filtered = allVideos.filter(v =>
                (v.title || '').toLowerCase().includes(query) ||
                (v.transcript_preview || '').toLowerCase().includes(query)
            );
            renderVideos(filtered);
        }
    });

    // ============ View Modal ============
    async function viewVideo(id) {
        try {
            const response = await fetch(`/api/videos/${id}`);
            const data = await response.json();

            if (response.ok && data.success) {
                const video = data.video;
                modalTitle.textContent = video.title || 'Untitled Video';
                modalDate.textContent = `📅 ${formatDate(video.scraped_at)}`;
                modalLength.textContent = `📝 ${formatNumber(video.transcript?.length || 0)} characters`;
                modalTranscript.textContent = video.transcript || 'No transcript available';
                modal.classList.remove('hidden');
            } else {
                alert('Failed to load video details.');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to connect to server.');
        }
    }

    closeModal.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });

    modalCopyBtn.addEventListener('click', () => {
        copyToClipboard(modalTranscript.textContent, modalCopyBtn);
    });

    // ============ Delete Modal ============
    closeDeleteModalBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            deleteModal.classList.add('hidden');
            deleteTargetId = null;
        });
    });

    deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) {
            deleteModal.classList.add('hidden');
            deleteTargetId = null;
        }
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        if (!deleteTargetId) return;

        confirmDeleteBtn.disabled = true;
        confirmDeleteBtn.textContent = 'Deleting...';

        try {
            const response = await fetch(`/api/videos/${deleteTargetId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (response.ok && data.success) {
                deleteModal.classList.add('hidden');
                deleteTargetId = null;
                loadVideos(); // Refresh the list
            } else {
                alert(data.error || 'Failed to delete video.');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to connect to server.');
        } finally {
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.textContent = '🗑️ Delete';
        }
    });

    // ============ Utility Functions ============
    function copyToClipboard(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = '✅ Copied!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        });
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown date';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatNumber(num) {
        if (!num) return '0';
        return num.toLocaleString();
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ============ Playlist Tab ============
    const playlistLoading = document.getElementById('playlistLoading');
    const playlistResult = document.getElementById('playlistResult');
    const playlistHistory = document.getElementById('playlistHistory');
    const generatePlaylistBtn = document.getElementById('generatePlaylistBtn');
    const channelsList = document.getElementById('channelsList');
    const authStatus = document.getElementById('authStatus');
    const authActions = document.getElementById('authActions');

    // Store channels data in memory
    let channelsData = [];
    let isLoggedIn = false;
    let authConfigured = false;

    // Check YouTube auth status on page load
    async function checkAuthStatus() {
        try {
            const response = await fetch('/api/auth/status');
            const data = await response.json();

            authConfigured = data.configured;
            isLoggedIn = data.loggedIn;

            if (!data.configured) {
                authStatus.innerHTML = '<span class="auth-not-configured">⚠️ YouTube API not configured</span>';
                authActions.innerHTML = '<a href="/.env.example" target="_blank" class="secondary-btn">Setup Guide</a>';
            } else if (data.loggedIn && data.user) {
                authStatus.innerHTML = `
                    ${data.user.picture ? `<img src="${data.user.picture}" alt="Profile">` : ''}
                    <span class="user-name">Logged in as ${data.user.name || data.user.email}</span>
                `;
                authActions.innerHTML = '<a href="/auth/logout" class="logout-btn">Logout</a>';
            } else {
                authStatus.innerHTML = '<span>Login to save playlists to YouTube</span>';
                authActions.innerHTML = '<a href="/auth/google" class="google-login-btn">🔐 Login with Google</a>';
            }

            // Re-render playlists to show/hide save buttons
            loadPlaylists();
        } catch (error) {
            console.error('Auth status check failed:', error);
            authStatus.innerHTML = '<span class="auth-not-configured">Auth check failed</span>';
        }
    }


    async function loadPlaylists() {
        try {
            const response = await fetch('/api/playlist/history');
            const data = await response.json();
            if (data.success) {
                renderPlaylists(data.playlists);
            }
        } catch (error) {
            console.error('Error loading playlists:', error);
        }
    }

    async function loadChannels() {
        try {
            const response = await fetch('/api/playlist/channels');
            const data = await response.json();
            if (data.success) {
                channelsData = data.channels || [];
                renderChannels();
            }
        } catch (error) {
            console.error('Error loading channels:', error);
            channelsList.innerHTML = '<p class="channels-empty">Error loading channels.</p>';
        }
    }

    function renderChannels() {
        if (channelsData.length === 0) {
            channelsList.innerHTML = '<p class="channels-empty">No channels configured. Add one above!</p>';
            return;
        }

        channelsList.innerHTML = channelsData.map((ch, index) => `
            <div class="channel-item" data-index="${index}">
                <div class="channel-info">
                    <div class="channel-name">${escapeHtml(ch.name)}</div>
                    <div class="channel-url">${escapeHtml(ch.url)}</div>
                    <div class="channel-tags">
                        ${ch.include_shorts ? '<span class="channel-tag">Shorts</span>' : ''}
                        ${ch.channel_id ? '<span class="channel-tag cached">⚡ Cached</span>' : '<span class="channel-tag">New</span>'}
                    </div>
                </div>
                <div class="channel-actions">
                    <button class="delete-btn delete-channel-btn" data-index="${index}" title="Delete channel">🗑️</button>
                </div>
            </div>
        `).join('');

        // Attach delete listeners
        document.querySelectorAll('.delete-channel-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const index = parseInt(btn.dataset.index);
                const channelName = channelsData[index].name;

                if (!confirm(`Delete channel "${channelName}"?`)) return;

                channelsData.splice(index, 1);
                await saveChannels();
                renderChannels();
                showSuccess(`Deleted: ${channelName}`);
            });
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    const categoryEmojis = {
        finance: '🏦',
        sports: '🏈',
        cooking: '🍳',
        tech: '💻',
        news: '📰',
        other: '📦'
    };

    function renderPlaylists(playlists) {
        const VIDEOS_PER_PLAYLIST = 50;

        playlistHistory.innerHTML = playlists.map((p, playlistIndex) => {
            const date = new Date(p.createdAt).toLocaleString();
            const videos = Array.isArray(p.data) ? p.data : [];
            const count = videos.length;

            // Group videos by category
            const categories = {};
            videos.forEach(v => {
                const cat = v.category || 'other';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(v);
            });

            // Split videos into chunks of 50 for play buttons
            const chunks = [];
            for (let i = 0; i < videos.length; i += VIDEOS_PER_PLAYLIST) {
                chunks.push(videos.slice(i, i + VIDEOS_PER_PLAYLIST));
            }

            // Generate play buttons
            const playButtons = chunks.map((chunk, index) => {
                const videoIds = chunk.map(v => v.id).join(',');
                const playlistUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds}`;
                const label = chunks.length > 1 ? `▶️ Part ${index + 1}` : '▶️ Play';
                return `<a href="${playlistUrl}" target="_blank" class="secondary-btn">${label}</a>`;
            }).join('');

            // Save to YouTube button
            const allVideoIds = videos.map(v => v.id);
            const saveButton = isLoggedIn
                ? `<button class="save-youtube-btn" data-title="Playlist ${date}" data-videos='${JSON.stringify(allVideoIds)}'>💾 YouTube</button>`
                : '';

            // Generate category sections with video cards
            // Fixed category order to prevent reordering when videos are deleted
            const categoryOrder = ['finance', 'news', 'tech', 'sports', 'cooking', 'other'];
            const sortedCategories = Object.entries(categories).sort((a, b) => {
                const orderA = categoryOrder.indexOf(a[0]);
                const orderB = categoryOrder.indexOf(b[0]);
                return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
            });

            const categorySections = sortedCategories.map(([cat, catVideos]) => {
                const categoryVideoIds = catVideos.map(v => v.id).join(',');
                const categoryPlayUrl = `https://www.youtube.com/watch_videos?video_ids=${categoryVideoIds}`;

                return `
                <div class="category-section">
                    <div class="category-header">
                        <span class="category-emoji">${categoryEmojis[cat] || '📺'}</span>
                        <span>${cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
                        <span class="category-count">(${catVideos.length})</span>
                        <a href="${categoryPlayUrl}" target="_blank" class="category-play-btn">▶️ Play ${cat.charAt(0).toUpperCase() + cat.slice(1)}</a>
                    </div>
                    <div class="video-grid">
                        ${catVideos.map(v => `
                            <div class="video-card" data-video-id="${v.id}">
                                <img class="video-thumbnail" src="${v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}" alt="" onerror="this.src='https://via.placeholder.com/120x68?text=No+Thumb'">
                                <div class="video-info">
                                    <a href="https://youtube.com/watch?v=${v.id}" target="_blank" class="video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</a>
                                    <div class="video-channel">${escapeHtml(v.channelName || 'Unknown')}</div>
                                </div>
                                <div class="video-actions">
                                    <button class="video-delete-btn" data-filename="${p.filename}" data-video-id="${v.id}" title="Remove">✕</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `}).join('');


            return `
                <div class="playlist-card" data-filename="${p.filename}">
                    <div class="playlist-card-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <div class="playlist-meta">
                            <span class="playlist-date">${date}</span>
                            <span class="playlist-count">${count} videos • ${Object.keys(categories).length} categories</span>
                        </div>
                        <div class="playlist-actions" onclick="event.stopPropagation()">
                            ${playButtons}
                            ${saveButton}
                            <button class="extract-btn" data-filename="${p.filename}">📜 Extract</button>
                            <button class="expand-btn">📂 View</button>
                            <button class="icon-btn delete-playlist-btn" data-filename="${p.filename}">🗑️</button>
                        </div>
                    </div>
                    <div class="collapsed-content">
                        ${categorySections}
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners
        attachPlaylistListeners();
    }

    function attachPlaylistListeners() {
        // Delete playlist - handled via document event delegation below

        // Delete single video
        document.querySelectorAll('.video-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const filename = btn.dataset.filename;
                const videoId = btn.dataset.videoId;

                try {
                    const response = await fetch(`/api/playlist/${filename}/video/${videoId}`, { method: 'DELETE' });
                    const data = await response.json();
                    if (data.success) {
                        showSuccess('Video removed.');
                        // Reload playlists but keep this one expanded
                        await loadPlaylists();
                        // Re-expand the playlist we were editing
                        const playlistCard = document.querySelector(`.playlist-card[data-filename="${filename}"]`);
                        if (playlistCard) {
                            playlistCard.classList.add('expanded');
                            const expandBtn = playlistCard.querySelector('.expand-btn');
                            if (expandBtn) expandBtn.textContent = '📁 Hide';
                        }
                    } else {
                        showError(data.error || 'Failed to remove video.');
                    }
                } catch (error) {
                    console.error('Delete video error:', error);
                    showError('Server error.');
                }
            });

        });


        // Extract transcripts with streaming progress
        document.querySelectorAll('.extract-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('Extract transcripts for all videos? This may take several minutes.')) return;

                const filename = btn.dataset.filename;
                const playlistCard = btn.closest('.playlist-card');

                // Disable button and show progress
                btn.disabled = true;
                const originalText = btn.textContent;
                btn.textContent = '⏳ Extracting...';
                btn.style.minWidth = '140px';

                // Create simple status display
                let statusDiv = playlistCard.querySelector('.extraction-status-display');
                if (!statusDiv) {
                    statusDiv = document.createElement('div');
                    statusDiv.className = 'extraction-status-display';
                    statusDiv.style.cssText = 'padding: 0.75rem 1rem; background: rgba(59,130,246,0.1); border-left: 3px solid #3b82f6; margin: 0.5rem 1rem; font-size: 0.85rem; color: #60a5fa;';
                    const header = playlistCard.querySelector('.playlist-card-header');
                    header.after(statusDiv);
                }
                statusDiv.textContent = '📥 Extracting transcripts... Please wait.';

                try {
                    const response = await fetch(`/api/playlist/${filename}/extract-transcripts`, { method: 'POST' });
                    const data = await response.json();

                    if (data.success) {
                        statusDiv.style.borderColor = '#10b981';
                        statusDiv.style.background = 'rgba(16,185,129,0.1)';
                        statusDiv.style.color = '#34d399';
                        statusDiv.textContent = `✅ Done! Extracted ${data.extracted} of ${data.total} transcripts.`;
                        btn.textContent = `✅ ${data.extracted}/${data.total}`;
                        showSuccess(`Extracted ${data.extracted} of ${data.total} transcripts!`);
                    } else {
                        throw new Error(data.error || 'Extraction failed');
                    }
                } catch (error) {
                    console.error('Extract error:', error);
                    statusDiv.style.borderColor = '#ef4444';
                    statusDiv.style.background = 'rgba(239,68,68,0.1)';
                    statusDiv.style.color = '#f87171';
                    statusDiv.textContent = `❌ Error: ${error.message}`;
                    btn.textContent = '❌ Failed';
                    showError(error.message || 'Extraction failed.');
                }

                // Reset button after delay
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 5000);
            });
        });


        // Save to YouTube
        document.querySelectorAll('.save-youtube-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const title = btn.dataset.title;
                const videoIds = JSON.parse(btn.dataset.videos);

                btn.disabled = true;
                btn.textContent = '⏳...';

                try {
                    const response = await fetch('/api/playlist/save-to-youtube', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, videoIds, privacy: 'private' })
                    });
                    const data = await response.json();

                    if (data.success) {
                        btn.textContent = '✅ Saved!';
                        showSuccess(`Saved to YouTube! ${data.videosAdded}/${data.totalVideos} videos.`);
                        if (data.playlistUrl) window.open(data.playlistUrl, '_blank');
                    } else {
                        throw new Error(data.error || 'Failed to save');
                    }
                } catch (error) {
                    console.error('Save to YouTube error:', error);
                    btn.textContent = '❌';
                    showError(error.message || 'Failed to save to YouTube');
                }

                setTimeout(() => {
                    btn.textContent = '💾 YouTube';
                    btn.disabled = false;
                }, 2000);
            });
        });

        // Expand button
        document.querySelectorAll('.expand-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.playlist-card');
                card.classList.toggle('expanded');
                btn.textContent = card.classList.contains('expanded') ? '📁 Hide' : '📂 View';
            });
        });
    }

    generatePlaylistBtn.addEventListener('click', async () => {
        generatePlaylistBtn.disabled = true;
        playlistLoading.classList.remove('hidden');
        playlistResult.classList.add('hidden');

        console.log('%c🎬 Starting playlist generation...', 'color: #4CAF50; font-weight: bold');

        try {
            const response = await fetch('/api/playlist/generate', { method: 'POST' });
            const data = await response.json();

            // Display logs in browser console
            if (data.logs && Array.isArray(data.logs)) {
                console.group('%c📋 Playlist Generation Logs', 'color: #2196F3; font-weight: bold');
                data.logs.forEach(entry => {
                    const style = entry.type === 'error' ? 'color: red'
                        : entry.type === 'warn' ? 'color: orange'
                            : 'color: #333';
                    console.log(`%c[${entry.timestamp}] ${entry.message}`, style);
                });
                console.groupEnd();
            }

            if (data.success) {
                showSuccess(`Playlist generated! found ${data.videoCount !== undefined ? data.videoCount : 'new'} videos.`);
                loadPlaylists(); // Refresh history
            } else {
                showError(data.message || 'Failed to generate playlist.');
            }
        } catch (error) {
            console.error('Generation error:', error);
            showError('Failed to trigger generation.');
        } finally {
            generatePlaylistBtn.disabled = false;
            playlistLoading.classList.add('hidden');
        }
    });

    async function saveChannels() {
        try {
            const response = await fetch('/api/playlist/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channels: channelsData })
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Save channels error:', error);
            showError('Failed to save channels.');
            return false;
        }
    }

    // Add Channel Functionality
    const newChannelName = document.getElementById('newChannelName');
    const newChannelUrl = document.getElementById('newChannelUrl');
    const newChannelShorts = document.getElementById('newChannelShorts');
    const addChannelBtn = document.getElementById('addChannelBtn');

    addChannelBtn.addEventListener('click', async () => {
        const name = newChannelName.value.trim();
        let url = newChannelUrl.value.trim();

        if (!name || !url) {
            showError('Please enter both name and URL.');
            return;
        }

        // Normalize URL
        if (!url.startsWith('http')) {
            url = 'https://www.youtube.com/@' + url;
        }

        // Check for duplicate URL
        if (channelsData.some(c => c.url === url || c.name.toLowerCase() === name.toLowerCase())) {
            showError('Channel already exists.');
            return;
        }

        // Add new channel
        channelsData.push({
            name: name,
            url: url,
            include_shorts: newChannelShorts.checked
        });

        // Save and refresh
        const saved = await saveChannels();
        if (saved) {
            newChannelName.value = '';
            newChannelUrl.value = '';
            newChannelShorts.checked = false;
            renderChannels();
            showSuccess(`Added channel: ${name}`);
        }
    });

    // Load channels on page load
    loadChannels();

    // Check YouTube auth status on page load
    checkAuthStatus();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            modal.classList.add('hidden');
            deleteModal.classList.add('hidden');
            deleteTargetId = null;
        }
    });
    // ========================================
    // DELETE PLAYLIST - Document-level event delegation
    // This catches clicks on .delete-playlist-btn regardless of when they were rendered
    // ========================================
    // IMPORTANT: Use capture phase (true) because .playlist-actions has onclick="event.stopPropagation()"
    // which blocks bubbling. Capture fires top-down BEFORE that stopPropagation runs.
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.delete-playlist-btn');
        if (!btn) return;

        e.stopPropagation();
        e.preventDefault();

        const filename = btn.dataset.filename;
        console.log('[DELETE PLAYLIST] Button clicked for:', filename);

        // First click = prime, second click = delete
        if (btn.dataset.primed !== 'true') {
            btn.dataset.primed = 'true';
            btn.innerHTML = '⚠️ Sure?';
            btn.style.background = 'rgba(239, 68, 68, 0.3)';
            btn.style.borderColor = '#ef4444';
            btn.style.width = 'auto';
            btn.style.minWidth = '70px';
            console.log('[DELETE PLAYLIST] Primed - click again to confirm');

            setTimeout(() => {
                if (btn.dataset.primed === 'true') {
                    btn.dataset.primed = '';
                    btn.innerHTML = '🗑️';
                    btn.style.cssText = '';
                }
            }, 3000);
            return;
        }

        // Second click - do the delete
        btn.dataset.primed = '';
        btn.innerHTML = '⏳';
        btn.disabled = true;
        console.log('[DELETE PLAYLIST] Confirmed - sending DELETE request for:', filename);

        try {
            const response = await fetch(`/api/playlist/${filename}`, { method: 'DELETE' });
            const data = await response.json();
            console.log('[DELETE PLAYLIST] Response:', response.status, data);

            if (data.success) {
                showSuccess('Playlist deleted!');
                loadPlaylists();
            } else {
                showError('Failed: ' + (data.error || 'Unknown'));
                btn.innerHTML = '🗑️';
                btn.style.cssText = '';
                btn.disabled = false;
            }
        } catch (error) {
            console.error('[DELETE PLAYLIST] Error:', error);
            showError('Server error: ' + error.message);
            btn.innerHTML = '🗑️';
            btn.style.cssText = '';
            btn.disabled = false;
        }
    }, true); // true = capture phase, fires BEFORE stopPropagation on parent div
});

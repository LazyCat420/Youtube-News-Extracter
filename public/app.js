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

    // Store channels data in memory
    let channelsData = [];

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

    function renderPlaylists(playlists) {
        const VIDEOS_PER_PLAYLIST = 50;

        playlistHistory.innerHTML = playlists.map(p => {
            const date = new Date(p.createdAt).toLocaleString();
            const videos = Array.isArray(p.data) ? p.data : [];
            const count = videos.length;

            // Split videos into chunks of 50
            const chunks = [];
            for (let i = 0; i < videos.length; i += VIDEOS_PER_PLAYLIST) {
                chunks.push(videos.slice(i, i + VIDEOS_PER_PLAYLIST));
            }

            // Generate play buttons for each chunk
            const playButtons = chunks.map((chunk, index) => {
                const videoIds = chunk.map(v => v.id).join(',');
                const playlistUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds}`;
                const label = chunks.length > 1 ? `▶️ Part ${index + 1}` : '▶️ Play All';
                return `<a href="${playlistUrl}" target="_blank" class="secondary-btn">${label}</a>`;
            }).join('');

            return `
                <li class="history-item">
                    <div class="history-meta">
                        <strong>${date}</strong>
                        <span>${count} videos${chunks.length > 1 ? ` (${chunks.length} parts)` : ''}</span>
                    </div>
                    <div class="history-actions">
                        ${playButtons}
                        <a href="/auto-yt-playlist/output/${p.filename.replace('.json', '.md')}" target="_blank" class="secondary-btn">📄 Markdown</a>
                        <button class="icon-btn delete-playlist-btn" data-filename="${p.filename}">🗑️</button>
                    </div>
                </li>
            `;
        }).join('');

        // Attach listeners
        document.querySelectorAll('.delete-playlist-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Are you sure you want to delete this playlist?')) return;

                const filename = btn.dataset.filename;
                try {
                    const response = await fetch(`/api/playlist/${filename}`, { method: 'DELETE' });
                    const data = await response.json();
                    if (data.success) {
                        showSuccess('Playlist deleted.');
                        loadPlaylists();
                    } else {
                        showError('Failed to delete playlist.');
                    }
                } catch (error) {
                    console.error('Delete playlist error:', error);
                    showError('Server error.');
                }
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

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            modal.classList.add('hidden');
            deleteModal.classList.add('hidden');
            deleteTargetId = null;
        }
    });
});
